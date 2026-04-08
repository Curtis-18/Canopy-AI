"""
Canopy AI — AI-powered forest deforestation detection for Uganda
Uses Google Earth Engine and Gemini AI for analysis
"""

import base64
import json
import math
import os
import threading
import time

import requests
from functools import lru_cache

import ee
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

# ============================================================================
# SHARED CONSTANTS
# ============================================================================

FORESTS = {
    "Mabira Forest":   (0.45, 32.95),
    "Budongo Forest":  (1.73, 31.55),
    "Kibale Forest":   (0.50, 30.36),
    "Bwindi Forest":   (-1.03, 29.68),
    "Queen Elizabeth":  (-0.20, 29.90),
}

# Real-world proximity flags for each monitored forest.
# near_road: bordered by or near a major highway / trunk road.
# near_settlement: adjacent communities within ~5 km of the forest edge.
FOREST_PROXIMITY = {
    "Mabira Forest":   {"near_road": True,  "near_settlement": True},   # Kampala-Jinja highway, surrounding communities
    "Budongo Forest":  {"near_road": True,  "near_settlement": True},   # Masindi road, nearby villages
    "Kibale Forest":   {"near_road": False, "near_settlement": True},   # Relatively remote, but communities nearby
    "Bwindi Forest":   {"near_road": False, "near_settlement": False},  # Remote montane forest
    "Queen Elizabeth":  {"near_road": True,  "near_settlement": True},   # Near roads and communities
}

STAT_KEYS = ("healthy_pct", "at_risk_pct", "degraded_pct", "cleared_pct", "total_area_ha", "ndvi_mean")

# ============================================================================
# INITIALIZATION
# ============================================================================

_gee_initialized = False
_gee_lock = threading.Lock()

def init_gee():
    """Initialize Google Earth Engine — thread-safe, raises on failure."""
    global _gee_initialized
    if _gee_initialized:
        return
    with _gee_lock:
        if _gee_initialized:          # double-check after acquiring lock
            return
        ee.Initialize(project='deforestation-489507')
        print("✓ Google Earth Engine connected")
        _gee_initialized = True


def _init_gemini():
    """Initialize Gemini with a known model — no expensive list call."""
    try:
        api_key = os.getenv('GEMINI_API_KEY')
        if not api_key:
            print("✗ GEMINI_API_KEY not set")
            return None
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-2.5-flash-lite')
        print("✓ Gemini API configured (gemini-2.5-flash-lite)")
        return model
    except Exception as e:
        print(f"✗ Gemini initialization failed: {e}")
        return None


gemini = _init_gemini()

# ============================================================================
# CACHE
# ============================================================================

_cache = {}
_cache_lock = threading.Lock()
CACHE_TTL = 3600  # 1 hour


def _cache_get(key: str):
    with _cache_lock:
        entry = _cache.get(key)
        if entry:
            value, ts = entry
            if time.time() - ts < CACHE_TTL:
                return value
            del _cache[key]
    return None


def _cache_set(key: str, value):
    with _cache_lock:
        _cache[key] = (value, time.time())


# ============================================================================
# PLANET INSIGHTS API INTEGRATION
# ============================================================================

def get_planet_image(lat, lng, year, size=512, max_cloud=0.05):
    """Fetch the clearest PlanetScope visual thumbnail for (lat,lng,year).
    
    Returns a base64-encoded PNG string, or None on any failure.
    """
    api_key = os.getenv("PLANET_API_KEY")
    if not api_key:
        print("⚠️ Planet API key not set")
        return None

    search_payload = {
        "item_types": ["PSScene"],
        "filter": {
            "type": "AndFilter",
            "config": [
                {
                    "type": "GeometryFilter",
                    "field_name": "geometry",
                    "config": {
                        "type": "Point",
                        "coordinates": [lng, lat]
                    }
                },
                {
                    "type": "DateRangeFilter",
                    "field_name": "acquired",
                    "config": {
                        "gte": f"{year}-01-01T00:00:00Z",
                        "lte": f"{year}-12-31T23:59:59Z"
                    }
                },
                {
                    "type": "RangeFilter",
                    "field_name": "cloud_cover",
                    "config": {"lte": max_cloud}
                },
                {
                    "type": "StringInFilter",
                    "field_name": "quality_category",
                    "config": ["standard"]
                }
            ]
        }
    }

    try:
        session = requests.Session()
        session.auth = (api_key, "")
        
        # 1. Search for best item
        search_url = "https://api.planet.com/data/v1/quick-search"
        search_res = session.post(search_url, json=search_payload, timeout=20)
        if search_res.status_code != 200:
            print(f"⚠️ Planet search {search_res.status_code} for y={year}: {search_res.text}")
            return None
            
        items = search_res.json().get("features", [])
        if not items:
            return None
            
        # Sort by lowest cloud cover
        items.sort(key=lambda x: x["properties"].get("cloud_cover", 1.0))
        best_item = items[0]
        
        item_id = best_item["id"]
        
        # 2. Get thumbnail (PSScene thumbnails are visual/RGB)
        thumb_url = f"https://tiles.planet.com/data/v1/item-types/PSScene/items/{item_id}/thumb?width={size}"
        thumb_res = session.get(thumb_url, timeout=20)
        
        if thumb_res.status_code == 200 and thumb_res.content:
            return base64.b64encode(thumb_res.content).decode("utf-8")
        
        print(f"⚠️ Planet thumb {thumb_res.status_code} for {item_id}")
        return None
        
    except Exception as exc:
        print(f"⚠️ Planet request failed ({lat},{lng}) y={year}: {exc}")
        return None


