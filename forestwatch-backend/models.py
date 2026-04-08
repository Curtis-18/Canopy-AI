from pydantic import BaseModel
from typing import Optional, List


# ============================================================================
# DATA MODELS
# ============================================================================

class ForestStats(BaseModel):
    """Forest health statistics"""
    healthy_pct:   float
    at_risk_pct:   float
    degraded_pct:  float
    cleared_pct:   float
    total_area_ha: float
    ndvi_mean:     float


class RiskAlert(BaseModel):
    """Risk assessment alert"""
    level:   str    # "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
    score:   int    # 0-100
    message: str


class ForestInsight(BaseModel):
    """AI-generated forest insights from Gemini"""
    summary:               str
    likely_cause:          str
    severity_explanation:  str
    recommended_actions:   List[str]
    trend_assessment:      str


# ============================================================================
# REQUEST MODELS
# ============================================================================

class AnalyzeRequest(BaseModel):
    """Request to analyze forest health at a location"""
    lat:        float          # e.g. 0.45
    lng:        float          # e.g. 32.95
    year:       int   = 2024   # default to latest
    radius_km:  float = 5.0    # area to analyze around point
    # Optional date-range override (for monthly 2026 composites)
    date_start: Optional[str] = None  # e.g. '2026-01-01'
    date_end:   Optional[str] = None  # e.g. '2026-01-31'
    label:      Optional[str] = None  # display name, e.g. 'Jan 2026'


class CompareRequest(BaseModel):
    """Request to compare forest health between two years"""
    lat:       float
    lng:       float
    year_a:    int   = 2020   # baseline year
    year_b:    int   = 2024   # comparison year
    radius_km: float = 5.0
    # Optional date-range overrides for each period
    date_start_a: Optional[str] = None
    date_end_a:   Optional[str] = None
    label_a:      Optional[str] = None
    date_start_b: Optional[str] = None
    date_end_b:   Optional[str] = None
    label_b:      Optional[str] = None


# ============================================================================
# RESPONSE MODELS
# ============================================================================

class AnalyzeResponse(BaseModel):
    """Forest analysis response with statistics and AI insights"""
    location:    dict                         # {lat, lng, name}
    year:        int
    label:       Optional[str] = None         # display name (e.g. 'Jan 2026')
    stats:       ForestStats
    alert:       RiskAlert
    data_source: str
    insight:     Optional[ForestInsight] = None


class CompareResponse(BaseModel):
    """Year-over-year forest comparison response"""
    location:        dict
    year_a:          int
    year_b:          int
    label_a:         Optional[str] = None
    label_b:         Optional[str] = None
    stats_a:         ForestStats
    stats_b:         ForestStats
    forest_lost_pct: float
    forest_lost_ha:  float
    alert:           RiskAlert
    change_summary:  str
    insight:         Optional[ForestInsight] = None


# ============================================================================
# ON-DEMAND INSIGHT MODELS
# ============================================================================

class InsightRequest(BaseModel):
    """Request for on-demand AI insight generation"""
    lat:            float
    lng:            float
    year:           int
    location_name:  str
    healthy_pct:    float
    at_risk_pct:    float
    degraded_pct:   float
    cleared_pct:    float
    total_area_ha:  float
    ndvi_mean:      float
    alert_level:    str
    risk_score:     int
    # Optional comparison fields
    year_a:         Optional[int]   = None
    year_b:         Optional[int]   = None
    forest_lost_ha: Optional[float] = None
    healthy_pct_a:  Optional[float] = None
    healthy_pct_b:  Optional[float] = None


class InsightResponse(BaseModel):
    """Response containing AI-generated insights"""
    insight: Optional[ForestInsight] = None
    error:   Optional[str]          = None


# ============================================================================
# HOT ZONES MODELS
# ============================================================================

class GeminiZoneAnalysis(BaseModel):
    """Structured output returned by Gemini Vision for a single grid zone."""
    is_forest_zone:       bool
    forest_loss_detected: bool
    forest_type:          str            # rainforest|woodland|plantation|regrowth|farmland|bare|unknown
    canopy_loss_severity: str            # None|Low|Moderate|High|Critical
    estimated_loss_pct:   int            # 0-100
    confidence:           str            # High|Medium|Low
    observation:          str
    discard_reason:       Optional[str]  # null or reason string

class HotZonesRequest(BaseModel):
    """Request to scan a forest grid and find the worst-hit zones."""
    forest_name:   str
    year_a:        int
    year_b:        int
    radius_km:     float = 2.0
    force_refresh: bool  = False  # bypass 7-day cache when True
    # Optional date-range overrides (for monthly 2026 composites)
    date_start_a: Optional[str] = None
    date_end_a:   Optional[str] = None
    label_a:      Optional[str] = None
    date_start_b: Optional[str] = None
    date_end_b:   Optional[str] = None
    label_b:      Optional[str] = None


class HotZone(BaseModel):
    """A single high-loss zone found by the grid scan."""
    lat:             float
    lng:             float
    healthy_pct_a:   float
    healthy_pct_b:   float
    at_risk_pct_a:   float
    at_risk_pct_b:   float
    degraded_pct_a:  float
    degraded_pct_b:  float
    cleared_pct_a:   float
    cleared_pct_b:   float
    ndvi_mean_a:     float
    ndvi_mean_b:     float
    total_area_ha:   float
    forest_lost_pct: float
    risk_score_b:    int
    alert_level_b:   str
    # ── Gemini Vision fields (set when AI vision analysis succeeded) ──
    gemini_rank:          Optional[int]  = None  # 1-based rank from Gemini severity
    is_forest_zone:       Optional[bool] = None
    forest_loss_detected: Optional[bool] = None
    forest_type:          Optional[str]  = None  # rainforest|woodland|plantation|regrowth|farmland|bare|unknown
    canopy_loss_severity: Optional[str]  = None  # None|Low|Moderate|High|Critical
    estimated_loss_pct:   Optional[int]  = None  # 0-100
    gemini_confidence:    Optional[str]  = None  # High|Medium|Low
    observation:          Optional[str]  = None
    discard_reason:       Optional[str]  = None


class HotZonesResponse(BaseModel):
    """Response from the /hotzones endpoint."""
    zones:                List[HotZone]
    forest_name:          str
    year_a:               int
    year_b:               int
    label_a:              Optional[str] = None
    label_b:              Optional[str] = None
    total_scanned:        int
    ai_verified:          bool          = False
    zones_discarded:      int           = 0      # discarded by Gemini (not forest)
    worldcover_filtered:  int           = 0      # discarded by WorldCover pre-filter
    scan_message:         Optional[str] = None
    cached:               bool          = False  # True if result came from cache
    cached_at:            Optional[str] = None   # ISO timestamp of when cached
