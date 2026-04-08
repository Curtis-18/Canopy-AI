import { useState, useEffect, useRef } from 'react'
import AlertBadge from './AlertBadge'
import { scanHotZones, getMapTiles } from '../api'
import { YEAR_OPTIONS, resolveYear } from '../yearOptions'

// ── Severity colour palette ───────────────────────────────────────────────────
const SEVERITY_COLORS = {
  Critical: { bg: 'rgba(239,68,68,0.18)', border: 'rgba(239,68,68,0.55)', text: '#ef4444' },
  High: { bg: 'rgba(249,115,22,0.15)', border: 'rgba(249,115,22,0.5)', text: '#f97316' },
  Moderate: { bg: 'rgba(234,179,8,0.15)', border: 'rgba(234,179,8,0.5)', text: '#eab308' },
  Low: { bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.4)', text: '#22c55e' },
  None: { bg: 'rgba(107,114,128,0.1)', border: 'rgba(107,114,128,0.3)', text: '#6b7280' },
}

// ── Forest-type badge colours ─────────────────────────────────────────────────
const FOREST_TYPE_COLORS = {
  rainforest: { bg: 'rgba(5,150,105,0.2)', text: '#10b981' },
  woodland: { bg: 'rgba(22,163,74,0.15)', text: '#4ade80' },
  plantation: { bg: 'rgba(20,184,166,0.15)', text: '#2dd4bf' },
  regrowth: { bg: 'rgba(59,130,246,0.15)', text: '#60a5fa' },
  farmland: { bg: 'rgba(217,119,6,0.15)', text: '#f59e0b' },
  bare: { bg: 'rgba(107,114,128,0.15)', text: '#9ca3af' },
  unknown: { bg: 'rgba(99,102,241,0.15)', text: '#818cf8' },
}

const FORESTS = [
  'Mabira Forest',
  'Budongo Forest',
  'Kibale Forest',
  'Bwindi Forest',
  'Queen Elizabeth Nat. Park',
]

const FOREST_BACKEND_NAME = {
  'Mabira Forest': 'Mabira Forest',
  'Budongo Forest': 'Budongo Forest',
  'Kibale Forest': 'Kibale Forest',
  'Bwindi Forest': 'Bwindi Forest',
  'Queen Elizabeth Nat. Park': 'Queen Elizabeth',
}


// ── Mini before/after healthy bar ──────────────────────────────────────────────
function HealthBar({ pctA, pctB, yearA, yearB }) {
  const lostColor = pctB < pctA ? '#ef4444' : '#22c55e'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{
        fontFamily: "'Space Mono', monospace", fontSize: 8,
        color: '#4b5563', letterSpacing: 0.8, fontWeight: 600,
      }}>HEALTHY COVER (NDVI)</div>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        {/* Year A bar */}
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 8, fontFamily: "'Space Mono', monospace",
            color: '#22c55e', marginBottom: 2, letterSpacing: 0.5,
          }}>{yearA}</div>
          <div style={{
            height: 6, background: 'rgba(255,255,255,0.05)',
            borderRadius: 3, overflow: 'hidden',
          }}>
            <div style={{
              width: `${Math.max(0, pctA)}%`, height: '100%',
              background: 'linear-gradient(90deg, #16a34a, #22c55e)',
              borderRadius: 3, transition: 'width 0.6s ease',
            }} />
          </div>
          <div style={{
            fontSize: 9, fontFamily: "'Syne', sans-serif",
            fontWeight: 700, color: '#22c55e', marginTop: 2,
          }}>{pctA.toFixed(1)}%</div>
        </div>

        <div style={{ color: '#374151', fontSize: 10 }}>→</div>

        {/* Year B bar */}
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 8, fontFamily: "'Space Mono', monospace",
            color: lostColor, marginBottom: 2, letterSpacing: 0.5,
          }}>{yearB}</div>
          <div style={{
            height: 6, background: 'rgba(255,255,255,0.05)',
            borderRadius: 3, overflow: 'hidden',
          }}>
            <div style={{
              width: `${Math.max(0, pctB)}%`, height: '100%',
              background: pctB < pctA
                ? 'linear-gradient(90deg, #b91c1c, #ef4444)'
                : 'linear-gradient(90deg, #16a34a, #22c55e)',
              borderRadius: 3, transition: 'width 0.6s ease',
            }} />
          </div>
          <div style={{
            fontSize: 9, fontFamily: "'Syne', sans-serif",
            fontWeight: 700, color: lostColor, marginTop: 2,
          }}>{pctB.toFixed(1)}%</div>
        </div>
      </div>
    </div>
  )
}