def get_year_specific_photo(lat, lng, year):
    """Return the clearest Planet image for (lat,lng,year) with fallbacks.

    Tries cloud thresholds 5→10→20→30→50% for the requested year, then falls
    back to adjacent years (±1, ±2) if no image is found.

    Returns a dict with image_base64, year_used, cloud_threshold_used,
    is_fallback_year, requested_year — or None for image_base64 if all attempts fail.
    """
    cloud_thresholds = [5, 10, 20, 30, 50]

    # Try requested year with progressively relaxed cloud threshold
    for threshold in cloud_thresholds:
        cache_key = f"planet_photo_{round(lat,4)}_{round(lng,4)}_{year}_{threshold}"
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

        img = get_planet_image(lat, lng, year, max_cloud=threshold / 100.0)
        if img:
            result = {
                "image_base64": img,
                "year_used": year,
                "cloud_threshold_used": threshold,
                "is_fallback_year": False,
                "requested_year": year,
            }
            _cache_set(cache_key, result)
            _cache_set(f"photo_{round(lat,4)}_{round(lng,4)}_{year}_result", result) # Map for frontend cache
            return result

    # All thresholds failed — try adjacent years
    fallback_years = [year - 1, year + 1, year - 2, year + 2]
    for fy in fallback_years:
        if fy < 2015 or fy > 2026:
            continue
        for threshold in cloud_thresholds:
            img = get_planet_image(lat, lng, fy, max_cloud=threshold / 100.0)
            if img:
                result = {
                    "image_base64": img,
                    "year_used": fy,
                    "cloud_threshold_used": threshold,
                    "is_fallback_year": True,
                    "requested_year": year,
                }
                _cache_set(f"planet_photo_{round(lat,4)}_{round(lng,4)}_{year}_{threshold}", result)
                _cache_set(f"photo_{round(lat,4)}_{round(lng,4)}_{year}_result", result)
                return result

    # Nothing worked
    return {
        "image_base64": None,
        "year_used": None,
        "cloud_threshold_used": None,
        "is_fallback_year": False,
        "requested_year": year,
        "error": "No cloud-free Planet pass found within ±2 years",
    }


# ============================================================================
# GEE NATURAL-COLOUR PHOTO (replaces Planet for before/after panel)
# ============================================================================

def get_gee_photo(
    lat: float, lng: float, year: int,
    date_start: str = None, date_end: str = None,
    zoom: int = 13,
) -> dict:
    """Fetch a GEE Sentinel-2 natural-colour tile as base64 for the before/after panel.

    Returns a dict with the same shape as get_year_specific_photo so the
    /photo endpoint is a drop-in replacement:
      image_base64, year_used, cloud_threshold_used, is_fallback_year,
      requested_year, source.
    Returns image_base64=None on failure (panel shows the 'unavailable' placeholder).
    """
    init_gee()

    cache_key = f"gee_photo_{round(lat, 4)}_{round(lng, 4)}_{year}_{date_start}_{date_end}_{zoom}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    region = ee.Geometry.Point([lng, lat]).buffer(5000)
    ds = date_start or f'{year}-01-01'
    de = date_end   or f'{year}-12-31'

    def _try_composite(y, d_start, d_end, cloud_pct):
        """Return (image, vis_params) or (None, None) — no .getInfo() coverage check."""
        ys = d_start or f'{y}-01-01'
        ye = d_end   or f'{y}-12-31'

        # Sentinel-2 (2015+)
        if y >= 2015:
            col = (ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
                   .filterBounds(region)
                   .filterDate(ys, ye)
                   .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', cloud_pct))
                   .map(_mask_s2_clouds_natural))
            size = col.size().getInfo()
            if size > 0:
                img = col.median().select(['B4', 'B3', 'B2']).clip(region)
                return img, VIS_S2_NATURAL

        # Landsat 8 (2013+)
        if y >= 2013:
            l8 = (ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
                  .filterBounds(region)
                  .filterDate(ys, ye)
                  .filter(ee.Filter.lt('CLOUD_COVER', cloud_pct))
                  .map(_mask_landsat_clouds))
            if l8.size().getInfo() > 0:
                img = (l8.median()
                         .select(['SR_B4', 'SR_B3', 'SR_B2'], ['B4', 'B3', 'B2'])
                         .multiply(_L_SCALE).add(_L_OFFSET).multiply(10000)
                         .clip(region))
                return img, VIS_S2_NATURAL

        # Landsat 7 (fallback)
        l7 = (ee.ImageCollection('LANDSAT/LE07/C02/T1_L2')
              .filterBounds(region)
              .filterDate(ys, ye)
              .filter(ee.Filter.lt('CLOUD_COVER', cloud_pct))
              .map(_mask_landsat_clouds))
        if l7.size().getInfo() > 0:
            img = (l7.median()
                     .select(['SR_B3', 'SR_B2', 'SR_B1'], ['B4', 'B3', 'B2'])
                     .multiply(_L_SCALE).add(_L_OFFSET).multiply(10000)
                     .clip(region))
            return img, VIS_S2_NATURAL

        return None, None

    try:
        img, vis = None, None

        # Try requested year at progressively relaxed cloud thresholds
        for cloud_pct in [20, 35, 50, 70]:
            img, vis = _try_composite(year, ds, de, cloud_pct)
            if img is not None:
                break

        # Fall back to adjacent years if still nothing
        if img is None:
            for fy in [year - 1, year + 1, year - 2, year + 2]:
                if fy < 2003 or fy > 2026:
                    continue
                img, vis = _try_composite(fy, None, None, 50)
                if img is not None:
                    break

        if img is None:
            print(f"⚠️ GEE photo: no imagery found ({lat:.4f},{lng:.4f}) y={year}")
            return {
                "image_base64":        None,
                "year_used":           None,
                "cloud_threshold_used": None,
                "is_fallback_year":    False,
                "requested_year":      year,
                "error":               "No imagery found in GEE for this location/year",
            }

        tile_url = img.getMapId(vis)['tile_fetcher'].url_format
        b64 = fetch_tile_as_base64(tile_url, lat, lng, zoom)

        result = {
            "image_base64":        b64,
            "year_used":           year,
            "cloud_threshold_used": None,
            "is_fallback_year":    False,
            "requested_year":      year,
            "source":              "GEE·Sentinel-2",
        }
        _cache_set(cache_key, result)
        print(f"✓ GEE photo ({lat:.4f},{lng:.4f}) y={year} " +
              ("OK" if b64 else "NO TILE"))
        return result

    except Exception as exc:
        print(f"⚠️ get_gee_photo failed ({lat:.4f},{lng:.4f}) y={year}: {exc}")
        return {
            "image_base64":        None,
            "year_used":           None,
            "cloud_threshold_used": None,
            "is_fallback_year":    False,
            "requested_year":      year,
            "error":               str(exc),
        }


