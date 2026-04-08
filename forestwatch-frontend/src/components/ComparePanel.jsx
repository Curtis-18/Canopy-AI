import AlertBadge from './AlertBadge'
import StatBar   from './StatBar'
import InsightPanel from './InsightPanel'

export default function ComparePanel({ data, loading, onShowSat }) {
  if (loading) return (
    <div style={{ padding: 24, textAlign: 'center', animation: 'fadeUp 0.3s ease' }}>
      <div style={{
        fontFamily: "'Space Mono', monospace",
        fontSize: 11,
        fontWeight: 600,
        color: '#22c55e',
        letterSpacing: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}>
        ⏳ COMPARING YEARS...
      </div>
    </div>
  )

  if (!data) return null

  const lost   = data.forest_lost_pct
  const lostHa = data.forest_lost_ha
  const labelA = data.label_a || String(data.year_a)
  const labelB = data.label_b || String(data.year_b)

  // Build insight request data for on-demand AI
  const insightData = data.alert ? {
    lat: data.location.lat,
    lng: data.location.lng,
    year: data.year_b,
    location_name: data.location.name || 'Unknown Forest',
    healthy_pct: data.stats_b.healthy_pct,
    at_risk_pct: data.stats_b.at_risk_pct,
    degraded_pct: data.stats_b.degraded_pct,
    cleared_pct: data.stats_b.cleared_pct,
    total_area_ha: data.stats_a.total_area_ha,
    ndvi_mean: data.stats_b.ndvi_mean,
    alert_level: data.alert.level,
    risk_score: data.alert.score,
    year_a: data.year_a,
    year_b: data.year_b,
    forest_lost_ha: data.forest_lost_ha,
    healthy_pct_a: data.stats_a.healthy_pct,
    healthy_pct_b: data.stats_b.healthy_pct,
  } : null

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Summary headline */}
      <div style={{
        padding: '18px 20px',
        background: lost > 0
          ? 'linear-gradient(135deg, rgba(239,68,68,0.15) 0%, rgba(239,68,68,0.08) 100%)'
          : 'linear-gradient(135deg, rgba(34,197,94,0.15) 0%, rgba(34,197,94,0.08) 100%)',
        backdropFilter: 'blur(10px)',
        border: `1px solid ${lost > 0 ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
        borderRadius: 10,
        boxShadow: `0 8px 32px ${lost > 0 ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)'}, inset 0 1px 0 rgba(255,255,255,0.05)`,
      }}>
        <div style={{
          fontFamily: "'Syne', sans-serif",
          fontSize: 24,
          fontWeight: 800,
          background: lost > 0 ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' : 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          marginBottom: 8,
        }}>
          {lost > 0 ? `▼ ${lost}%` : `▲ ${Math.abs(lost)}%`}
        </div>
        <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5, fontWeight: 500 }}>
          {lostHa > 0
            ? `📉 ${lostHa} hectares of forest lost between ${labelA} and ${labelB}`
            : `✅ Forest cover stable between ${labelA} and ${labelB}`
          }
        </div>
      </div>

      {/* Alert */}
      <AlertBadge
        level={data.alert.level}
        score={data.alert.score}
        message={data.alert.message}
        large
      />

      {/* Side by side year comparison */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[
          { year: labelA, stats: data.stats_a, label: 'BASELINE YEAR', emoji: '📍' },
          { year: labelB, stats: data.stats_b, label: 'COMPARE YEAR',  emoji: '📊' },
        ].map(({ year, stats, label, emoji }) => (
          <div key={year} style={{
            padding: '14px 16px',
            background: 'linear-gradient(135deg, rgba(34,197,94,0.1) 0%, rgba(34,197,94,0.05) 100%)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(34,197,94,0.2)',
            borderRadius: 8,
            boxShadow: '0 8px 32px rgba(34,197,94,0.08), inset 0 1px 0 rgba(255,255,255,0.05)',
          }}>
            <div style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 10,
              fontWeight: 600,
              color: '#22c55e',
              letterSpacing: 1.2,
              marginBottom: 12,
              textTransform: 'uppercase',
            }}>
              {emoji} {label} · {year}
            </div>

            <StatBar label="Healthy"  pct={stats.healthy_pct}  color="#22c55e" icon="🌲" />
            <StatBar label="At Risk"  pct={stats.at_risk_pct}  color="#f59e0b" icon="⚠️" />
            <StatBar label="Degraded" pct={stats.degraded_pct} color="#f97316" icon="📉" />
            <StatBar label="Cleared"  pct={stats.cleared_pct}  color="#ef4444" icon="❌" />

            <div style={{
              marginTop: 12,
              fontSize: 11,
              color: '#9ca3af',
              borderTop: '1px solid rgba(34,197,94,0.1)',
              paddingTop: 8,
            }}>
              📊 Total: {stats.total_area_ha} ha
            </div>
          </div>
        ))}
      </div>

      {/* Satellite before/after launcher */}
      {onShowSat && (
        <button
          onClick={onShowSat}
          style={{
            width:        '100%',
            padding:      '13px 16px',
            background:   'linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(22,163,74,0.08) 100%)',
            border:       '1.5px solid rgba(34,197,94,0.45)',
            borderRadius: 10,
            color:        '#4ade80',
            fontFamily:   "'Inter', sans-serif",
            fontSize:     13,
            fontWeight:   700,
            cursor:       'pointer',
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'center',
            gap:          8,
            letterSpacing: 0.2,
            transition:   'all 0.25s ease',
            boxShadow:    '0 4px 16px rgba(34,197,94,0.08)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background   = 'linear-gradient(135deg, rgba(34,197,94,0.22) 0%, rgba(22,163,74,0.16) 100%)'
            e.currentTarget.style.borderColor  = 'rgba(74,222,128,0.7)'
            e.currentTarget.style.boxShadow    = '0 6px 24px rgba(34,197,94,0.18)'
            e.currentTarget.style.transform    = 'translateY(-1px)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background   = 'linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(22,163,74,0.08) 100%)'
            e.currentTarget.style.borderColor  = 'rgba(34,197,94,0.45)'
            e.currentTarget.style.boxShadow    = '0 4px 16px rgba(34,197,94,0.08)'
            e.currentTarget.style.transform    = 'translateY(0)'
          }}
        >
          🛰️ View Before & After Satellite
        </button>
      )}

      {/* Change summary */}
      <div style={{
        padding: '14px 16px',
        background: 'linear-gradient(135deg, rgba(34,197,94,0.1) 0%, rgba(34,197,94,0.05) 100%)',
        backdropFilter: 'blur(8px)',
        borderRadius: 8,
        border: '1px solid rgba(34,197,94,0.2)',
        fontSize: 13,
        color: '#cbd5e1',
        lineHeight: 1.7,
        fontWeight: 500,
        borderLeft: '4px solid rgba(34,197,94,0.4)',
        boxShadow: '0 8px 32px rgba(34,197,94,0.08)',
      }}>
        {data.change_summary}
      </div>

      {/* On-demand AI Insight */}
      <InsightPanel analysisData={insightData} />
    </div>
  )
}