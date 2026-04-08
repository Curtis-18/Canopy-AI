"""
Canopy AI — Automated Weekly Forest Scanner
Runs background scans on all monitored forests and generates deforestation alerts.
"""

import json
import os
import threading
import uuid
from datetime import datetime, timezone


from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from analyzer import (
    FORESTS, FOREST_PROXIMITY,
    analyze_location_gee as analyze,
    uganda_risk_score,
    score_to_alert,
)

# ============================================================================
# PERSISTENCE — scan_history.json
# ============================================================================

HISTORY_PATH = os.path.join(os.path.dirname(__file__), "scan_history.json")
_store_lock = threading.Lock()


def _read_store() -> dict:
    """Read scan history from disk."""
    if not os.path.exists(HISTORY_PATH):
        return {"scans": [], "alerts": []}
    try:
        with open(HISTORY_PATH, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return {"scans": [], "alerts": []}


def _write_store(data: dict):
    """Write scan history to disk."""
    with open(HISTORY_PATH, "w") as f:
        json.dump(data, f, indent=2, default=str)


# ============================================================================
# SCAN LOGIC
# ============================================================================

# Alert thresholds
HEALTHY_DROP_THRESHOLD = 2.0    # percentage-point drop
RISK_INCREASE_THRESHOLD = 10   # risk-score-point increase


def _get_previous_scan(store: dict, forest_name: str) -> dict | None:
    """Find the most recent scan for a given forest."""
    for scan in reversed(store["scans"]):
        if scan["forest_name"] == forest_name:
            return scan
    return None


def run_weekly_scan():
    """Scan all monitored forests and generate alerts for significant changes."""
    now = datetime.now(timezone.utc).isoformat()
    print(f"\n{'='*60}")
    print(f"🔍 Weekly Forest Scan — {now}")
    print(f"{'='*60}")

    with _store_lock:
        store = _read_store()

    new_scans = []
    new_alerts = []

    for forest_name, (lat, lng) in FORESTS.items():
        try:
            print(f"  Scanning {forest_name} ({lat}, {lng})...")
            data = analyze(lat, lng, 2025, 10.0)

            prox  = FOREST_PROXIMITY.get(forest_name, {})
            score = uganda_risk_score(
                data["cleared_pct"], data["degraded_pct"], data["ndvi_mean"],
                near_road=prox.get("near_road", False),
                near_settlement=prox.get("near_settlement", False),
            )
            alert_info = score_to_alert(score)

            scan_record = {
                "forest_name": forest_name,
                "lat": lat,
                "lng": lng,
                "scanned_at": now,
                "healthy_pct": data["healthy_pct"],
                "at_risk_pct": data["at_risk_pct"],
                "degraded_pct": data["degraded_pct"],
                "cleared_pct": data["cleared_pct"],
                "ndvi_mean": data["ndvi_mean"],
                "total_area_ha": data["total_area_ha"],
                "risk_score": score,
                "alert_level": alert_info["level"],
            }
            new_scans.append(scan_record)

            # Compare against previous scan
            prev = _get_previous_scan(store, forest_name)
            if prev:
                healthy_drop = prev["healthy_pct"] - data["healthy_pct"]
                risk_increase = score - prev["risk_score"]

                reasons = []
                if healthy_drop > HEALTHY_DROP_THRESHOLD:
                    reasons.append(
                        f"Healthy cover dropped {healthy_drop:.1f}% "
                        f"({prev['healthy_pct']}% → {data['healthy_pct']}%)"
                    )
                if risk_increase > RISK_INCREASE_THRESHOLD:
                    reasons.append(
                        f"Risk score increased {risk_increase} points "
                        f"({prev['risk_score']} → {score})"
                    )

                if reasons:
                    alert_record = {
                        "id": str(uuid.uuid4()),
                        "forest_name": forest_name,
                        "lat": lat,
                        "lng": lng,
                        "detected_at": now,
                        "alert_level": alert_info["level"],
                        "risk_score": score,
                        "message": "; ".join(reasons),
                        "healthy_pct_prev": prev["healthy_pct"],
                        "healthy_pct_now": data["healthy_pct"],
                        "risk_score_prev": prev["risk_score"],
                        "risk_score_now": score,
                    }
                    new_alerts.append(alert_record)
                    print(f"    🚨 ALERT: {'; '.join(reasons)}")
                else:
                    print(f"    ✓ No significant change")
            else:
                print(f"    ✓ First scan recorded (baseline)")

        except Exception as e:
            print(f"    ✗ Error scanning {forest_name}: {e}")

    # Persist results
    with _store_lock:
        store = _read_store()  # re-read in case another thread wrote
        store["scans"].extend(new_scans)
        store["alerts"].extend(new_alerts)
        _write_store(store)

    print(f"\n✓ Scan complete — {len(new_scans)} forests scanned, {len(new_alerts)} alerts generated")
    return {"scans": len(new_scans), "alerts": len(new_alerts)}


# ============================================================================
# PUBLIC API — read alerts
# ============================================================================

def get_all_alerts() -> list[dict]:
    """Return all alerts, sorted newest first."""
    store = _read_store()
    return sorted(store["alerts"], key=lambda a: a["detected_at"], reverse=True)


def get_recent_alerts(days: int = 7) -> list[dict]:
    """Return alerts from the last N days, sorted newest first."""
    from datetime import timedelta

    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    all_alerts = get_all_alerts()
    return [a for a in all_alerts if a["detected_at"] >= cutoff]


# ============================================================================
# SCHEDULER
# ============================================================================

_scheduler: BackgroundScheduler | None = None


def start_scheduler():
    """Start the weekly scan scheduler. Also runs one scan immediately."""
    global _scheduler
    _scheduler = BackgroundScheduler()
    _scheduler.add_job(
        run_weekly_scan,
        trigger=IntervalTrigger(weeks=1),
        id="weekly_forest_scan",
        name="Weekly Forest Scan",
        replace_existing=True,
    )
    _scheduler.start()
    print("✓ Weekly scan scheduler started")

    # Run initial scan in a background thread so it doesn't block startup
    threading.Thread(target=run_weekly_scan, daemon=True).start()


def stop_scheduler():
    """Stop the scheduler gracefully."""
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        print("✓ Scheduler stopped")