# ============================================================================
# SCORING
# ============================================================================

def uganda_risk_score(
    cleared_pct: float,
    degraded_pct: float,
    ndvi_mean: float,
    near_road: bool = False,
    near_settlement: bool = False,
) -> int:
    score = (
        max(0, (0.7 - ndvi_mean) / 0.7) * 35
        + cleared_pct * 0.35
        + degraded_pct * 0.15
        + (10 if near_road else 0)
        + (5 if near_settlement else 0)
    )
    return min(100, round(score))


def score_to_alert(score: int) -> dict:
    if score >= 70:
        return {"level": "CRITICAL", "score": score,
                "message": "Severe deforestation detected. Immediate intervention required."}
    if score >= 50:
        return {"level": "HIGH", "score": score,
                "message": "Significant forest loss detected. Urgent monitoring needed."}
    if score >= 30:
        return {"level": "MEDIUM", "score": score,
                "message": "Moderate vegetation stress. Area should be monitored closely."}
    return {"level": "LOW", "score": score,
            "message": "Forest cover appears stable. Continue routine monitoring."}


def km_to_area_ha(radius_km: float) -> float:
    return round(math.pi * radius_km ** 2 * 100, 1)


# ============================================================================
# EARTH ENGINE HELPERS
# ============================================================================

