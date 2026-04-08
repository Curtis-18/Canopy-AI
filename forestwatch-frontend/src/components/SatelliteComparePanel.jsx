import { useState, useEffect, useCallback } from 'react'
import { Rectangle, useMapEvents } from 'react-leaflet'
import { getPhoto } from '../api'

// ─── Slippy-map helpers (kept for hotspot detection which uses change tile) ─────

function latLngToTile(lat, lng, zoom) {
  const n   = Math.pow(2, zoom)
  const x   = Math.floor(n * (lng + 180) / 360)
  const rad = lat * Math.PI / 180
  const y   = Math.floor(n * (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2)
  return { x, y }
}
function tileToLat(ty, z) {
  const n = Math.PI - 2 * Math.PI * ty / Math.pow(2, z)
  return (180 / Math.PI) * Math.atan(Math.sinh(n))
}
function tileToLng(tx, z) { return tx / Math.pow(2, z) * 360 - 180 }

// ─── Hotspot detection ────────────────────────────────────────────────────────

function loadImageCORS(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload  = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

async function detectHotspot(changeTileUrl, lat, lng, radiusKm) {
  const ZOOM = 11
  const { x, y } = latLngToTile(lat, lng, ZOOM)
  const url = changeTileUrl.replace('{z}', ZOOM).replace('{x}', x).replace('{y}', y)
  try {
    const img    = await loadImageCORS(url)
    const W = img.naturalWidth || 256, H = img.naturalHeight || 256
    const canvas = document.createElement('canvas')
    canvas.width = W; canvas.height = H
    canvas.getContext('2d').drawImage(img, 0, 0)
    const { data } = canvas.getContext('2d').getImageData(0, 0, W, H)

    const latTop = tileToLat(y, ZOOM), latBot = tileToLat(y + 1, ZOOM)
    const lngL   = tileToLng(x, ZOOM), lngR   = tileToLng(x + 1, ZOOM)
    const rDeg   = radiusKm / 111.1

    let best = 40, bx = W / 2, by = H / 2
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const i = (py * W + px) * 4
        const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3]
        if (a < 80) continue
        const pLat = latTop + (py / H) * (latBot - latTop)
        const pLng = lngL   + (px / W) * (lngR   - lngL)
        if (Math.hypot(pLat - lat, pLng - lng) > rDeg) continue
        const score = r - Math.max(g, b)
        if (score > best) { best = score; bx = px; by = py }
      }
    }
    if (best > 40) {
      return {
        coords:   [latTop + (by / H) * (latBot - latTop), lngL + (bx / W) * (lngR - lngL)],
        detected: true,
      }
    }
  } catch { /* CORS / load error — fall back to centre */ }
  return { coords: [lat, lng], detected: false }
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SatelliteComparePanel({
  yearA, yearB, statsA, statsB,
  tiles,           // { change, ndvi, risk, year_a, year_b, ... }
  selectedPoint,
  radiusKm,
  onClose,
  onNavigate,      // (lat, lng) => void — fly main map to that point
}) {
  const [hotspot,  setHotspot]  = useState(null)
  const [ready,    setReady]    = useState(false)
  const [status,   setStatus]   = useState('Locating critical loss zone…')
  const [photoA,   setPhotoA]   = useState(null)
  const [photoB,   setPhotoB]   = useState(null)
  const [photoErr, setPhotoErr] = useState(null)

  // Step 1: detect hotspot from change tile
  useEffect(() => {
    if (!selectedPoint) return
    setReady(false)
    setHotspot(null)
    setPhotoA(null)
    setPhotoB(null)
    setPhotoErr(null)
    setStatus('Locating critical loss zone…')

    const [lat, lng] = selectedPoint
    async function init() {
      let hs = { coords: [lat, lng], detected: false }
      if (tiles?.change) hs = await detectHotspot(tiles.change, lat, lng, radiusKm)
      setHotspot(hs)
      setReady(true)
    }
    init()
  }, [tiles?.change, selectedPoint?.[0], selectedPoint?.[1], radiusKm])

  // Step 2: fetch Sentinel Hub photos once hotspot is ready
  useEffect(() => {
    if (!ready || !selectedPoint) return

    const yearAInt = parseInt(String(yearA), 10) || new Date().getFullYear()
    const yearBInt = parseInt(String(yearB), 10) || new Date().getFullYear()
    const [lat, lng] = selectedPoint

    setStatus(`Fetching ${yearAInt} & ${yearBInt} satellite images…`)

    getPhoto(lat, lng, yearAInt, yearBInt)
      .then(data => {
        setPhotoA(data.photo_a)
        setPhotoB(data.photo_b)
        setStatus('')
      })
      .catch(err => {
        console.error('Photo fetch failed:', err)
        setPhotoErr('Could not load satellite images — backend unreachable')
        setStatus('')
      })
  }, [ready, selectedPoint?.[0], selectedPoint?.[1], yearA, yearB])

  if (!selectedPoint) return null

  const hotCoords = hotspot?.coords ?? selectedPoint
  const BOX       = 0.0028   // ≈ 300 m orange bounding box
  const boxBounds = [
    [hotCoords[0] - BOX, hotCoords[1] - BOX],
    [hotCoords[0] + BOX, hotCoords[1] + BOX],
  ]

  const yearAInt = parseInt(String(yearA), 10)
  const yearBInt = parseInt(String(yearB), 10)
  const photosLoading = ready && !photoA && !photoB && !photoErr

  return (
    <div style={{
      position: 'absolute', top: '50%', left: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: 1100, width: 'min(880px, 95vw)',
      background: 'linear-gradient(160deg, rgba(4,11,5,0.97) 0%, rgba(8,24,10,0.96) 100%)',
      border: '1px solid rgba(34,197,94,0.35)', borderRadius: 16,
      boxShadow: '0 32px 80px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.06)',
      backdropFilter: 'blur(20px)', overflow: 'hidden',
      animation: 'fadeUp 0.35s cubic-bezier(0.4,0,0.2,1)',
      fontFamily: "'Inter', sans-serif",
    }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 18px', borderBottom: '1px solid rgba(34,197,94,0.12)',
        background: 'linear-gradient(90deg, rgba(34,197,94,0.08) 0%, transparent 60%)', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ fontSize: 18 }}>🛰️</span>
          <div>
            <div style={{
              fontFamily: "'Space Mono', monospace", fontSize: 11, fontWeight: 700,
              color: '#22c55e', letterSpacing: 1.8, textTransform: 'uppercase', whiteSpace: 'nowrap',
            }}>Critical Loss Zone · Before / After</div>
            <div style={{
              fontFamily: "'Space Mono', monospace", fontSize: 8, color: '#4b5563',
              letterSpacing: 1.2, marginTop: 2, whiteSpace: 'nowrap',
            }}>
              GEE · SENTINEL-2 · NATURAL COLOUR · CLICK PANEL TO NAVIGATE
            </div>
          </div>
        </div>
        <button onClick={onClose} title="Close"
          style={{
            width: 32, height: 32, borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.05)', color: '#9ca3af',
            fontSize: 14, cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, transition: 'all 0.2s ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.background='rgba(239,68,68,0.2)'; e.currentTarget.style.color='#ef4444' }}
          onMouseLeave={e => { e.currentTarget.style.background='rgba(255,255,255,0.05)'; e.currentTarget.style.color='#9ca3af' }}
        >✕</button>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      {!ready ? (
        <div style={{
          padding: 60, textAlign: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
        }}>
          <span style={{ fontSize: 32, animation: 'pulse 1.5s ease-in-out infinite' }}>🛰️</span>
          <div style={{
            fontFamily: "'Space Mono', monospace", fontSize: 11,
            letterSpacing: 1.2, color: '#22c55e', fontWeight: 600,
          }}>{status}</div>
        </div>
      ) : (
        <div style={{ display: 'flex' }}>
          <SidePanel
            year={yearAInt} label="BASELINE YEAR"
            photoData={photoA}
            loading={photosLoading}
            side="left"
            stats={statsA}
            hotCoords={hotCoords}
            boxBounds={boxBounds}
            onNavigate={onNavigate}
          />
          {/* Green divider */}
          <div style={{
            width: 2, flexShrink: 0,
            background: 'linear-gradient(180deg, transparent 0%, #22c55e 15%, #22c55e 85%, transparent 100%)',
            boxShadow: '0 0 14px rgba(34,197,94,0.45)',
          }} />
          <SidePanel
            year={yearBInt} label="COMPARE YEAR"
            photoData={photoB}
            loading={photosLoading}
            side="right"
            stats={statsB}
            hotCoords={hotCoords}
            boxBounds={boxBounds}
            onNavigate={onNavigate}
          />
        </div>
      )}

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <div style={{
        padding: '8px 18px', borderTop: '1px solid rgba(34,197,94,0.08)',
        display: 'flex', flexDirection: 'column', gap: 6, background: 'rgba(0,0,0,0.25)',
      }}>
        {/* Cross-sensor warning */}
        {tiles?.cross_sensor_warning && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '5px 10px',
            background: 'rgba(245,158,11,0.1)',
            border: '1px solid rgba(245,158,11,0.3)',
            borderRadius: 6,
          }}>
            <span style={{ fontSize: 11, flexShrink: 0 }}>⚠️</span>
            <span style={{
              fontFamily: "'Space Mono', monospace", fontSize: 8,
              color: '#f59e0b', letterSpacing: 0.5, lineHeight: 1.4,
            }}>
              {tiles.cross_sensor_warning}
            </span>
          </div>
        )}
        {photoErr && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '5px 10px',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 6,
          }}>
            <span style={{ fontSize: 11, flexShrink: 0 }}>⚠️</span>
            <span style={{
              fontFamily: "'Space Mono', monospace", fontSize: 8,
              color: '#ef4444', letterSpacing: 0.5, lineHeight: 1.4,
            }}>
              {photoErr}
            </span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#f97316', boxShadow: '0 0 6px rgba(249,115,22,0.8)', flexShrink: 0,
          }} />
          <span style={{
            fontFamily: "'Space Mono', monospace", fontSize: 9, color: '#6b7280', letterSpacing: 0.8,
          }}>
            {hotspot?.detected
              ? `HOTSPOT DETECTED · ${hotCoords[0].toFixed(5)}°N ${hotCoords[1].toFixed(5)}°E`
              : `CENTRE · ${hotCoords[0].toFixed(5)}°N ${hotCoords[1].toFixed(5)}°E`
            }
            {' '}· ORANGE BOX = AREA OF INTEREST · CLICK PANEL TO NAVIGATE MAP
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Single side panel ────────────────────────────────────────────────────────