// ── Severity chip ─────────────────────────────────────────────────────────────
function SeverityChip({ severity }) {
  const c = SEVERITY_COLORS[severity] || SEVERITY_COLORS.None
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 8px',
      background: c.bg, border: `1px solid ${c.border}`,
      borderRadius: 30,
    }}>
      <div style={{
        width: 5, height: 5, borderRadius: '50%',
        background: c.text, flexShrink: 0,
      }} />
      <span style={{
        fontFamily: "'Space Mono', monospace", fontSize: 8,
        fontWeight: 700, color: c.text, letterSpacing: 0.8,
      }}>{(severity || 'Unknown').toUpperCase()}</span>
    </div>
  )
}


// ── Forest type badge ─────────────────────────────────────────────────────────
function ForestTypeBadge({ type }) {
  const key = (type || 'unknown').toLowerCase()
  const c = FOREST_TYPE_COLORS[key] || FOREST_TYPE_COLORS.unknown
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 7px',
      background: c.bg, borderRadius: 4,
    }}>
      <span style={{
        fontFamily: "'Space Mono', monospace", fontSize: 8,
        fontWeight: 700, color: c.text, letterSpacing: 0.6,
      }}>{(type || 'unknown').toUpperCase()}</span>
    </div>
  )
}


// ── Zone card ─────────────────────────────────────────────────────────────────
function ZoneCard({ zone, rank, yearA, yearB, selected, loadingTiles, onClick }) {
  const severity = zone.canopy_loss_severity
  const sc = SEVERITY_COLORS[severity] || SEVERITY_COLORS.None
  const hasGemini = zone.is_forest_zone !== null && zone.is_forest_zone !== undefined
  const CONF_COLORS = { High: '#22c55e', Medium: '#eab308', Low: '#f97316' }
  const confColor = CONF_COLORS[zone.gemini_confidence] || '#6b7280'

  return (
    <div
      onClick={onClick}
      style={{
        cursor: 'pointer',
        padding: '14px 14px',
        background: selected
          ? `linear-gradient(135deg, ${sc.bg} 0%, rgba(249,115,22,0.06) 100%)`
          : 'rgba(255,255,255,0.02)',
        border: `1.5px solid ${selected ? sc.border : 'rgba(34,197,94,0.12)'}`,
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        rowGap: 9,
        transition: 'all 0.25s ease',
        animation: 'fadeUp 0.35s ease',
        animationFillMode: 'both',
        animationDelay: `${(rank - 1) * 0.04}s`,
        // no overflow:hidden — observation text must wrap freely
      }}
      onMouseEnter={e => {
        if (!selected) e.currentTarget.style.borderColor = 'rgba(34,197,94,0.3)'
        e.currentTarget.style.background = selected
          ? `linear-gradient(135deg, ${sc.bg} 0%, rgba(249,115,22,0.1) 100%)`
          : 'rgba(255,255,255,0.04)'
      }}
      onMouseLeave={e => {
        if (!selected) e.currentTarget.style.borderColor = 'rgba(34,197,94,0.12)'
        e.currentTarget.style.background = selected
          ? `linear-gradient(135deg, ${sc.bg} 0%, rgba(249,115,22,0.06) 100%)`
          : 'rgba(255,255,255,0.02)'
      }}
    >
      {/* ── Row 1: rank badge (left) + loading spinner (right) ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
          background: rank <= 3
            ? `linear-gradient(135deg, ${sc.bg} 0%, rgba(249,115,22,0.15) 100%)`
            : 'rgba(34,197,94,0.1)',
          border: `1.5px solid ${rank <= 3 ? sc.border : 'rgba(34,197,94,0.25)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 800,
          color: rank <= 3 ? sc.text : '#4ade80',
        }}>
          {rank}
        </div>

        {loadingTiles && (
          <div style={{
            width: 16, height: 16, borderRadius: '50%',
            border: '2px solid rgba(34,197,94,0.2)',
            borderTop: '2px solid #22c55e',
            animation: 'spin 0.8s linear infinite',
          }} />
        )}
      </div>

      {/* ── Row 2: coordinates ── */}
      <div style={{
        fontFamily: "'Space Mono', monospace", fontSize: 9,
        color: '#6b7280', letterSpacing: 0.8,
      }}>
        {zone.lat.toFixed(4)}°N &nbsp;{zone.lng.toFixed(4)}°E
      </div>

      {/* ── Row 3: severity chip + forest type badge ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
        {hasGemini ? (
          <>
            <SeverityChip severity={severity || 'None'} />
            {zone.forest_type && <ForestTypeBadge type={zone.forest_type} />}
          </>
        ) : (
          <div style={{
            fontFamily: "'Space Mono', monospace", fontSize: 8,
            color: '#4b5563', fontStyle: 'italic',
          }}>AI analysis unavailable</div>
        )}
      </div>

      {/* ── Row 4: AI confidence dot + label ── */}
      {zone.gemini_confidence && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: confColor, flexShrink: 0,
          }} />
          <div style={{
            fontFamily: "'Space Mono', monospace", fontSize: 8,
            color: confColor, letterSpacing: 0.5,
          }}>
            {zone.gemini_confidence.toUpperCase()} CONFIDENCE
          </div>
        </div>
      )}

      {/* ── Row 5: Gemini observation — full word-wrap ── */}
      {zone.observation && (
        <div style={{
          fontFamily: "'Inter', sans-serif", fontSize: 10,
          color: '#9ca3af', fontStyle: 'italic',
          lineHeight: 1.6,
          padding: '7px 10px',
          background: 'rgba(255,255,255,0.03)',
          borderLeft: `2px solid ${sc.border}`,
          borderRadius: '0 6px 6px 0',
          whiteSpace: 'normal',
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
        }}>
          "{zone.observation}"
        </div>
      )}

      {/* ── Row 6: NDVI health bar ── */}
      <HealthBar
        pctA={zone.healthy_pct_a} pctB={zone.healthy_pct_b}
        yearA={yearA} yearB={yearB}
      />

      {/* ── Row 7: NDVI risk label + alert badge ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{
          fontFamily: "'Space Mono', monospace", fontSize: 7,
          color: '#374151', letterSpacing: 0.5,
        }}>NDVI RISK</div>
        <AlertBadge level={zone.alert_level_b} score={zone.risk_score_b} />
      </div>
    </div>
  )
}


// ── AI Vision loading state ───────────────────────────────────────────────────
function ScanningLoader({ yearA, yearB }) {
  const TOTAL_SECS = 105  // ~25 zones × 4 s + GEE overhead
  const [secsLeft, setSecsLeft] = useState(TOTAL_SECS)
  const intervalRef = useRef(null)

  useEffect(() => {
    setSecsLeft(TOTAL_SECS)
    intervalRef.current = setInterval(() => {
      setSecsLeft(s => {
        if (s <= 1) { clearInterval(intervalRef.current); return 0 }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(intervalRef.current)
  }, [])

  const progress = Math.max(0, Math.round((TOTAL_SECS - secsLeft) / TOTAL_SECS * 100))
  const mins = Math.floor(secsLeft / 60)
  const secs = secsLeft % 60
  const etaStr = mins > 0
    ? `~${mins}m ${secs}s remaining`
    : secsLeft > 0 ? `~${secsLeft}s remaining` : 'Finalising…'

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 18, padding: '36px 20px', textAlign: 'center',
    }}>
      {/* Pulsing eye icon */}
      <div style={{ fontSize: 34, animation: 'pulse 1.8s ease-in-out infinite' }}>🔍</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{
          fontFamily: "'Space Mono', monospace", fontSize: 11,
          fontWeight: 700, color: '#22c55e', letterSpacing: 1, lineHeight: 1.6,
        }}>
          Scanning 25 zones with Canopy AI
        </div>
        <div style={{
          fontFamily: "'Inter', sans-serif", fontSize: 11,
          color: '#4b5563', lineHeight: 1.5,
        }}>
          Identifying genuine forest canopy loss<br />
          <span style={{ fontSize: 10, color: '#374151' }}>
            across {yearA} → {yearB}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ width: '100%', maxWidth: 240 }}>
        <div style={{
          height: 4, background: 'rgba(34,197,94,0.1)',
          borderRadius: 2, overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${progress}%`,
            background: 'linear-gradient(90deg, #166534, #22c55e, #4ade80)',
            borderRadius: 2,
            transition: 'width 1s linear',
          }} />
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          marginTop: 6,
        }}>
          <div style={{
            fontFamily: "'Space Mono', monospace", fontSize: 8,
            color: '#22c55e', letterSpacing: 1, fontWeight: 600,
          }}>{progress}% complete</div>
          <div style={{
            fontFamily: "'Space Mono', monospace", fontSize: 8,
            color: '#4b5563', letterSpacing: 0.5,
          }}>{etaStr}</div>
        </div>
      </div>

      {/* What Gemini is doing */}
      <div style={{
        padding: '8px 12px',
        background: 'rgba(34,197,94,0.05)',
        border: '1px solid rgba(34,197,94,0.12)',
        borderRadius: 8, maxWidth: 240,
      }}>
        <div style={{
          fontFamily: "'Space Mono', monospace", fontSize: 8,
          color: '#4b5563', letterSpacing: 0.8, lineHeight: 1.8,
        }}>
          Canopy AI is inspecting each zone's<br />
          satellite imagery to distinguish real<br />
          forest canopy from farmland &amp; scrub
        </div>
      </div>
    </div>
  )
}


// ── Main component ────────────────────────────────────────────────────────────
export default function HotZonesPanel({ onFlyTo, onShowSatCompare, onSetCircle }) {
  const [forest, setForest] = useState('')
  const [yearA, setYearA] = useState('')
  const [yearB, setYearB] = useState('')
  const [scanning, setScanning] = useState(false)
  const [zones, setZones] = useState(null)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [loadingIdx, setLoadingIdx] = useState(null)
  const [scanInfo, setScanInfo] = useState(null)
  const [scanMeta, setScanMeta] = useState(null)  // { discarded, ai_verified, wc_filtered, cached, cached_at }

  const canScan = forest && yearA && yearB && !scanning

  const runScan = async (forceRefresh = false) => {
    if (!forest || !yearA || !yearB) return
    setScanning(true)
    setZones(null)
    setError(null)
    setSelected(null)
    setScanMeta(null)

    const backendForest = FOREST_BACKEND_NAME[forest] || forest
    const ryA = resolveYear(yearA)
    const ryB = resolveYear(yearB)

    try {
      const result = await scanHotZones(backendForest, ryA.year, ryB.year, undefined, {
        date_start_a: ryA.dateStart, date_end_a: ryA.dateEnd, label_a: ryA.label,
        date_start_b: ryB.dateStart, date_end_b: ryB.dateEnd, label_b: ryB.label,
        force_refresh: forceRefresh,
      })
      setZones(result.zones)
      setScanInfo({ forestName: forest, ryA, ryB })
      setScanMeta({
        discarded: result.zones_discarded || 0,
        ai_verified: result.ai_verified || false,
        wc_filtered: result.worldcover_filtered || 0,
        cached: result.cached || false,
        cached_at: result.cached_at || null,
      })
    } catch (e) {
      setError('Scan failed. Is the backend running?')
    } finally {
      setScanning(false)
    }
  }

  const handleScan = () => runScan(false)

  const handleZoneClick = async (zone, idx) => {
    onFlyTo(zone.lat, zone.lng)
    onSetCircle({ lat: zone.lat, lng: zone.lng })

    if (selected === idx) {
      setSelected(null)
      onShowSatCompare(null, null)
      return
    }

    setSelected(idx)
    setLoadingIdx(idx)
    onShowSatCompare(null, null)

    try {
      const tiles = await getMapTiles(zone.lat, zone.lng, scanInfo.ryA.year, scanInfo.ryB.year, 2, {
        date_start_a: scanInfo.ryA.dateStart, date_end_a: scanInfo.ryA.dateEnd, label_a: scanInfo.ryA.label,
        date_start_b: scanInfo.ryB.dateStart, date_end_b: scanInfo.ryB.dateEnd, label_b: scanInfo.ryB.label,
      })
      const statsA = {
        healthy_pct: zone.healthy_pct_a, at_risk_pct: zone.at_risk_pct_a,
        degraded_pct: zone.degraded_pct_a, cleared_pct: zone.cleared_pct_a,
        ndvi_mean: zone.ndvi_mean_a, total_area_ha: zone.total_area_ha,
      }
      const statsB = {
        healthy_pct: zone.healthy_pct_b, at_risk_pct: zone.at_risk_pct_b,
        degraded_pct: zone.degraded_pct_b, cleared_pct: zone.cleared_pct_b,
        ndvi_mean: zone.ndvi_mean_b, total_area_ha: zone.total_area_ha,
      }
      onShowSatCompare({ zone, statsA, statsB, yearA: scanInfo.ryA.label, yearB: scanInfo.ryB.label }, tiles)
    } catch (e) {
      console.error('Tile fetch failed', e)
    } finally {
      setLoadingIdx(null)
    }
  }

  const selectStyle = {
    width: '100%',
    padding: '9px 12px',
    background: 'rgba(34,197,94,0.08)',
    border: '1.5px solid rgba(34,197,94,0.25)',
    borderRadius: 8,
    color: '#e2f5e8',
    fontFamily: "'Inter', sans-serif",
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: 500,
    outline: 'none',
  }

  const labelStyle = {
    fontSize: 10,
    color: '#4b5563',
    fontFamily: "'Space Mono', monospace",
    letterSpacing: 1,
    fontWeight: 600,
    display: 'block',
    marginBottom: 6,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── Controls ── */}
      <div style={{
        padding: '16px',
        borderBottom: '1px solid rgba(34,197,94,0.08)',
        display: 'flex', flexDirection: 'column', gap: 12,
        flexShrink: 0,
      }}>
        <label>
          <span style={labelStyle}>FOREST</span>
          <select
            value={forest}
            onChange={e => setForest(e.target.value)}
            disabled={scanning}
            style={selectStyle}
          >
            <option value="" disabled>Select forest</option>
            {FORESTS.map(f => (
              <option key={f} value={f} style={{ color: '#000', background: '#fff' }}>{f}</option>
            ))}
          </select>
        </label>

        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ flex: 1 }}>
            <span style={labelStyle}>BASELINE YEAR</span>
            <select
              value={yearA}
              onChange={e => setYearA(e.target.value)}
              disabled={scanning}
              style={selectStyle}
            >
              <option value="" disabled>Select year</option>
              {YEAR_OPTIONS.map(o => (
                <option key={o.value} value={String(o.value)} style={{ color: '#000', background: '#fff' }}>{o.label}</option>
              ))}
            </select>
          </label>

          <label style={{ flex: 1 }}>
            <span style={labelStyle}>COMPARE YEAR</span>
            <select
              value={yearB}
              onChange={e => setYearB(e.target.value)}
              disabled={scanning}
              style={selectStyle}
            >
              <option value="" disabled>Select year</option>
              {YEAR_OPTIONS.map(o => (
                <option key={o.value} value={String(o.value)} style={{ color: '#000', background: '#fff' }}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>

        <button
          onClick={handleScan}
          disabled={!canScan}
          style={{
            padding: '12px',
            background: canScan
              ? 'linear-gradient(135deg, rgba(239,68,68,0.25) 0%, rgba(249,115,22,0.15) 100%)'
              : 'rgba(34,197,94,0.04)',
            border: `1.5px solid ${canScan ? 'rgba(239,68,68,0.5)' : 'rgba(34,197,94,0.1)'}`,
            borderRadius: 10,
            color: canScan ? '#ef4444' : '#374151',
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            fontWeight: 700,
            cursor: canScan ? 'pointer' : 'not-allowed',
            transition: 'all 0.25s ease',
            letterSpacing: 0.3,
          }}
        >
          {scanning ? '🔍 AI Vision Scanning…' : '🔍 Scan with AI Vision'}
        </button>
      </div>

      {/* ── Body: loading / results / empty state ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {scanning && (
          <ScanningLoader yearA={yearA} yearB={yearB} />
        )}

        {error && !scanning && (
          <div style={{
            padding: '12px 14px',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: 10, fontSize: 12,
            color: '#ef4444', fontWeight: 500,
          }}>⚠️ {error}</div>
        )}

        {!scanning && !zones && !error && (
          <div style={{
            textAlign: 'center', marginTop: 30,
            color: '#374151',
            fontFamily: "'Space Mono', monospace", fontSize: 10,
            letterSpacing: 1, lineHeight: 2,
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
            SELECT A FOREST AND TWO<br />YEARS, THEN SCAN TO<br />FIND CRITICAL ZONES
            <div style={{
              marginTop: 14, padding: '8px 10px',
              background: 'rgba(34,197,94,0.05)',
              border: '1px solid rgba(34,197,94,0.1)',
              borderRadius: 8, fontSize: 8, lineHeight: 1.8, color: '#4b5563',
            }}>
              Canopy AI inspects every zone<br />
              to filter out farmland & scrub
            </div>
          </div>
        )}

        {zones && !scanning && (
          <>
            {/* Result header */}
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 4,
              padding: '8px 0 4px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{
                  fontFamily: "'Space Mono', monospace", fontSize: 10,
                  fontWeight: 700, color: '#22c55e', letterSpacing: 1.5,
                }}>
                  🔥 TOP {zones.length} FOREST LOSS ZONES
                </div>
                <div style={{
                  fontFamily: "'Space Mono', monospace", fontSize: 7,
                  color: '#22c55e', letterSpacing: 0.8,
                  padding: '2px 6px',
                  background: 'rgba(34,197,94,0.1)',
                  border: '1px solid rgba(34,197,94,0.25)',
                  borderRadius: 4,
                }}>
                  ✓ AI VERIFIED
                </div>
              </div>
              <div style={{
                fontFamily: "'Space Mono', monospace", fontSize: 8,
                color: '#4b5563', letterSpacing: 0.8,
              }}>
                {scanInfo?.forestName} · {scanInfo?.ryA?.label}→{scanInfo?.ryB?.label}
                {scanMeta?.wc_filtered > 0 && (
                  <span style={{ marginLeft: 8, color: '#374151' }}>
                    · {scanMeta.wc_filtered} non-forest pre-filtered
                  </span>
                )}
                {scanMeta?.discarded > 0 && (
                  <span style={{ marginLeft: 8, color: '#374151' }}>
                    · {scanMeta.discarded} Gemini-discarded
                  </span>
                )}
              </div>

              {/* Cache info banner */}
              {scanMeta?.cached && scanMeta?.cached_at && (() => {
                const d = new Date(scanMeta.cached_at)
                const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                const timeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                return (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 10px',
                    background: 'rgba(99,102,241,0.08)',
                    border: '1px solid rgba(99,102,241,0.2)',
                    borderRadius: 8, marginTop: 2,
                  }}>
                    <div style={{
                      fontFamily: "'Space Mono', monospace", fontSize: 8,
                      color: '#818cf8', letterSpacing: 0.5,
                    }}>
                      💾 Cached {dateStr} {timeStr}
                    </div>
                    <button
                      onClick={() => { if (!scanning) runScan(true) }}
                      disabled={scanning}
                      style={{
                        padding: '3px 8px',
                        background: 'rgba(99,102,241,0.15)',
                        border: '1px solid rgba(99,102,241,0.35)',
                        borderRadius: 5,
                        color: '#818cf8',
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 10, fontWeight: 600,
                        cursor: scanning ? 'not-allowed' : 'pointer',
                      }}
                    >
                      🔄 Refresh
                    </button>
                  </div>
                )
              })()}
            </div>

            {zones.map((zone, idx) => (
              <ZoneCard
                key={`${zone.lat}-${zone.lng}`}
                zone={zone}
                rank={zone.gemini_rank ?? (idx + 1)}
                yearA={scanInfo?.ryA?.label}
                yearB={scanInfo?.ryB?.label}
                selected={selected === idx}
                loadingTiles={loadingIdx === idx}
                onClick={() => handleZoneClick(zone, idx)}
              />
            ))}

            {/* Re-scan hint */}
            <div style={{
              textAlign: 'center', padding: '8px 0 4px',
              fontFamily: "'Space Mono', monospace",
              fontSize: 8, color: '#374151', letterSpacing: 1,
            }}>
              Change years or forest and scan again to update
            </div>
          </>
        )}
      </div>
    </div>
  )
}