def _get_imagery(year: int, region, date_start: str = None, date_end: str = None):
    """Get satellite imagery — falls back S2 -> L8 -> L7 with standard band renaming.

    When date_start/date_end are supplied they override the full-year defaults (used
    for monthly composites).  For year 2026 every composite is pixel-filled using an
    Oct–Dec 2025 fallback so patches with no 2026 coverage remain continuous.
    """
    ds = date_start or f'{year}-01-01'
    de = date_end   or f'{year}-12-31'
    # Monthly composites use a relaxed cloud threshold so short windows still have scenes.
    cloud_pct = 30 if date_start else 20

    # Sentinel-2 (2015+)
    if year >= 2015:
        s2col = (ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
                 .filterBounds(region)
                 .filterDate(ds, de)
                 .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', cloud_pct)))
        if s2col.size().getInfo() > 0:
            if year == 2026:
                composite = s2col.median().select(['B4', 'B8'], ['Red', 'NIR']).clip(region)
                fallback  = (ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
                             .filterBounds(region)
                             .filterDate('2025-10-01', '2025-12-31')
                             .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
                             .median().select(['B4', 'B8'], ['Red', 'NIR']).clip(region))
                return composite.unmask(fallback)
            return s2col.median().select(['B4', 'B8'], ['Red', 'NIR']).clip(region)

    # Landsat 8 (2013+)
    if year >= 2013:
        l8col = (ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
                 .filterBounds(region)
                 .filterDate(ds, de)
                 .filter(ee.Filter.lt('CLOUD_COVER', cloud_pct)))
        if l8col.size().getInfo() > 0:
            composite = l8col.median().select(['SR_B4', 'SR_B5'], ['Red', 'NIR']).clip(region)
            if year == 2026:
                fallback = (ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
                            .filterBounds(region)
                            .filterDate('2025-10-01', '2025-12-31')
                            .filter(ee.Filter.lt('CLOUD_COVER', 30))
                            .median().select(['SR_B4', 'SR_B5'], ['Red', 'NIR']).clip(region))
                composite = composite.unmask(fallback)
            return composite

    # Landsat 7 (pre-2013 or final fallback)
    l7col = (ee.ImageCollection('LANDSAT/LE07/C02/T1_L2')
             .filterBounds(region)
             .filterDate(ds, de)
             .filter(ee.Filter.lt('CLOUD_COVER', cloud_pct)))
    composite = l7col.median().select(['SR_B3', 'SR_B4'], ['Red', 'NIR']).clip(region)
    if year == 2026:
        fallback = (ee.ImageCollection('LANDSAT/LE07/C02/T1_L2')
                    .filterBounds(region)
                    .filterDate('2025-10-01', '2025-12-31')
                    .filter(ee.Filter.lt('CLOUD_COVER', 30))
                    .median().select(['SR_B3', 'SR_B4'], ['Red', 'NIR']).clip(region))
        composite = composite.unmask(fallback)
    return composite


def _mask_s2_clouds(image):
    """Per-pixel SCL cloud mask for Sentinel-2 SR.

    Masks out:
      3  = cloud shadow
      8  = cloud medium probability
      9  = cloud high probability
      10 = thin cirrus
    """
    scl = image.select('SCL')
    mask = (
        scl.neq(3)
           .And(scl.neq(8))
           .And(scl.neq(9))
           .And(scl.neq(10))
    )
    return image.updateMask(mask)
# ── Cloud masking for NDVI analysis (strict SCL — unchanged) ────────────────
# _mask_s2_clouds() is kept for NDVI / analysis paths only.

# ── Natural colour visualisation params (Fix 2) ──────────────────────────────
# Both Year-A and Year-B panels always use these identical params so the
# before/after comparison is visually consistent.  min=300 clips the dark
# noise floor; max=3200 gives headroom for bright soil without clipping forest.
# The 'bands' key is required so getMapId renders RGB directly.
VIS_S2_NATURAL = {
    'bands': ['B4', 'B3', 'B2'],
    'min':   300,
    'max':   3200,
    'gamma': 1.45,
}

# Keep _VIS_S2 / _VIS_LANDSAT for any legacy callers (basemap, NDVI overlays)
_VIS_S2      = {'min': 300,  'max': 3200,  'gamma': 1.45}
_VIS_LANDSAT = {'min': 7000, 'max': 43000, 'gamma': 1.4}

# Landsat C2 SR rescale constants → maps DN to S2-equivalent reflectance ×10000
_L_SCALE  = 0.0000275
_L_OFFSET = -0.2


def _mask_landsat_clouds(image):
    """QA_PIXEL bit-mask cloud filter for Landsat Collection-2 (L7 and L8).

    Masks bits 3 (cloud shadow) and 4 (cloud).
    """
    qa = image.select('QA_PIXEL')
    cloud_shadow = qa.bitwiseAnd(1 << 3).neq(0)
    cloud        = qa.bitwiseAnd(1 << 4).neq(0)
    return image.updateMask(cloud_shadow.Not().And(cloud.Not()))


def _mask_s2_clouds_natural(image):
    """Cloud mask for natural-colour tiles using MSK_CLDPRB (Fix 1).

    Uses MSK_CLDPRB (cloud probability, 0-100) built into every S2_SR_HARMONIZED
    scene.  40 % threshold is less aggressive than SCL — it accepts slightly hazy
    pixels rather than leaving large masked (white/blank) holes in the composite.
    Keep _mask_s2_clouds (SCL-based) for NDVI analysis; it stays untouched.
    """
    cloud_prob = image.select('MSK_CLDPRB')
    return image.updateMask(cloud_prob.lt(40))


# ── s2cloudless helpers (used by basemap) ─────────────────────────────────────

def _build_s2_cloudless_col(region, date_start: str, date_end: str, cloud_pct: int = 60):
    """Return S2_SR_HARMONIZED joined with COPERNICUS/S2_CLOUD_PROBABILITY."""
    s2_sr = (
        ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(region)
        .filterDate(date_start, date_end)
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', cloud_pct))
    )
    s2_cld = (
        ee.ImageCollection('COPERNICUS/S2_CLOUD_PROBABILITY')
        .filterBounds(region)
        .filterDate(date_start, date_end)
    )
    return ee.ImageCollection(
        ee.Join.saveFirst('cloud_prob').apply(
            primary=s2_sr,
            secondary=s2_cld,
            condition=ee.Filter.equals(
                leftField='system:index', rightField='system:index'
            ),
        )
    )


def _apply_cloudless_mask(img):
    """Per-pixel cloud mask via cloud_prob join + SCL shadow/cirrus."""
    cloud_prob = ee.Image(img.get('cloud_prob')).select('probability')
    is_cloud   = cloud_prob.gt(40)
    scl        = img.select('SCL')
    is_shadow_cirrus = scl.eq(3).Or(scl.eq(10))
    return img.updateMask(is_cloud.Or(is_shadow_cirrus).Not())


def _get_natural_colour(year: int, region, date_start: str = None, date_end: str = None):
    """Return (composite_image, vis_params) for a crisp true-colour RGB tile.

    Fix 3 — Progressive cloud-threshold + valid-pixel coverage check:
      • Tries MSK_CLDPRB thresholds 20 → 35 → 50 → 65 until ≥30 % valid pixels.
      • Falls back to an 18-month window if the calendar year is sparse.
      • Gap-fills remaining masked pixels from the prior-year dry season.
      • Landsat (pre-2015) images are rescaled to S2 reflectance scale so the
        same VIS_S2_NATURAL params work without visual discontinuities.
    """
    ds = date_start or f'{year}-01-01'
    de = date_end   or f'{year}-12-31'

    # ── Sentinel-2 (2015+) ───────────────────────────────────────────────────
    if year >= 2015:

        def _build_s2_natural(threshold: int, d_start: str, d_end: str):
            """Build a cloud-masked S2 composite; return it if ≥30 % valid pixels, else None."""
            col = (
                ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
                .filterBounds(region)
                .filterDate(d_start, d_end)
                .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', threshold + 10))
                .map(_mask_s2_clouds_natural)
            )
            count = col.size().getInfo()
            if count == 0:
                return None, threshold, 0.0

            composite = col.median().select(['B4', 'B3', 'B2']).clip(region)

            # Valid-pixel coverage check (scale=30 m keeps it fast)
            stats = composite.select('B4').reduceRegion(
                reducer=ee.Reducer.count(),
                geometry=region,
                scale=30,
                maxPixels=1e6,
            ).getInfo()
            # Count ALL pixels (including masked) by unmasking with 0 first
            total_stats = composite.select('B4').unmask(0).reduceRegion(
                reducer=ee.Reducer.count(),
                geometry=region,
                scale=30,
                maxPixels=1e6,
            ).getInfo()
            valid = stats.get('B4', 0)
            tot   = max(total_stats.get('B4', 1), 1)
            coverage = valid / tot

            return (composite, threshold, round(coverage, 3)) if coverage >= 0.30 else (None, threshold, round(coverage, 3))

        composite   = None
        used_thresh = None
        coverage    = 0.0

        for thresh in [20, 35, 50, 65]:
            result = _build_s2_natural(thresh, ds, de)
            img, used_thresh, coverage = result[0], result[1], result[2] if len(result) == 3 else 0.0
            if img is not None:
                composite = img
                break

        if composite is None:
            ext_end = f'{min(year + 1, 2025)}-06-30'
            result  = _build_s2_natural(65, f'{year}-01-01', ext_end)
            img, used_thresh, coverage = result[0], result[1], result[2] if len(result) == 3 else 0.0
            if img is not None:
                composite = img

        if composite is not None and year >= 2020:
            fallback_year = year - 1
            fb_result = _build_s2_natural(50, f'{fallback_year}-06-01', f'{fallback_year}-12-31')
            fb = fb_result[0]
            if fb is not None:
                composite = composite.unmask(fb)

        if composite is not None:
            return composite, VIS_S2_NATURAL

    # ── Landsat 8 (2013–2014) — rescaled to S2 equivalent ───────────────────
    if year >= 2013:
        l8 = (
            ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
            .filterBounds(region)
            .filterDate(ds, de)
            .filter(ee.Filter.lt('CLOUD_COVER', 50))
            .map(_mask_landsat_clouds)
        )
        if l8.size().getInfo() > 0:
            img = (l8.median()
                     .select(['SR_B4', 'SR_B3', 'SR_B2'], ['B4', 'B3', 'B2'])
                     .multiply(_L_SCALE).add(_L_OFFSET).multiply(10000)
                     .clip(region))
            return img, VIS_S2_NATURAL

    # ── Landsat 7 (≤2012, or final fallback) ─────────────────────────────────
    l7 = (
        ee.ImageCollection('LANDSAT/LE07/C02/T1_L2')
        .filterBounds(region)
        .filterDate(ds, de)
        .filter(ee.Filter.lt('CLOUD_COVER', 50))
        .map(_mask_landsat_clouds)
    )
    img = (l7.median()
             .select(['SR_B3', 'SR_B2', 'SR_B1'], ['B4', 'B3', 'B2'])
             .multiply(_L_SCALE).add(_L_OFFSET).multiply(10000)
             .clip(region))
    return img, VIS_S2_NATURAL


def _ndvi(image, year: int):
    """Compute NDVI using the standardized band names."""
    return image.normalizedDifference(['NIR', 'Red']).rename('NDVI')


def _risk_map(ndvi_image):
    """Classify NDVI into 4 risk levels: 0=healthy, 1=at-risk, 2=degraded, 3=cleared."""
    return (
        ee.Image(0)
        .where(ndvi_image.lte(0.6), 1)
        .where(ndvi_image.lte(0.4), 2)
        .where(ndvi_image.lte(0.2), 3)
        .rename('risk')
    )


# ============================================================================
# CORE ANALYSIS
# ============================================================================

def analyze_location_gee(
    lat: float, lng: float, year: int, radius_km: float,
    date_start: str = None, date_end: str = None,
) -> dict:
    """Analyze forest health at a location — cached, optimized GEE query.

    date_start / date_end override the full-year window when a monthly composite
    is requested (e.g. '2026-01-01' / '2026-01-31' for Jan 2026).
    """
    init_gee()

    cache_key = f"analyze_{lat}_{lng}_{year}_{radius_km}_{date_start}_{date_end}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    region = ee.Geometry.Point([lng, lat]).buffer(radius_km * 1000)
    img  = _get_imagery(year, region, date_start, date_end)
    ndvi = _ndvi(img, year)
    risk = _risk_map(ndvi).byte()

    combined = risk.addBands(ndvi).reduceRegion(
        reducer=ee.Reducer.frequencyHistogram().combine(ee.Reducer.mean(), "", True),
        geometry=region, scale=200, maxPixels=1e7,
    ).getInfo() or {}

    hist = combined.get('risk_histogram') or combined.get('risk', {})
    if not hist and combined.get('NDVI_mean') is not None:
        # Fallback if histogram is missing but mean exists (e.g. single pixel)
        val = '0' if combined['NDVI_mean'] > 0.6 else '1' if combined['NDVI_mean'] > 0.4 else '2' if combined['NDVI_mean'] > 0.2 else '3'
        hist = {val: 1}

    total = sum(hist.values()) or 1

    result = {
        "healthy_pct":   round(hist.get('0', 0) / total * 100, 1),
        "at_risk_pct":   round(hist.get('1', 0) / total * 100, 1),
        "degraded_pct":  round(hist.get('2', 0) / total * 100, 1),
        "cleared_pct":   round(hist.get('3', 0) / total * 100, 1),
        "ndvi_mean":     round(combined.get('NDVI_mean') or 0.5, 3),
        "total_area_ha": km_to_area_ha(radius_km),
        "analysis_scale_m": 200,
    }

    _cache_set(cache_key, result)
    return result


def get_map_tiles(
    lat: float, lng: float, year_a: int, year_b: int, radius_km: float,
    date_start_a: str = None, date_end_a: str = None, label_a: str = None,
    date_start_b: str = None, date_end_b: str = None, label_b: str = None,
) -> dict:
    """Get GEE map tile URLs for NDVI, change, and risk layers.

    date_start_*/date_end_* override the full-year window for each period;
    label_a/label_b are passed back in the response for display purposes.
    """
    init_gee()

    cache_key = f"tiles_{lat}_{lng}_{year_a}_{year_b}_{radius_km}_{date_start_a}_{date_end_a}_{date_start_b}_{date_end_b}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    try:
        region = ee.Geometry.Point([lng, lat]).buffer(radius_km * 1000)
        # Natural-colour composites used only for Gemini Vision (HotZones pipeline).
        # Before/after panels now use the Sentinel Hub /photo endpoint instead.
        ndvi_a = _ndvi(_get_imagery(year_a, region, date_start_a, date_end_a), year_a)
        ndvi_b = _ndvi(_get_imagery(year_b, region, date_start_b, date_end_b), year_b)

        def tile_url(image, vis):
            try:
                return image.getMapId(vis)['tile_fetcher'].url_format
            except Exception:
                return ""

        result = {
            'ndvi': tile_url(ndvi_b, {
                'min': 0, 'max': 0.9,
                'palette': ['red', 'orange', 'yellow', 'lightgreen', 'darkgreen'],
            }),
            'change': tile_url(ndvi_b.subtract(ndvi_a).rename('change'), {
                'min': -0.4, 'max': 0.4,
                'palette': ['red', 'white', 'darkgreen'],
            }),
            'risk': tile_url(_risk_map(ndvi_b), {
                'min': 0, 'max': 3,
                'palette': ['darkgreen', 'yellow', 'orange', 'red'],
            }),
            'year_a':  year_a,
            'year_b':  year_b,
            'label_a': label_a or str(year_a),
            'label_b': label_b or str(year_b),
            'cross_sensor_warning': (
                "Comparison spans Sentinel-2 and Landsat sensors. "
                "Minor spectral differences may affect change detection accuracy."
                if (year_a < 2015) != (year_b < 2015) else None
            ),
        }
        _cache_set(cache_key, result)
        return result

    except Exception as e:
        print(f"✗ Tile error: {e}")
        return {'ndvi': '', 'change': '', 'risk': '',
                'year_a': year_a, 'year_b': year_b,
                'label_a': label_a or str(year_a), 'label_b': label_b or str(year_b),
                'error': str(e)}


def get_basemap_tiles() -> dict:
    """Get a GEE tile URL for the Uganda-wide Sentinel-2 2024 natural colour composite.

    Returns {"url": "https://..."}. Cached for 1 hour.
    """
    init_gee()

    cache_key = "basemap_2024"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    try:
        # Uganda bounding box (W, S, E, N)
        uganda = ee.Geometry.Rectangle([29.5, -1.5, 35.1, 4.3])

        # Use s2cloudless join for the basemap composite — same masking pipeline
        # as _get_natural_colour so basemap + panel tiles are visually consistent.
        s2 = _build_s2_cloudless_col(uganda, '2024-01-01', '2024-12-31', 20).map(_apply_cloudless_mask)

        if s2.size().getInfo() == 0:
            # Fallback to Landsat 8 2024
            l8 = (
                ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
                .filterBounds(uganda)
                .filterDate('2024-01-01', '2024-12-31')
                .filter(ee.Filter.lt('CLOUD_COVER', 20))
                .map(_mask_landsat_clouds)
            )
            composite = l8.median().select(['SR_B4', 'SR_B3', 'SR_B2'])
        else:
            composite = s2.median().select(['B4', 'B3', 'B2'])

        url = composite.getMapId(_VIS_S2)['tile_fetcher'].url_format

        result = {'url': url}
        _cache_set(cache_key, result)
        print("✓ Basemap tile URL generated")
        return result

    except Exception as e:
        print(f"✗ Basemap error: {e}")
        return {'url': '', 'error': str(e)}


def get_forest_grid(forest_name: str, n: int = 5) -> list[tuple[float, float]]:
    """Return n×n evenly-spaced sample points centred on the given forest.

    Uses a ±0.09° offset (≈ ±10 km near Uganda's equator) from the forest centre,
    producing 25 points with ~5 km spacing — wide enough to cover the full forest
    while staying local enough for 2 km-radius per-point analysis.
    """
    entry = FORESTS.get(forest_name)
    if entry is None:
        raise ValueError(f"Unknown forest: {forest_name!r}")
    clat, clng = entry

    half = 0.09          # degrees ≈ 10 km at Uganda's latitude
    step = (2 * half) / (n - 1) if n > 1 else 0
    points: list[tuple[float, float]] = []
    for i in range(n):
        lat = clat - half + i * step
        for j in range(n):
            lng = clng - half + j * step
            points.append((lat, lng))
    return points


# ============================================================================
# GEMINI VISION — TILE HELPERS & ZONE ANALYSIS
# ============================================================================

# Severity ordering for ranking (index = rank weight, higher index = more severe)
SEVERITY_RANK = {"None": 0, "Low": 1, "Moderate": 2, "High": 3, "Critical": 4}

# ESA WorldCover 2021 class codes and their forest-candidacy
_WC_CLASSES = {
    10: ("Tree cover",     True),
    20: ("Shrubland",      True),
    30: ("Grassland",      False),
    40: ("Cropland",       False),
    50: ("Built-up",       False),
    60: ("Bare/sparse",    False),
    70: ("Snow/ice",       False),
    80: ("Water",          False),
    90: ("Wetlands",       True),
    95: ("Mangroves",      True),
    100: ("Moss/lichen",   False),
}


def check_worldcover_class(lat: float, lng: float, radius_km: float) -> dict:
    """Query ESA WorldCover 2021 for the dominant land-cover class at this point.

    Returns a dict with:
      dominant_class:    int   — WorldCover class code (10=Tree cover, 40=Cropland …)
      class_name:        str   — human-readable class name
      is_forest_candidate: bool — True if the class warrants further analysis
    """
    init_gee()
    try:
        region = ee.Geometry.Point([lng, lat]).buffer(radius_km * 1000)
        wc = ee.ImageCollection("ESA/WorldCover/v200").first().clip(region)
        dominant = wc.select("Map").reduceRegion(
            reducer=ee.Reducer.mode(),
            geometry=region,
            scale=10,
            maxPixels=1e7,
        ).getInfo()
        code = int(dominant.get("Map") or 0)
        class_name, is_candidate = _WC_CLASSES.get(code, ("Unknown", False))
        return {
            "dominant_class":      code,
            "class_name":          class_name,
            "is_forest_candidate": is_candidate,
        }
    except Exception as exc:
        print(f"⚠️ WorldCover check failed ({lat:.4f},{lng:.4f}): {exc}")
        # On failure default to keeping the zone so we don't silently discard it
        return {"dominant_class": 0, "class_name": "Unknown", "is_forest_candidate": True}


def _tile_xy(lat: float, lng: float, zoom: int = 13) -> tuple[int, int]:
    """Convert WGS-84 lat/lng to Slippy Map tile x/y at a given zoom level."""
    n = 2 ** zoom
    x = int((lng + 180.0) / 360.0 * n)
    lat_r = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0 * n)
    return x, y


