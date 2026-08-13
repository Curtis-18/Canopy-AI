import { useState } from 'react'
import { scanParcelHotZones, getMapTiles } from '../api'
import { ZoneCard, ScanningLoader } from './HotZonesPanel'

export default function ParcelHotZonesPanel({ lat, lng, radiusKm, yearA, yearB, onFlyTo, onShowSatCompare, onSetCircle }) {
  const [scanning, setScanning]   = useState(false)
  const [zones, setZones]         = useState(null)
  const [error, setError]         = useState(null)
  const [selected, setSelected]   = useState(null)
  const [loadingIdx, setLoadingIdx] = useState(null)
  const [scanMeta, setScanMeta]   = useState(null)

  const runScan = async (forceRefresh = false) => {
    setScanning(true)
    setZones(null)
    setError(null)
    setSelected(null)
    setScanMeta(null)
    try {
      const result = await scanParcelHotZones(lat, lng, yearA.year, yearB.year, radiusKm, {
        date_start_a: yearA.dateStart, date_end_a: yearA.dateEnd, label_a: yearA.label,
        date_start_b: yearB.dateStart, date_end_b: yearB.dateEnd, label_b: yearB.label,
        force_refresh: forceRefresh,
      })
      setZones(result.zones)
      setScanMeta({
        discarded:  result.zones_discarded || 0,
        wc_filtered: result.worldcover_filtered || 0,
        cached: result.cached || false,
      })
    } catch {
      setError('Scan failed. Is the backend running?')
    } finally {
      setScanning(false)
    }
  }

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
      const tiles = await getMapTiles(zone.lat, zone.lng, yearA.year, yearB.year, 2, {
        date_start_a: yearA.dateStart, date_end_a: yearA.dateEnd, label_a: yearA.label,
        date_start_b: yearB.dateStart, date_end_b: yearB.dateEnd, label_b: yearB.label,
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
      onShowSatCompare({ zone, statsA, statsB, yearA: yearA.label, yearB: yearB.label }, tiles)
    } catch (e) {
      console.error('Tile fetch failed', e)
    } finally {
      setLoadingIdx(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, height: 1, background: 'rgba(34,197,94,0.1)' }} />
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: '#4b5563', letterSpacing: 1 }}>
          HOTSPOT SCAN
        </span>
        <div style={{ flex: 1, height: 1, background: 'rgba(34,197,94,0.1)' }} />
      </div>

      {radiusKm < 1 && !zones && !scanning && (
        <div style={{
          padding: '12px 14px', background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
          fontSize: 11, color: '#6b7280', lineHeight: 1.6,
        }}>
          Hotspot scanning needs at least a 1km radius to find distinct sub-zones. Increase the radius above to enable this.
        </div>
      )}

      {radiusKm >= 1 && !zones && !scanning && (
        <button
          onClick={() => runScan(false)}
          style={{
            padding: '13px 16px',
            background: 'linear-gradient(135deg, rgba(239,68,68,0.2) 0%, rgba(249,115,22,0.12) 100%)',
            border: '1.5px solid rgba(239,68,68,0.4)',
            borderRadius: 10,
            color: '#ef4444',
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Scan this area for hotspots
        </button>
      )}

      {scanning && <ScanningLoader yearA={yearA.label} yearB={yearB.label} />}

      {error && !scanning && (
        <div style={{
          padding: '12px 14px', background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10,
          fontSize: 12, color: '#ef4444', fontWeight: 500,
        }}>
          {error}
        </div>
      )}

      {zones && !scanning && (
        <>
          <div style={{
            fontFamily: "'Space Mono', monospace", fontSize: 8,
            color: '#4b5563', letterSpacing: 0.8,
          }}>
            {zones.length} zones ranked by change severity
            {scanMeta?.wc_filtered > 0 && ` · ${scanMeta.wc_filtered} non-forest pre-filtered`}
            {scanMeta?.discarded > 0 && ` · ${scanMeta.discarded} Gemini-discarded`}
          </div>

          {zones.map((zone, idx) => (
            <ZoneCard
              key={`${zone.lat}-${zone.lng}`}
              zone={zone}
              rank={zone.gemini_rank ?? (idx + 1)}
              yearA={yearA.label}
              yearB={yearB.label}
              selected={selected === idx}
              loadingTiles={loadingIdx === idx}
              onClick={() => handleZoneClick(zone, idx)}
            />
          ))}

          <button
            onClick={() => runScan(true)}
            style={{
              padding: '9px', background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8,
              color: '#9ca3af', fontFamily: "'Inter', sans-serif",
              fontSize: 11, cursor: 'pointer',
            }}
          >
            Re-scan
          </button>
        </>
      )}
    </div>
  )
}