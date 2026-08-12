import { useState } from 'react'
import { saveAnalyzeAsParcel, saveCompareAsParcel } from '../lib/parcels'

export default function SaveParcelButton(props) {
  const { mode, lat, lng, radiusKm } = props
  const [naming, setNaming]   = useState(false)
  const [name, setName]       = useState('')
  const [status, setStatus]   = useState('idle') // idle | saving | saved | error
  const [errorMsg, setErrorMsg] = useState('')

  const handleSave = async () => {
    if (!name.trim()) return
    setStatus('saving')
    setErrorMsg('')
    try {
      if (mode === 'analyze') {
        await saveAnalyzeAsParcel({
          name: name.trim(), lat, lng, radiusKm,
          year: props.year, stats: props.stats,
          alertLevel: props.alertLevel, riskScore: props.riskScore,
          raw: props.raw,
        })
      } else {
        await saveCompareAsParcel({
          name: name.trim(), lat, lng, radiusKm,
          yearA: props.yearA, statsA: props.statsA,
          yearB: props.yearB, statsB: props.statsB,
          alertLevel: props.alertLevel, riskScore: props.riskScore,
          raw: props.raw,
        })
      }
      setStatus('saved')
    } catch (err) {
      setStatus('error')
      setErrorMsg(err.message || 'Could not save.')
    }
  }

  const boxStyle = {
    padding: '10px 14px',
    borderRadius: 8,
    fontFamily: "'Inter', sans-serif",
    fontSize: 12,
  }

  if (status === 'saved') {
    return (
      <div style={{ ...boxStyle, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ade80' }}>
        Saved as "{name}"
      </div>
    )
  }

  if (naming) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          type="text"
          placeholder="Parcel name"
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
          style={{
            padding: '9px 12px',
            background: 'rgba(34,197,94,0.08)',
            border: '1.5px solid rgba(34,197,94,0.25)',
            borderRadius: 8,
            color: '#e2f5e8',
            fontFamily: "'Inter', sans-serif",
            fontSize: 12,
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleSave} disabled={status === 'saving' || !name.trim()} style={{
            flex: 1, padding: '9px',
            background: 'linear-gradient(135deg, rgba(34,197,94,0.25) 0%, rgba(22,163,74,0.2) 100%)',
            border: '1px solid rgba(34,197,94,0.4)', borderRadius: 8,
            color: '#4ade80', fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 600,
            cursor: status === 'saving' ? 'default' : 'pointer',
          }}>
            {status === 'saving' ? 'Saving...' : 'Confirm'}
          </button>
          <button onClick={() => { setNaming(false); setStatus('idle') }} style={{
            padding: '9px 14px', background: 'transparent',
            border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8,
            color: '#9ca3af', fontFamily: "'Inter', sans-serif", fontSize: 12, cursor: 'pointer',
          }}>
            Cancel
          </button>
        </div>
        {status === 'error' && <div style={{ fontSize: 11, color: '#ef4444' }}>{errorMsg}</div>}
      </div>
    )
  }

  return (
    <button onClick={() => setNaming(true)} style={{
      ...boxStyle,
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.15)',
      color: '#9ca3af', fontWeight: 500, cursor: 'pointer', textAlign: 'left',
    }}>
      Save to my parcels
    </button>
  )
}