def fetch_tile_as_base64(tile_url: str, lat: float, lng: float, zoom: int = 13) -> str | None:
    """Download a GEE tile at the Slippy Map tile covering (lat, lng) and return base64 PNG.

    tile_url must be the URL template from getMapId — it contains literal
    '{z}', '{x}', '{y}' (or equivalent placeholders used by GEE tile fetcher).
    We replace them with the computed values for the given lat/lng + zoom.
    """
    try:
        x, y = _tile_xy(lat, lng, zoom)
        url = tile_url.replace('{z}', str(zoom)).replace('{x}', str(x)).replace('{y}', str(y))
        resp = requests.get(url, timeout=20)
        if resp.status_code == 200 and resp.content:
            return base64.b64encode(resp.content).decode('utf-8')
        print(f"⚠️ Tile HTTP {resp.status_code} for ({lat:.4f},{lng:.4f}) z={zoom}")
    except Exception as exc:
        print(f"⚠️ fetch_tile_as_base64 failed ({lat:.4f},{lng:.4f}): {exc}")
    return None


_GEMINI_FOREST_PROMPT = """You are an expert tropical rainforest analyst for Uganda.
You are looking at two Sentinel-2 natural colour satellite images
of the same location taken in different years.

Image 1: Baseline year
Image 2: Comparison year

Your task is to determine if this location contains genuine RAINFOREST
or DENSE WOODLAND CANOPY and whether it has been lost or damaged.

DISQUALIFYING SIGNALS — if any of these are present set is_forest_zone to false:
- Rectangular or geometric shaped soil patches indicating tilled farmland
- Patchwork of small green and brown blocks indicating smallholder agriculture
- Reddish brown or orange exposed soil in geometric patterns
- Straight dirt tracks or paths cutting through vegetation in grid patterns
- Uniform crop rows or plantation rows with identical spacing
- Scattered trees on otherwise open agricultural land

QUALIFYING SIGNALS — all of these should be present for is_forest_zone true:
- Continuous unbroken tree canopy covering majority of the image
- Irregular organic boundaries between trees with no geometric straight edges
- Dark green dense texture consistent with rainforest or mature woodland
- No dominant geometric human land use patterns visible

FOREST LOSS SIGNALS — only relevant if is_forest_zone is true:
- Areas of canopy present in Image 1 that are absent in Image 2
- Logging scars — irregular brown patches replacing dark green canopy
- New straight edges appearing in previously continuous forest
- Settlement expansion into previously forested area

Return ONLY valid JSON with no markdown and no extra text:
{
  "is_forest_zone": true or false,
  "forest_loss_detected": true or false,
  "forest_type": "rainforest|woodland|plantation|regrowth|farmland|bare|unknown",
  "canopy_loss_severity": "None|Low|Moderate|High|Critical",
  "estimated_loss_pct": 0-100,
  "confidence": "High|Medium|Low",
  "observation": "one sentence describing the most significant change you observe",
  "discard_reason": null or "specific reason this zone is not genuine forest"
}"""


