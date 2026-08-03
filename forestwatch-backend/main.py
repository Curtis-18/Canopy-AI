import asyncio
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from models import (
    AnalyzeRequest, AnalyzeResponse,
    CompareRequest, CompareResponse,
    ForestStats, RiskAlert,
    InsightRequest, InsightResponse,
    HotZonesRequest, HotZone, HotZonesResponse,
)
from analyzer import (
    FORESTS, STAT_KEYS, FOREST_PROXIMITY, SEVERITY_RANK,
    analyze_location_gee as analyze,
    get_map_tiles,
    get_basemap_tiles,
    get_forest_grid,
    get_natural_tile_urls,
    get_gee_photo,
    gemini_analyze_forest_zone,
    check_worldcover_class,
    uganda_risk_score,
    score_to_alert,
    km_to_area_ha,
    get_forest_name,
    generate_forest_insight,
)

# ============================================================================
# APP
# ============================================================================

app = FastAPI(
    title="Canopy AI",
    description="AI-powered deforestation detection for Uganda",
    version="1.0.0",
)

allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
allowed_origins = [
    origin.strip().rstrip("/")
    for origin in allowed_origins_env.split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

_executor = ThreadPoolExecutor(max_workers=4)


from typing import Optional


class TilesRequest(BaseModel):
    lat:          float
    lng:          float
    year_a:       int   = 2020
    year_b:       int   = 2024
    radius_km:    float = 10.0
    # Optional date-range overrides for each period (monthly 2026 composites)
    date_start_a: Optional[str] = None
    date_end_a:   Optional[str] = None
    label_a:      Optional[str] = None
    date_start_b: Optional[str] = None
    date_end_b:   Optional[str] = None
    label_b:      Optional[str] = None


class PhotoRequest(BaseModel):
    lat:    float
    lng:    float
    year_a: int
    year_b: int


def _build_stats(data: dict) -> ForestStats:
    return ForestStats(**{k: data[k] for k in STAT_KEYS})


# ============================================================================
# ENDPOINTS
# ============================================================================

@app.get("/")
def root():
    return {
        "system":  "Canopy AI",
        "status":  "online",
        "version": "1.0.0",
        "endpoints": ["/analyze", "/compare", "/tiles", "/basemap", "/forests", "/health", "/docs"],
    }


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.get("/forests")
def list_forests():
    """List major Uganda forests with coordinates."""
    return {"forests": {
        k.lower().split()[0]: {"name": k, "lat": v[0], "lng": v[1]}
        for k, v in FORESTS.items()
    }}


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze_forest(req: AnalyzeRequest):
    """Analyze forest health at a location (no AI — use /insight for that)."""
    t0 = time.time()

    try:
        data = analyze(req.lat, req.lng, req.year, req.radius_km,
                       date_start=req.date_start, date_end=req.date_end)
    except Exception as e:
        raise HTTPException(500, f"Analysis failed: {e}")

    try:
        name  = get_forest_name(req.lat, req.lng)
        prox  = FOREST_PROXIMITY.get(name, {})
        score = uganda_risk_score(
            data["cleared_pct"], data["degraded_pct"], data["ndvi_mean"],
            near_road=prox.get("near_road", False),
            near_settlement=prox.get("near_settlement", False),
        )
        alert = score_to_alert(score)

        print(f"✓ Analyze {time.time()-t0:.2f}s")

        return AnalyzeResponse(
            location={"lat": req.lat, "lng": req.lng, "name": name},
            year=req.year,
            label=req.label or str(req.year),
            stats=_build_stats(data),
            alert=RiskAlert(**alert),
            data_source="Sentinel-2 / GEE",
        )
    except Exception as e:
        print(f"✗ Response error: {e}")
        raise HTTPException(500, f"Internal server error: {e}")


@app.post("/compare", response_model=CompareResponse)
async def compare_years(req: CompareRequest):
    """Compare forest health between two years — parallel GEE calls (no AI)."""
    t0 = time.time()
    loop = asyncio.get_event_loop()

    try:
        data_a, data_b = await asyncio.gather(
            loop.run_in_executor(_executor, lambda: analyze(
                req.lat, req.lng, req.year_a, req.radius_km,
                req.date_start_a, req.date_end_a)),
            loop.run_in_executor(_executor, lambda: analyze(
                req.lat, req.lng, req.year_b, req.radius_km,
                req.date_start_b, req.date_end_b)),
        )
    except Exception as e:
        raise HTTPException(500, f"Comparison failed: {e}")

    try:
        forest_lost_pct = round(data_a["healthy_pct"] - data_b["healthy_pct"], 1)
        forest_lost_ha  = round((forest_lost_pct / 100) * data_a["total_area_ha"], 1)

        name  = get_forest_name(req.lat, req.lng)
        prox  = FOREST_PROXIMITY.get(name, {})
        score = uganda_risk_score(
            data_b["cleared_pct"], data_b["degraded_pct"], data_b["ndvi_mean"],
            near_road=prox.get("near_road", False),
            near_settlement=prox.get("near_settlement", False),
        )
        alert = score_to_alert(score)

        label_a = req.label_a or str(req.year_a)
        label_b = req.label_b or str(req.year_b)

        change_summary = (
            f"Between {label_a} and {label_b}, healthy forest cover changed from "
            f"{data_a['healthy_pct']}% to {data_b['healthy_pct']}% — "
            f"a loss of {forest_lost_ha} hectares."
            if forest_lost_pct > 0
            else f"Forest cover remained stable between {label_a} and {label_b}."
        )

        print(f"✓ Compare {time.time()-t0:.2f}s")

        return CompareResponse(
            location={"lat": req.lat, "lng": req.lng},
            year_a=req.year_a, year_b=req.year_b,
            label_a=label_a, label_b=label_b,
            stats_a=_build_stats(data_a),
            stats_b=_build_stats(data_b),
            forest_lost_pct=forest_lost_pct,
            forest_lost_ha=forest_lost_ha,
            alert=RiskAlert(**alert),
            change_summary=change_summary,
        )
    except Exception as e:
        print(f"✗ Response error: {e}")
        raise HTTPException(500, f"Internal server error: {e}")


@app.post("/insight", response_model=InsightResponse)
def get_insight(req: InsightRequest):
    """On-demand AI insight — only called when user clicks 'AI Insights'."""
    t0 = time.time()
    try:
        stats = {
            'healthy_pct':  req.healthy_pct,
            'at_risk_pct':  req.at_risk_pct,
            'degraded_pct': req.degraded_pct,
            'cleared_pct':  req.cleared_pct,
            'total_area_ha': req.total_area_ha,
        }
        if req.healthy_pct_a is not None:
            stats['healthy_pct_a'] = req.healthy_pct_a
        if req.healthy_pct_b is not None:
            stats['healthy_pct_b'] = req.healthy_pct_b

        insight_raw = generate_forest_insight(
            location_name=req.location_name,
            lat=req.lat, lng=req.lng, year=req.year,
            stats=stats, ndvi_mean=req.ndvi_mean,
            alert_level=req.alert_level, risk_score=req.risk_score,
            year_a=req.year_a, year_b=req.year_b,
            forest_lost_ha=req.forest_lost_ha,
        )

        if insight_raw:
            from models import ForestInsight
            print(f"✓ Insight {time.time()-t0:.2f}s")
            return InsightResponse(insight=ForestInsight(**insight_raw))

        return InsightResponse(error="Gemini returned no insight")
    except Exception as e:
        print(f"✗ Insight error: {e}")
        return InsightResponse(error=str(e))


@app.post("/tiles")
def get_tiles(req: TilesRequest):
    """Get map tiles for visualization."""
    t0 = time.time()
    try:
        tiles = get_map_tiles(
            req.lat, req.lng, req.year_a, req.year_b, req.radius_km,
            date_start_a=req.date_start_a, date_end_a=req.date_end_a, label_a=req.label_a,
            date_start_b=req.date_start_b, date_end_b=req.date_end_b, label_b=req.label_b,
        )
    except Exception as e:
        raise HTTPException(500, f"Tile generation failed: {e}")
    print(f"✓ Tiles {time.time()-t0:.2f}s")
    return tiles


@app.get("/basemap")
def get_basemap():
    """Get a GEE tile URL for the Uganda-wide 2024 natural colour basemap (legacy)."""
    t0 = time.time()
    try:
        result = get_basemap_tiles()
    except Exception as e:
        raise HTTPException(500, f"Basemap generation failed: {e}")
    print(f"✓ Basemap {time.time()-t0:.2f}s")
    return result


@app.post("/photo")
async def get_photos(req: PhotoRequest):
    """Fetch GEE Sentinel-2 natural-colour tiles for two years in parallel.

    Replaces the previous Planet Labs thumbnail call. Returns photo_a and
    photo_b via asyncio.gather (completes in the time of the slower call).
    Results are cached 1 hour per (lat, lng, year) via the shared in-memory cache.
    """
    t0 = time.time()

    loop = asyncio.get_event_loop()
    try:
        photo_a, photo_b = await asyncio.gather(
            loop.run_in_executor(_executor, get_gee_photo, req.lat, req.lng, req.year_a),
            loop.run_in_executor(_executor, get_gee_photo, req.lat, req.lng, req.year_b),
        )
    except Exception as e:
        raise HTTPException(500, f"Photo fetch failed: {e}")

    print(f"✓ /photo GEE ({req.lat},{req.lng}) {req.year_a}/{req.year_b} in {time.time()-t0:.2f}s")
    return {"photo_a": photo_a, "photo_b": photo_b}


@app.get("/test-tiles")
def test_tiles(
    lat: float = 0.49576, lng: float = 33.00087,
    year_a: int = 2020, year_b: int = 2024,
    radius_km: float = 5.0
):
    """Debug endpoint to instantly verify the imagery pipeline via direct URL."""
    req = TilesRequest(
        lat=lat, lng=lng,
        year_a=year_a, year_b=year_b,
        radius_km=radius_km
    )
    return get_tiles(req)


_CACHE_FILE = Path(__file__).parent / "hotzones_cache.json"
_CACHE_TTL_DAYS = 7


def _cache_key(forest_name: str, year_a: int, year_b: int) -> str:
    safe = forest_name.replace(" ", "_").replace("/", "-")
    return f"{safe}_{year_a}_{year_b}"


def _read_hotzones_cache(key: str) -> dict | None:
    """Return cached payload if it exists and is < 7 days old, else None."""
    try:
        if not _CACHE_FILE.exists():
            return None
        data = json.loads(_CACHE_FILE.read_text())
        entry = data.get(key)
        if not entry:
            return None
        cached_at = datetime.fromisoformat(entry["cached_at"])
        age_days = (datetime.now(timezone.utc) - cached_at).total_seconds() / 86400
        if age_days > _CACHE_TTL_DAYS:
            return None
        return entry
    except Exception as exc:
        print(f"⚠️ Cache read failed: {exc}")
        return None


def _write_hotzones_cache(key: str, payload: dict):
    """Write a payload entry under key to the JSON cache file."""
    try:
        data: dict = {}
        if _CACHE_FILE.exists():
            try:
                data = json.loads(_CACHE_FILE.read_text())
            except Exception:
                pass  # corrupt cache — overwrite
        data[key] = payload
        _CACHE_FILE.write_text(json.dumps(data, indent=2))
        print(f"✓ Hotzones cache saved: {key}")
    except Exception as exc:
        print(f"⚠️ Cache write failed: {exc}")


# ============================================================================
# HOT ZONES ENDPOINT
# ============================================================================

@app.post("/hotzones", response_model=HotZonesResponse)
async def scan_hot_zones(req: HotZonesRequest):
    """Scan a 5×5 grid across a forest and return the top genuine forest loss zones.

    4-step pipeline (quota-efficient):
      1. Cache check  — return instantly if < 7 days old (0 GEE / 0 Gemini calls)
      2. WorldCover   — GEE pre-filter: discard cropland/grassland/bare land before Gemini
      3. NDVI pre-rank — take top 8 WorldCover-passed zones by forest_lost_pct
      4. Gemini Vision — max 8 calls; filter + rank by canopy_loss_severity
    """
    t0 = time.time()
    loop = asyncio.get_event_loop()

    print(f"➔ /hotzones: forest={req.forest_name!r} "
          f"year_a={req.year_a} year_b={req.year_b} "
          f"force_refresh={req.force_refresh}")

    # ── validate forest name ──
    if req.forest_name not in FORESTS:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown forest_name {req.forest_name!r}. Valid: {sorted(FORESTS.keys())}",
        )

    # ────────────────────────────────────────────────────
    # STEP 1: Cache check
    # ────────────────────────────────────────────────────
    ckey = _cache_key(req.forest_name, req.year_a, req.year_b)
    if not req.force_refresh:
        cached = _read_hotzones_cache(ckey)
        if cached:
            print(f"✓ Returning cached hotzones ({ckey}) — "
                  f"saved at {cached['cached_at']}")
            # Reconstruct the full response from cache
            zones = [HotZone(**z) for z in cached["zones"]]
            return HotZonesResponse(
                zones=zones,
                forest_name=cached["forest_name"],
                year_a=cached["year_a"],
                year_b=cached["year_b"],
                label_a=cached.get("label_a") or str(cached["year_a"]),
                label_b=cached.get("label_b") or str(cached["year_b"]),
                total_scanned=cached["total_scanned"],
                ai_verified=cached.get("ai_verified", True),
                zones_discarded=cached.get("zones_discarded", 0),
                worldcover_filtered=cached.get("worldcover_filtered", 0),
                scan_message=cached.get("scan_message", ""),
                cached=True,
                cached_at=cached["cached_at"],
            )

    # ────────────────────────────────────────────────────
    # STEP 2a: Build grid + run 50 GEE NDVI calls concurrently
    # ────────────────────────────────────────────────────
    try:
        grid = get_forest_grid(req.forest_name, n=5)  # 25 points
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    def _safe_analyze(lat, lng, year, radius, date_start, date_end):
        try:
            return analyze(lat, lng, year, radius, date_start, date_end)
        except Exception as exc:
            print(f"⚠️  GEE ({lat:.4f},{lng:.4f}) y={year} failed: {exc}")
            return None

    def _safe_worldcover(lat, lng):
        try:
            return check_worldcover_class(lat, lng, req.radius_km)
        except Exception as exc:
            print(f"⚠️  WorldCover ({lat:.4f},{lng:.4f}) failed: {exc}")
            return {"dominant_class": 0, "class_name": "Unknown", "is_forest_candidate": True}

    try:
        tasks_a  = [loop.run_in_executor(_executor, _safe_analyze, lat, lng,
                                         req.year_a, req.radius_km,
                                         req.date_start_a, req.date_end_a)
                    for lat, lng in grid]
        tasks_b  = [loop.run_in_executor(_executor, _safe_analyze, lat, lng,
                                         req.year_b, req.radius_km,
                                         req.date_start_b, req.date_end_b)
                    for lat, lng in grid]
        tasks_wc = [loop.run_in_executor(_executor, _safe_worldcover, lat, lng)
                    for lat, lng in grid]
        all_results = await asyncio.gather(*tasks_a, *tasks_b, *tasks_wc)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Grid scan gather failed: {e}")

    n = len(grid)
    results_a  = all_results[:n]
    results_b  = all_results[n:2*n]
    wc_results = all_results[2*n:]

    # ────────────────────────────────────────────────────
    # STEP 2b: WorldCover pre-filter + build raw zone records
    # ────────────────────────────────────────────────────
    raw_zones         = []   # zones that passed GEE + WorldCover
    skipped_gee       = 0
    wc_filtered_count = 0

    for (lat, lng), da, db, wc in zip(grid, results_a, results_b, wc_results):
        if da is None or db is None:
            skipped_gee += 1
            continue

        # WorldCover pre-filter: discard non-forest land-cover classes
        if not wc.get("is_forest_candidate", True):
            wc_filtered_count += 1
            print(f"  ✘ WorldCover ({lat:.4f},{lng:.4f}): "
                  f"{wc['class_name']} (class {wc['dominant_class']}) — discarded")
            continue

        try:
            forest_lost    = round(da["healthy_pct"] - db["healthy_pct"], 2)
            forest_name_pt = get_forest_name(lat, lng)
            prox_pt        = FOREST_PROXIMITY.get(forest_name_pt, {})
            score_b = uganda_risk_score(
                db["cleared_pct"], db["degraded_pct"], db["ndvi_mean"],
                near_road=prox_pt.get("near_road", False),
                near_settlement=prox_pt.get("near_settlement", False),
            )
            alert_b = score_to_alert(score_b)
            raw_zones.append({
                "lat":            round(lat, 5),
                "lng":            round(lng, 5),
                "healthy_pct_a":  da["healthy_pct"],
                "healthy_pct_b":  db["healthy_pct"],
                "at_risk_pct_a":  da["at_risk_pct"],
                "at_risk_pct_b":  db["at_risk_pct"],
                "degraded_pct_a": da["degraded_pct"],
                "degraded_pct_b": db["degraded_pct"],
                "cleared_pct_a":  da["cleared_pct"],
                "cleared_pct_b":  db["cleared_pct"],
                "ndvi_mean_a":    da["ndvi_mean"],
                "ndvi_mean_b":    db["ndvi_mean"],
                "total_area_ha":  da["total_area_ha"],
                "forest_lost_pct": forest_lost,
                "risk_score_b":   score_b,
                "alert_level_b":  alert_b["level"],
            })
        except (KeyError, TypeError) as exc:
            print(f"⚠️  Zone build ({lat:.4f},{lng:.4f}): {exc}")
            skipped_gee += 1

    print(f"✓ WorldCover: {wc_filtered_count} zones pre-filtered, "
          f"{len(raw_zones)} candidates remain ({skipped_gee} GEE failures)")

    if not raw_zones:
        raise HTTPException(
            status_code=422,
            detail=(
                f"All grid points failed or were non-forest for "
                f"{req.forest_name!r} {req.year_a}→{req.year_b}. "
                "GEE may have no imagery or WorldCover shows no tree cover here."
            ),
        )

    # ────────────────────────────────────────────────────
    # STEP 3: NDVI pre-rank — take top 8 by forest_lost_pct before Gemini
    # ────────────────────────────────────────────────────
    raw_zones.sort(key=lambda z: z["forest_lost_pct"], reverse=True)
    gemini_candidates = raw_zones[:8]  # Gemini sees at most 8 zones

    print(f"✓ NDVI pre-rank: {len(raw_zones)} → {len(gemini_candidates)} candidates "
          f"sent to Gemini Vision")

    # ────────────────────────────────────────────────────
    # STEP 4a: Get tile URLs for Gemini candidates (concurrent GEE)
    # ────────────────────────────────────────────────────
    def _safe_tile_urls(lat, lng):
        try:
            return get_natural_tile_urls(
                lat, lng, req.year_a, req.year_b, req.radius_km,
                date_start_a=req.date_start_a, date_end_a=req.date_end_a,
                date_start_b=req.date_start_b, date_end_b=req.date_end_b,
            )
        except Exception as exc:
            print(f"⚠️  Tile URL ({lat:.4f},{lng:.4f}): {exc}")
            return '', ''

    tile_tasks = [
        loop.run_in_executor(_executor, _safe_tile_urls, z["lat"], z["lng"])
        for z in gemini_candidates
    ]
    tile_results = await asyncio.gather(*tile_tasks)

    print(f"✓ Tile URLs ready in {time.time()-t0:.1f}s — "
          f"starting Gemini Vision ({len(gemini_candidates)} zones)…")

    # ────────────────────────────────────────────────────
    # STEP 4b: Gemini Vision — sequential, max 8 calls, 4 s delay
    # ────────────────────────────────────────────────────
    gemini_results: list[dict | None] = []
    for i, (zone, (url_a, url_b)) in enumerate(zip(gemini_candidates, tile_results)):
        if i > 0:
            await asyncio.sleep(4)  # free-tier ~15 RPM
        if not url_a or not url_b:
            print(f"  ⏩ Zone {i+1}/{len(gemini_candidates)} "
                  f"({zone['lat']:.4f},{zone['lng']:.4f}): no tile URLs")
            gemini_results.append(None)
            continue
        print(f"  ➤ Gemini {i+1}/{len(gemini_candidates)} "
              f"({zone['lat']:.4f},{zone['lng']:.4f})…")
        result = await loop.run_in_executor(
            _executor,
            gemini_analyze_forest_zone,
            url_a, url_b, zone["lat"], zone["lng"],
        )
        gemini_results.append(result)

    # ────────────────────────────────────────────────────
    # STEP 4c: Filter + rank by Gemini severity
    # ────────────────────────────────────────────────────
    confirmed_zones: list[dict] = []
    discarded = 0

    for zone, gemini_res in zip(gemini_candidates, gemini_results):
        if gemini_res is None:
            # Tile/Gemini failure — retain with no Gemini fields, rank last
            zone.update({
                "gemini_rank": None, "is_forest_zone": None,
                "forest_loss_detected": None, "forest_type": None,
                "canopy_loss_severity": None, "estimated_loss_pct": None,
                "gemini_confidence": None, "observation": None,
                "discard_reason": None,
            })
            confirmed_zones.append(zone)
            continue

        is_forest   = gemini_res.get("is_forest_zone", False)
        discard_why = gemini_res.get("discard_reason")

        if not is_forest or discard_why:
            discarded += 1
            print(f"  ✘ Gemini discarded ({zone['lat']:.4f},{zone['lng']:.4f}): "
                  f"forest={is_forest} reason={discard_why!r}")
            continue

        zone.update({
            "gemini_rank":          None,
            "is_forest_zone":       gemini_res.get("is_forest_zone"),
            "forest_loss_detected": gemini_res.get("forest_loss_detected"),
            "forest_type":          gemini_res.get("forest_type"),
            "canopy_loss_severity": gemini_res.get("canopy_loss_severity"),
            "estimated_loss_pct":   gemini_res.get("estimated_loss_pct"),
            "gemini_confidence":    gemini_res.get("confidence"),
            "observation":          gemini_res.get("observation"),
            "discard_reason":       gemini_res.get("discard_reason"),
        })
        confirmed_zones.append(zone)

    # Rank by severity → estimated_loss_pct
    def _sort_key(z):
        sev  = SEVERITY_RANK.get(z.get("canopy_loss_severity") or "None", 0)
        loss = z.get("estimated_loss_pct") or 0
        return (sev, loss)

    confirmed_zones.sort(key=_sort_key, reverse=True)
    for i, z in enumerate(confirmed_zones):
        z["gemini_rank"] = i + 1

    top_zones = confirmed_zones[:8]
    hot_zones = [HotZone(**z) for z in top_zones]

    elapsed = round(time.time() - t0, 1)
    now_iso = datetime.now(timezone.utc).isoformat()

    print(f"✓ HotZones done in {elapsed}s: "
          f"{n} grid, {wc_filtered_count} WC-filtered, "
          f"{discarded} Gemini-discarded, "
          f"{len(confirmed_zones)} confirmed → {len(hot_zones)} returned")

    # ────────────────────────────────────────────────────
    # STEP 4d: Save to 7-day cache
    # ────────────────────────────────────────────────────
    cache_payload = {
        "forest_name":        req.forest_name,
        "year_a":             req.year_a,
        "year_b":             req.year_b,
        "label_a":            req.label_a or str(req.year_a),
        "label_b":            req.label_b or str(req.year_b),
        "total_scanned":      n,
        "ai_verified":        True,
        "zones_discarded":    discarded,
        "worldcover_filtered": wc_filtered_count,
        "scan_message":       "Scanned with AI Vision — WorldCover pre-filter + Gemini visual analysis",
        "cached_at":          now_iso,
        "zones":              [z.model_dump() for z in hot_zones],
    }
    _write_hotzones_cache(ckey, cache_payload)

    return HotZonesResponse(
        zones=hot_zones,
        forest_name=req.forest_name,
        year_a=req.year_a,
        year_b=req.year_b,
        label_a=req.label_a or str(req.year_a),
        label_b=req.label_b or str(req.year_b),
        total_scanned=n,
        ai_verified=True,
        zones_discarded=discarded,
        worldcover_filtered=wc_filtered_count,
        scan_message="Scanned with AI Vision — WorldCover pre-filter + Gemini visual analysis",
        cached=False,
        cached_at=now_iso,
    )
