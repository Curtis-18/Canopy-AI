import { useState, useEffect } from 'react'
import { getInsight } from '../api'

export default function InsightPanel({ analysisData }) {
  const [insight, setInsight]   = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  // Reset when analysisData changes (new location/params)
  useEffect(() => {
    setInsight(null)
    setLoading(false)
    setError(null)
  }, [analysisData?.lat, analysisData?.lng, analysisData?.year, analysisData?.year_a, analysisData?.year_b])

  if (!analysisData) return null

  const handleGetInsight = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getInsight(analysisData)
      if (res.insight) {
        setInsight(res.insight)
      } else {
        setError(res.error || 'No insight returned')
      }
    } catch  {
      setError('Failed to reach AI service. Try again later.')
    } finally {
      setLoading(false)
    }
  }



  return (
    <div className="fade-up" style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      marginTop: 16,
      maxHeight: '100%',
      overflow: 'auto',
      paddingRight: 8
    }}>

      {/* Divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, height: 1, background: 'rgba(34,197,94,0.1)' }} />
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: '#4b5563', letterSpacing: 1 }}>
          🤖 AI INSIGHT
        </span>
        <div style={{ flex: 1, height: 1, background: 'rgba(34,197,94,0.1)' }} />
      </div>

      {/* Button / Loading / Error / Result */}
      {!insight && !loading && (
        <button
          onClick={handleGetInsight}
          style={{
            padding: '14px 20px',
            background: 'linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(139,92,246,0.15) 100%)',
            border: '1px solid rgba(139,92,246,0.35)',
            borderRadius: 10,
            color: '#c4b5fd',
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            transition: 'all 0.3s ease',
            boxShadow: '0 4px 16px rgba(139,92,246,0.1)',
          }}
          onMouseOver={e => {
            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(99,102,241,0.35) 0%, rgba(139,92,246,0.25) 100%)'
            e.currentTarget.style.borderColor = 'rgba(139,92,246,0.5)'
            e.currentTarget.style.boxShadow = '0 6px 24px rgba(139,92,246,0.2)'
          }}
          onMouseOut={e => {
            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(139,92,246,0.15) 100%)'
            e.currentTarget.style.borderColor = 'rgba(139,92,246,0.35)'
            e.currentTarget.style.boxShadow = '0 4px 16px rgba(139,92,246,0.1)'
          }}
        >
          🤖 Get AI Insights
        </button>
      )}

      {loading && (
        <div style={{
          padding: '16px',
          textAlign: 'center',
          background: 'rgba(139,92,246,0.08)',
          borderRadius: 10,
          border: '1px solid rgba(139,92,246,0.15)',
        }}>
          <div style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 10,
            color: '#a78bfa',
            letterSpacing: 1,
            animation: 'pulse 1.5s infinite',
          }}>
            🤖 AI ANALYZING...
          </div>
        </div>
      )}

      {error && (
        <div style={{
          padding: '12px 14px',
          background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.25)',
          borderRadius: 10,
          fontSize: 12,
          color: '#fca5a5',
          lineHeight: 1.6,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          <span>⚠️ {error}</span>
          <button
            onClick={handleGetInsight}
            style={{
              padding: '8px 14px',
              background: 'rgba(239,68,68,0.15)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 6,
              color: '#fca5a5',
              fontSize: 11,
              cursor: 'pointer',
              fontWeight: 600,
              alignSelf: 'flex-start',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {insight && (
        <>
          {/* Summary */}
          <div style={{
            padding: '12px 14px',
            background: 'rgba(34,197,94,0.04)',
            border: '1px solid rgba(34,197,94,0.12)',
            borderRadius: 8,
            fontSize: 12,
            color: '#d1fae5',
            lineHeight: 1.7,
          }}>
            {insight.summary}
          </div>

          {/* Likely cause */}
          <div style={{
            padding: '10px 14px',
            background: 'rgba(245,158,11,0.06)',
            border: '1px solid rgba(245,158,11,0.15)',
            borderRadius: 8,
          }}>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: '#f59e0b', letterSpacing: 1, marginBottom: 4 }}>
              LIKELY CAUSE
            </div>
            <div style={{ fontSize: 12, color: '#fde68a' }}>
              {insight.likely_cause}
            </div>
          </div>

          {/* Recommended actions */}
          <div style={{
            padding: '10px 14px',
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(34,197,94,0.1)',
            borderRadius: 8,
          }}>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: '#4b5563', letterSpacing: 1, marginBottom: 8 }}>
              RECOMMENDED ACTIONS
            </div>
            {insight.recommended_actions.map((action, i) => (
              <div key={i} style={{
                display: 'flex', gap: 8,
                marginBottom: 6, alignItems: 'flex-start',
              }}>
                <div style={{
                  width: 16, height: 16, borderRadius: '50%',
                  background: 'rgba(34,197,94,0.15)',
                  border: '1px solid rgba(34,197,94,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: "'Space Mono', monospace",
                  fontSize: 8, color: '#4ade80',
                  flexShrink: 0, marginTop: 1,
                }}>
                  {i + 1}
                </div>
                <span style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.5 }}>
                  {action}
                </span>
              </div>
            ))}
          </div>

          {/* Trend */}
          <div style={{
            padding: '10px 14px',
            background: 'rgba(239,68,68,0.04)',
            border: '1px solid rgba(239,68,68,0.1)',
            borderRadius: 8,
            borderLeft: '3px solid rgba(239,68,68,0.4)',
            fontSize: 12,
            color: '#9ca3af',
            lineHeight: 1.6,
          }}>
            <span style={{ color: '#ef4444', fontWeight: 600 }}>Forecast: </span>
            {insight.trend_assessment}
          </div>
        </>
      )}
    </div>
  )
}