function SidePanel({ year, label, photoData, loading, side, stats, hotCoords, boxBounds, onNavigate }) {

  const handleClick = useCallback(() => {
    if (onNavigate) onNavigate(hotCoords[0], hotCoords[1])
  }, [onNavigate, hotCoords])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {/* Image area */}
      <div
        style={{ position: 'relative', height: 360, background: '#050d06', cursor: 'pointer', overflow: 'hidden' }}
        onClick={handleClick}
        title="Click to navigate map to this location"
      >
        {/* ── Image or placeholder ── */}
        {loading ? (
          /* Loading spinner */
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 14,
          }}>
            <span style={{ fontSize: 32, animation: 'pulse 1.5s ease-in-out infinite' }}>🛰️</span>
            <div style={{
              fontFamily: "'Space Mono', monospace", fontSize: 10,
              color: '#22c55e', letterSpacing: 1.2, fontWeight: 600, textAlign: 'center',
            }}>
              Fetching {year} satellite image
            </div>
          </div>
        ) : photoData?.image_base64 ? (
          /* Sentinel Hub image */
          <img
            src={`data:image/png;base64,${photoData.image_base64}`}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            alt={`Satellite view ${photoData.year_used}`}
          />
        ) : (
          /* Unavailable placeholder */
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 10, background: 'rgba(10,20,12,0.95)', padding: '0 24px', textAlign: 'center',
          }}>
            <span style={{ fontSize: 28, opacity: 0.5 }}>🌫️</span>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: '#4b5563', letterSpacing: 0.8, lineHeight: 1.8 }}>
              Satellite image unavailable for {year}<br />
              No cloud-free pass found within ±2 years
            </div>
          </div>
        )}

        {/* ── Orange bounding box overlay (SVG-free: use absolute + Leaflet workaround) ── */}
        {/* We keep the orange box visual via an absolutely-positioned ring */}
        <div style={{
          position: 'absolute',
          top: '35%', left: '35%', right: '35%', bottom: '35%',
          border: '2px dashed #f97316',
          borderRadius: 2,
          pointerEvents: 'none',
          boxShadow: '0 0 0 1px rgba(249,115,22,0.2)',
        }} />

        {/* Year + label badge */}
        <div style={{
          position: 'absolute', top: 10,
          ...(side === 'left' ? { left: 10 } : { right: 10 }),
          zIndex: 10,
          background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.18)', borderRadius: 8,
          padding: '5px 11px', display: 'flex', alignItems: 'center', gap: 6,
          pointerEvents: 'none',
        }}>
          <span style={{
            fontFamily: "'Space Mono', monospace", fontSize: 9,
            fontWeight: 600, color: '#6b7280', letterSpacing: 1,
          }}>{label}</span>
          <span style={{
            fontFamily: "'Syne', sans-serif", fontSize: 16,
            fontWeight: 800, color: '#fff', letterSpacing: '-0.5px',
          }}>{photoData?.year_used ?? year}</span>
        </div>

        {/* Imagery source badge */}
        <div style={{
          position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)',
          zIndex: 10, pointerEvents: 'none',
          background: 'rgba(34,197,94,0.85)', backdropFilter: 'blur(6px)',
          border: '1px solid rgba(34,197,94,0.5)', borderRadius: 5,
          padding: '3px 9px',
          fontFamily: "'Space Mono', monospace", fontSize: 8, fontWeight: 700,
          color: '#fff', letterSpacing: 0.8, whiteSpace: 'nowrap',
        }}>
          📡 GEE · Sentinel-2 · {photoData?.year_used ?? year}
        </div>

        {/* Area of interest label */}
        <div style={{
          position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
          zIndex: 10, pointerEvents: 'none',
          background: 'rgba(249,115,22,0.88)', backdropFilter: 'blur(6px)',
          border: '1px solid rgba(249,115,22,0.5)', borderRadius: 5,
          padding: '3px 9px',
          fontFamily: "'Space Mono', monospace", fontSize: 8, fontWeight: 700,
          color: '#fff', letterSpacing: 0.8, whiteSpace: 'nowrap',
        }}>
          ⚠ HIGHEST LOSS ZONE
        </div>

        {/* Click-to-navigate hint */}
        <div style={{
          position: 'absolute', bottom: 32, right: 8,
          zIndex: 10, pointerEvents: 'none',
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4,
          padding: '2px 7px',
          fontFamily: "'Space Mono', monospace", fontSize: 7,
          color: '#6b7280', letterSpacing: 0.5, whiteSpace: 'nowrap',
        }}>
          Click → navigate map
        </div>
      </div>

      {/* Fallback year notice (amber pill below image) */}
      {photoData?.is_fallback_year && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 12px',
          background: 'rgba(245,158,11,0.12)',
          border: '1px solid rgba(245,158,11,0.3)',
          borderTop: 'none',
        }}>
          <span style={{ fontSize: 10 }}>⚠</span>
          <span style={{
            fontFamily: "'Space Mono', monospace", fontSize: 8,
            color: '#f59e0b', letterSpacing: 0.5, lineHeight: 1.4,
          }}>
            Nearest clear image: {photoData.year_used} — no cloud-free pass found for {photoData.requested_year}
          </span>
        </div>
      )}

      {/* Stats strip */}
      <div style={{
        display: 'flex', justifyContent: 'space-around', alignItems: 'center',
        padding: '13px 16px',
        borderTop: '1px solid rgba(34,197,94,0.1)', background: 'rgba(0,0,0,0.3)', gap: 6,
        flex: 1,
      }}>
        <StatChip label="Healthy Forest" value={fmtPct(stats?.healthy_pct)} color="#22c55e" />
        <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.07)' }} />
        <StatChip label="Cleared / Lost" value={fmtPct(stats?.cleared_pct)} color="#ef4444" />
      </div>
    </div>
  )
}

function StatChip({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
      <div style={{
        fontFamily: "'Space Mono', monospace", fontSize: 8, color: '#4b5563',
        letterSpacing: 1, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase',
      }}>{label}</div>
      <div style={{
        fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 800,
        color, letterSpacing: '-0.3px', lineHeight: 1,
      }}>{value}</div>
    </div>
  )
}

function fmtPct(v) {
  return v != null ? `${Number(v).toFixed(1)}%` : '—'
}