def gemini_analyze_forest_zone(
    natural_a_url: str,
    natural_b_url: str,
    lat: float,
    lng: float,
) -> dict | None:
    """Send both natural-colour tile images to Gemini Vision and return parsed analysis.

    Downloads the GEE tiles for (lat, lng), sends them with the expert prompt,
    and returns the parsed JSON dict or None on any failure.
    """
    if gemini is None:
        print("✗ Gemini not initialized — cannot analyze zone")
        return None

    b64_a = fetch_tile_as_base64(natural_a_url, lat, lng)
    if b64_a is None:
        print(f"⚠️ Baseline tile unavailable for ({lat:.4f},{lng:.4f}) — skipping zone")
        return None

    b64_b = fetch_tile_as_base64(natural_b_url, lat, lng)
    if b64_b is None:
        print(f"⚠️ Comparison tile unavailable for ({lat:.4f},{lng:.4f}) — skipping zone")
        return None

    try:
        import google.generativeai as genai_module
        generation_config = genai_module.GenerationConfig(
            response_mime_type="application/json",
        )
        response = gemini.generate_content(
            [
                {"mime_type": "image/png", "data": b64_a},
                {"mime_type": "image/png", "data": b64_b},
                _GEMINI_FOREST_PROMPT,
            ],
            generation_config=generation_config,
        )
        text = response.text.strip()
        # Strip accidental markdown fences even though we asked for clean JSON
        text = text.replace('```json', '').replace('```', '').strip()
        parsed = json.loads(text)
        # Normalise discard_reason: Gemini sometimes returns the string "null"
        dr = parsed.get('discard_reason')
        if dr in (None, 'null', '', 'None'):
            parsed['discard_reason'] = None
        print(f"  ✓ Gemini ({lat:.4f},{lng:.4f}): "
              f"forest={parsed.get('is_forest_zone')} "
              f"severity={parsed.get('canopy_loss_severity')} "
              f"loss={parsed.get('estimated_loss_pct')}%")
        return parsed
    except Exception as exc:
        print(f"⚠️ gemini_analyze_forest_zone failed ({lat:.4f},{lng:.4f}): {exc}")
        return None


