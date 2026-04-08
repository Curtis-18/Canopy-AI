import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Marker,
         Circle, GeoJSON, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})


const RISK_COLORS = {
  LOW:      '#22c55e',
  MEDIUM:   '#f59e0b',
  HIGH:     '#f97316',
  CRITICAL: '#ef4444',
}

const FORESTS = [
  { name: 'Mabira Forest',              lat:  0.45, lng: 32.95 },
  { name: 'Budongo Forest',             lat:  1.73, lng: 31.55 },
  { name: 'Kibale Forest',              lat:  0.50, lng: 30.36 },
  { name: 'Bwindi Forest',              lat: -1.03, lng: 29.68 },
  { name: 'Queen Elizabeth Nat. Park',  lat: -0.20, lng: 29.90 },
]

const LEGENDS = {
  ndvi: [
    ['HEALTHY',  '#166534'],
    ['MODERATE', '#84cc16'],
    ['STRESSED', '#f59e0b'],
    ['CLEARED',  '#ef4444'],
  ],
  change: [
    ['REGROWTH',    '#166534'],
    ['NO CHANGE',   '#e5e7eb'],
    ['FOREST LOSS', '#ef4444'],
  ],
  risk: [
    ['HEALTHY',  '#166534'],
    ['AT RISK',  '#f59e0b'],
    ['DEGRADED', '#f97316'],
    ['CLEARED',  '#ef4444'],
  ],
}

// ── Forest label divIcon ──────────────────────────────────────────────────────
function makeForestLabel(name) {
  return L.divIcon({
    className: '',
    iconAnchor: [0, 0],
    html: `<div style="
      background: rgba(6,13,7,0.85);
      border: 1px solid rgba(34,197,94,0.45);
      border-radius: 20px;
      padding: 3px 10px;
      font-family: 'Space Mono', monospace;
      font-size: 10px;
      font-weight: 600;
      color: #4ade80;
      letter-spacing: 0.5px;
      white-space: nowrap;
      pointer-events: none;
      backdrop-filter: blur(6px);
      box-shadow: 0 2px 8px rgba(0,0,0,0.5);
    ">${name}</div>`,
  })
}

function LayerBtn({ label, active, color, disabled, onClick }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 12px',
      width: '100%',
      background: active
        ? `linear-gradient(135deg, ${color}30 0%, ${color}15 100%)`
        : 'rgba(6,13,7,0.7)',
      border: `1.5px solid ${active ? color : 'rgba(34,197,94,0.15)'}`,
      borderRadius: 8,
      color: active ? color : disabled ? '#374151' : '#6b7280',
      fontFamily: "'Space Mono', monospace",
      fontSize: 10,
      letterSpacing: 0.5,
      cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'all 0.3s ease',
      whiteSpace: 'nowrap',
      fontWeight: active ? 600 : 500,
      backdropFilter: 'blur(4px)',
      opacity: disabled ? 0.5 : 1,
    }}>
      <div style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        flexShrink: 0,
        background: active ? color : disabled ? '#374151' : '#4b5563',
        boxShadow: active ? `0 0 6px ${color}60` : 'none',
        transition: 'all 0.3s ease'
      }} />
      {label}
    </button>
  )
}

function ClickHandler({ onMapClick }) {
  useMapEvents({ click: (e) => onMapClick(e.latlng.lat, e.latlng.lng) })
  return null
}

function FlyTo({ point }) {
  const map = useMap()
  useEffect(() => {
    if (!point) return
    // point can be [lat, lng] or [lat, lng, zoom]
    const zoom = point[2] ?? 16
    map.flyTo([point[0], point[1]], zoom, { duration: 1.2 })
  }, [point, map])
  return null
}

const ESRI_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

