import { useState, useEffect } from 'react'
import { getSavedParcels } from '../lib/parcels'

export default function SavedParcelsPicker({ onSelect }) {
  const [parcels, setParcels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchParcels = () => {
    setLoading(true)
    setError(null)
    getSavedParcels()
      .then(setParcels)
      .catch((err) => setError(err.message || 'Could not load saved parcels.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    let cancelled = false

    getSavedParcels()
      .then((data) => {
        if (!cancelled) setParcels(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Could not load saved parcels.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const handleChange = (e) => {
    const id = e.target.value
    if (!id) return
    const parcel = parcels.find((p) => String(p.id) === id)
    if (parcel) onSelect(parcel)
  }

  return (
    <div style={{ padding: '0 16px 12px', borderBottom: '1px solid rgba(34,197,94,0.08)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div
          style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 9.5,
            color: '#4b5563',
            letterSpacing: 1,
          }}
        >
          OR PICK A SAVED PARCEL
        </div>
        <button
          onClick={fetchParcels}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#4ade80',
            fontSize: 11,
            cursor: 'pointer',
            fontFamily: "'Inter', sans-serif",
          }}
        >
          ↻
        </button>
      </div>

      {loading && (
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, color: '#4b5563' }}>Loading...</div>
      )}

      {!loading && error && (
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, color: '#ef4444' }}>{error}</div>
      )}

      {!loading && !error && parcels.length === 0 && (
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, color: '#4b5563' }}>
          No saved parcels yet.
        </div>
      )}

      {!loading && !error && parcels.length > 0 && (
        <select
          defaultValue=""
          onChange={handleChange}
          style={{
            width: '100%',
            background: 'rgba(34,197,94,0.12)',
            border: '1.5px solid rgba(34,197,94,0.3)',
            borderRadius: 8,
            padding: '10px 12px',
            color: '#e2f5e8',
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          <option value="" disabled style={{ color: '#000', background: '#fff' }}>
            Select a parcel
          </option>
          {parcels.map((p) => (
            <option key={p.id} value={String(p.id)} style={{ color: '#000', background: '#fff' }}>
              {p.name} · {Number(p.lat).toFixed(3)}, {Number(p.lng).toFixed(3)}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}