def get_natural_tile_urls(
    lat: float, lng: float,
    year_a: int, year_b: int,
    radius_km: float,
    date_start_a: str = None, date_end_a: str = None,
    date_start_b: str = None, date_end_b: str = None,
) -> tuple[str, str]:
    """Return (natural_a_url, natural_b_url) tile URL templates for a point.

    Internally calls _get_natural_colour for both years and generates URLs via
    getMapId.  Returns ('', '') on failure.
    """
    init_gee()
    try:
        region = ee.Geometry.Point([lng, lat]).buffer(radius_km * 1000)
        nc_a, vis_a = _get_natural_colour(year_a, region, date_start_a, date_end_a)
        nc_b, vis_b = _get_natural_colour(year_b, region, date_start_b, date_end_b)

        def _url(img, vis):
            try:
                return img.getMapId(vis)['tile_fetcher'].url_format
            except Exception:
                return ''

        return _url(nc_a, vis_a), _url(nc_b, vis_b)
    except Exception as exc:
        print(f"⚠️ get_natural_tile_urls failed ({lat:.4f},{lng:.4f}): {exc}")
        return '', ''


# ============================================================================
# LOCATION UTILITIES
# ============================================================================

def get_forest_name(lat: float, lng: float) -> str:
    """Find the nearest major Uganda forest within ~100 km."""
    best_name, best_dist = "Unknown Forest", float('inf')
    for name, (f_lat, f_lng) in FORESTS.items():
        dist = math.hypot(lat - f_lat, lng - f_lng) * 111
        if dist < best_dist and dist < 100:
            best_name, best_dist = name, dist
    return best_name