export default function Map({
  selectedPoint, alertLevel,
  onMapClick, radiusKm,
  tiles, tilesLoading,
  flyToPoint,
}) {
  const color   = RISK_COLORS[alertLevel] || '#22c55e'
  const hasTiles = !!tiles

  const [ugandaGeojson, setUgandaGeojson] = useState(null)
  
  useEffect(() => {
    fetch('https://raw.githubusercontent.com/wmgeolab/geoBoundaries/main/releaseData/gbOpen/UGA/ADM0/geoBoundaries-UGA-ADM0_simplified.geojson')
      .then(r => r.json())
      .then(data => {
        console.log(" Uganda boundary successfully loaded", data)
        setUgandaGeojson(data)
      })
      .catch(e => console.error("Failed to load Uganda GeoJSON:", e))
  }, [])

  const [layers, setLayers] = useState({
    satellite: true,
    ndvi:      false,
    change:    false,
    risk:      false,
  })

  const toggle = (key) => {
    if (key === 'satellite') {
      setLayers(l => ({ ...l, satellite: !l.satellite }))
      return
    }
    setLayers(l => ({
      ...l,
      ndvi:   key === 'ndvi'   ? !l.ndvi   : false,
      change: key === 'change' ? !l.change : false,
      risk:   key === 'risk'   ? !l.risk   : false,
    }))
  }

  const activeGEE = layers.ndvi ? 'ndvi'
                  : layers.change ? 'change'
                  : layers.risk   ? 'risk'
                  : null

  return (
    <div style={{ height: '100%', position: 'relative' }}>

      {/* Toggle panel */}
      <div style={{
        position:      'absolute',
        top:           12, right: 12,
        zIndex:        1000,
        display:       'flex',
        flexDirection: 'column',
        gap:           8,
        minWidth:      160,
        padding:       '2px',
      }}>
        <div style={{
          padding:      '10px 12px',
          background:   'linear-gradient(135deg, rgba(34,197,94,0.15) 0%, rgba(34,197,94,0.08) 100%)',
          backdropFilter: 'blur(10px)',
          border:       '1px solid rgba(34,197,94,0.3)',
          borderRadius: 8,
          fontFamily:   "'Space Mono', monospace",
          fontSize:     10,
          fontWeight:   600,
          color:        '#22c55e',
          letterSpacing: 1.5,
          textAlign:    'center',
          boxShadow:    '0 8px 32px rgba(34,197,94,0.1), inset 0 1px 0 rgba(255,255,255,0.1)',
          transition:   'all 0.3s ease',
        }}>
          {tilesLoading ? '⏳ LOADING...' : '🗺️ LAYERS'}
        </div>

        <LayerBtn
          label="SATELLITE"
          active={layers.satellite}
          color="#4ade80"
          onClick={() => toggle('satellite')}
        />
        <LayerBtn
          label={`NDVI ${tiles?.year_b ?? ''}`}
          active={layers.ndvi}
          color="#4ade80"
          disabled={!hasTiles}
          onClick={() => hasTiles && toggle('ndvi')}
        />
        <LayerBtn
          label={`CHANGE ${tiles ? `${tiles.year_a}→${tiles.year_b}` : ''}`}
          active={layers.change}
          color="#ef4444"
          disabled={!hasTiles}
          onClick={() => hasTiles && toggle('change')}
        />
        <LayerBtn
          label="RISK MAP"
          active={layers.risk}
          color="#f59e0b"
          disabled={!hasTiles}
          onClick={() => hasTiles && toggle('risk')}
        />

        {/* Legend */}
        {activeGEE && (
          <div style={{
            marginTop:    4,
            padding:      '12px 14px',
            background:   'linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(34,197,94,0.05) 100%)',
            backdropFilter: 'blur(10px)',
            border:       '1px solid rgba(34,197,94,0.25)',
            borderRadius: 8,
            boxShadow:    '0 8px 32px rgba(34,197,94,0.08), inset 0 1px 0 rgba(255,255,255,0.05)',
            animation:    'fadeUp 0.4s ease',
          }}>
            <div style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 9,
              fontWeight: 600,
              color: '#22c55e',
              letterSpacing: 1.2,
              marginBottom: 10,
              textTransform: 'uppercase',
            }}>📊 Legend</div>
            {LEGENDS[activeGEE].map(([label, c]) => (
              <div key={label} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 6,
                padding: '4px 6px',
                borderRadius: 4,
                transition: 'background 0.2s ease',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(34,197,94,0.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}>
                <div style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: c,
                  flexShrink: 0,
                  boxShadow: `0 0 8px ${c}40`,
                  transition: 'transform 0.2s ease',
                }} />
                <span style={{
                  fontFamily: "'Space Mono', monospace",
                  fontSize: 9,
                  color: '#cbd5e1',
                  letterSpacing: 0.5,
                  fontWeight: 500,
                }}>{label}</span>
              </div>
            ))}
          </div>
        )}

        {!hasTiles && !tilesLoading && (
          <div style={{
            marginTop: 4,
            padding: '10px 12px',
            background: 'linear-gradient(135deg, rgba(251,146,60,0.15) 0%, rgba(251,146,60,0.08) 100%)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(251,146,60,0.25)',
            borderRadius: 8,
            fontFamily: "'Space Mono', monospace",
            fontSize: 9,
            fontWeight: 500,
            color: '#fed7aa',
            letterSpacing: 0.8,
            textAlign: 'center',
            lineHeight: 1.8,
            boxShadow: '0 8px 32px rgba(251,146,60,0.08)',
            animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          }}>
            ✨ CLICK MAP<br />TO UNLOCK LAYERS
          </div>
        )}
      </div>

      {/* Map */}
      <MapContainer
        center={[1.3, 32.3]}
        zoom={7}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
      >
        {/* ── Basemap: ESRI World Imagery (instant, sharp, no patches) ── */}
        {layers.satellite ? (
          <TileLayer
            url={ESRI_URL}
            attribution="Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"
            maxNativeZoom={18}
            maxZoom={20}
          />
        ) : (
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution="CartoDB"
          />
        )}

        {/* ── Analysis overlay layers ── */}
        {layers.ndvi   && tiles?.ndvi   && <TileLayer url={tiles.ndvi}   opacity={0.8} />}
        {layers.change && tiles?.change && <TileLayer url={tiles.change} opacity={0.8} />}
        {layers.risk   && tiles?.risk   && <TileLayer url={tiles.risk}   opacity={0.8} />}

        {ugandaGeojson && (
          <GeoJSON 
            data={ugandaGeojson} 
            style={{ color: '#FFFFFF', weight: 3, fill: false, opacity: 0.9 }} 
          />
        )}

        <ClickHandler onMapClick={onMapClick} />
        {flyToPoint && <FlyTo point={flyToPoint} />}

        {/* ── Forest name labels ── */}
        {FORESTS.map(f => (
          <Marker
            key={f.name}
            position={[f.lat, f.lng]}
            icon={makeForestLabel(f.name)}
            eventHandlers={{ click: () => onMapClick(f.lat, f.lng) }}
          />
        ))}

        {selectedPoint && (
          <Circle
            center={selectedPoint}
            radius={radiusKm * 1000}
            pathOptions={{
              color, fillColor: color,
              fillOpacity: 0.1, weight: 2,
            }}
          />
        )}
      </MapContainer>
    </div>
  )
}