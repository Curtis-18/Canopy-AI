import StatBar from './StatBar'

export default function StatsPanel({ stats, ndvi, year, loading }) {
  if (loading) return (
    <div style={{
      padding: 32,
      textAlign: 'center',
      color: '#4b5563',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
    }}>
      <div>
        <div style={{ fontSize: 28, marginBottom: 12, animation: 'pulse 1.5s ease-in-out infinite' }}>🛰️</div>
        <div style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: 11,
          letterSpacing: 1,
          fontWeight: 600,
        }}>
          ANALYZING SATELLITE DATA...
        </div>
      </div>
    </div>
  )

  if (!stats) return (
    <div style={{
      padding: 20,
      textAlign: 'center',
      color: '#4b5563',
      fontFamily: "'Space Mono', monospace",
      fontSize: 11,
    }}>
      ⚠️ No satellite data available
    </div>
  )

  return (
    <div className="fade-up">
      {/* NDVI + Area */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        padding: '14px 16px',
        background: 'linear-gradient(135deg, rgba(34,197,94,0.1) 0%, rgba(34,197,94,0.05) 100%)',
        border: '1px solid rgba(34,197,94,0.15)',
        borderRadius: 12,
        backdropFilter: 'blur(8px)',
      }}>
        <div>
          <div style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 9,
            color: '#4b5563',
            letterSpacing: 1.2,
            fontWeight: 600,
            marginBottom: 4,
          }}>
            MEAN NDVI · {year}
          </div>
          <div style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 24,
            fontWeight: 800,
            color: '#4ade80',
            letterSpacing: '-1px',
          }}>
            {ndvi?.toFixed(3)}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 9,
            color: '#4b5563',
            letterSpacing: 1.2,
            fontWeight: 600,
            marginBottom: 4,
          }}>
            TOTAL AREA
          </div>
          <div style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 18,
            color: '#e2f5e8',
            fontWeight: 700,
            letterSpacing: '-0.5px',
          }}>
            {stats.total_area_ha} <span style={{ fontSize: 12, fontWeight: 500 }}>ha</span>
          </div>
        </div>
      </div>

      {/* Land cover breakdown */}
      <div style={{ marginTop: 16 }}>
        <div style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: 9,
          color: '#4b5563',
          letterSpacing: 1.2,
          fontWeight: 600,
          marginBottom: 12,
          textTransform: 'uppercase',
        }}>
          Land Cover Distribution
        </div>
        <StatBar label="Healthy Forest" pct={stats.healthy_pct} color="#22c55e" icon="🌲" />
        <StatBar label="At Risk"        pct={stats.at_risk_pct} color="#f59e0b" icon="⚠️" />
        <StatBar label="Degraded"       pct={stats.degraded_pct} color="#f97316" icon="📉" />
        <StatBar label="Cleared / Lost" pct={stats.cleared_pct} color="#ef4444" icon="❌" />
      </div>

      {/* Analysis resolution note */}
      {stats.analysis_scale_m && (
        <div style={{
          marginTop: 14,
          fontFamily: "'Space Mono', monospace",
          fontSize: 9,
          color: '#4b5563',
          letterSpacing: 0.5,
          textAlign: 'right',
        }}>
          Analysis resolution: {stats.analysis_scale_m}m — clearings under 1ha may not be detected
        </div>
      )}
    </div>
  )
}