# ============================================================================
# AI INSIGHTS (Gemini)
# ============================================================================

_insight_cache = {}
_insight_cache_lock = threading.Lock()


def generate_forest_insight(
    location_name: str, lat: float, lng: float, year: int,
    stats: dict, ndvi_mean: float, alert_level: str, risk_score: int,
    year_a: int = None, year_b: int = None, forest_lost_ha: float = None,
    date_start: str | None = None,
) -> dict | None:
    """Send forest data to Gemini and get back a structured intelligence briefing."""
    if gemini is None:
        print("✗ Gemini not initialized — check GEMINI_API_KEY")
        return None

    # Cache key: rounded lat/lng + year (so same-area clicks reuse the result)
    cache_key = f"insight_{round(lat, 2)}_{round(lng, 2)}_{year}_{date_start or ''}"
    with _insight_cache_lock:
        if cache_key in _insight_cache:
            print(f"✓ Insight cache hit: {cache_key}")
            return _insight_cache[cache_key]

    change_ctx = ""
    if forest_lost_ha is not None:
        change_ctx = (
            f"\n- Comparing {year_a} to {year_b}"
            f"\n- Forest lost: {forest_lost_ha} hectares"
            f"\n- Change in healthy cover: {stats.get('healthy_pct_a', 'N/A')}% → {stats.get('healthy_pct_b', 'N/A')}%"
        )

    prompt = f"""You are an expert forest conservation analyst specializing in Uganda's ecosystems.

CRITICAL: Your analysis MUST reflect the risk score ({risk_score}/100) and alert level ({alert_level}).
If the alert is HIGH or CRITICAL, there IS significant deforestation/degradation.

Analyze this satellite data and provide a concise intelligence briefing.

LOCATION: {location_name}
COORDINATES: {lat:.4f}°N, {lng:.4f}°E
YEAR: {year}
ALERT LEVEL: {alert_level}
RISK SCORE: {risk_score}/100

LAND COVER BREAKDOWN:
- Healthy forest: {stats['healthy_pct']}%
- At risk vegetation: {stats['at_risk_pct']}%
- Degraded land: {stats['degraded_pct']}%
- Cleared land: {stats['cleared_pct']}%
- Mean NDVI: {ndvi_mean:.3f}
- Total area: {stats['total_area_ha']} ha
{change_ctx}

ANALYSIS RULES:
- cleared% + degraded% > 20% → significant deforestation pressure
- NDVI < 0.5 → stressed forest
- CRITICAL alert → acknowledge severe forest loss
- degraded% > 30% → active deforestation

UGANDA CONTEXT:
- Drivers: charcoal, agriculture, illegal logging, urban encroachment
- Priority forests: Mabira, Budongo, Kibale, Bwindi

Respond ONLY with this JSON (no markdown):
{{
  "summary": "2-3 sentence plain English summary",
  "likely_cause": "Most probable cause matching the metrics",
  "severity_explanation": "Why {alert_level} alert was warranted",
  "recommended_actions": ["action 1", "action 2", "action 3"],
  "trend_assessment": "Future outlook if no action taken"
}}"""

    try:
        text = gemini.generate_content(prompt).text.strip()
        text = text.replace('```json', '').replace('```', '').strip()
        result = json.loads(text)
        with _insight_cache_lock:
            _insight_cache[cache_key] = result
        return result
    except Exception as e:
        print(f"✗ Gemini error: {e}")
        return None