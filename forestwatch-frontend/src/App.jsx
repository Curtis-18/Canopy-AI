import { useState, useEffect, useRef, useMemo } from 'react'

import { analyzeForest, compareForest, getMapTiles } from './api'
import { useAuth } from './context/useAuth'
import { YEAR_OPTIONS, resolveYear } from './yearOptions'

import AlertBadge from './components/AlertBadge'
import ComparePanel from './components/ComparePanel'
import HotZonesPanel from './components/HotZonesPanel'
import InsightPanel from './components/InsightPanel'
import Map from './components/Map'
import SaveParcelButton from './components/SaveParcelButton'
import SatelliteComparePanel from './components/SatelliteComparePanel'
import StatsPanel from './components/StatsPanel'
import TimeSeriesPanel from './components/TimeSeriesPanel'

const formatRadius = (km) => km < 1 ? `${Math.round(km * 1000)}m` : `${km}km`
export default function App() {
  const { user, signOut } = useAuth()

  const [selectedPoint, setSelectedPoint] = useState(null)
  const [analyzeResult, setAnalyzeResult] = useState(null)
  const [compareResult, setCompareResult] = useState(null)
  const [tiles, setTiles] = useState(null)
  const [tilesLoading, setTilesLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('analyze')
  const [year, setYear] = useState(2024)
  const [yearA, setYearA] = useState('')
  const [yearB, setYearB] = useState('')
  const [manualLat, setManualLat] = useState('')
  const [manualLng, setManualLng] = useState('')
  const [radiusKm, setRadiusKm] = useState(5)
  const [error, setError] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [resultsOpen, setResultsOpen] = useState(false)
  const [showTimeSeries, setShowTimeSeries] = useState(false)
  const [showSatCompare, setShowSatCompare] = useState(false)
  const [flyToPoint, setFlyToPoint] = useState(null)

  // Hot Zones state
  const [hotZoneSatData, setHotZoneSatData] = useState(null) // {zone, statsA, statsB, yearA, yearB, tiles}
  const [hotZoneCircle, setHotZoneCircle] = useState(null) // {lat, lng}

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchSuggestions, setSearchSuggestions] = useState([])
  const [searchFocused, setSearchFocused] = useState(false)
  const searchRef = useRef(null)

  const SEARCH_FORESTS = useMemo(() => [
    { name: 'Mabira Forest',             lat:  0.45, lng: 32.95 },
    { name: 'Budongo Forest',            lat:  1.73, lng: 31.55 },
    { name: 'Kibale Forest',             lat:  0.50, lng: 30.36 },
    { name: 'Bwindi Forest',             lat: -1.03, lng: 29.68 },
    { name: 'Queen Elizabeth Nat. Park', lat: -0.20, lng: 29.90 },
  ], [])

  const handleMapClick = (lat, lng) => {
    setSelectedPoint([lat, lng])
    setShowTimeSeries(false)
    setFlyToPoint(null)
  }

  const handleManualGo = () => {
    const lat = parseFloat(manualLat)
    const lng = parseFloat(manualLng)
    if (Number.isNaN(lat) || Number.isNaN(lng)) return
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return
    handleMapClick(lat, lng)
    setFlyToPoint([lat, lng, 14])
  }

  // Search: update suggestions as user types
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) { setSearchSuggestions([]); return }
    setSearchSuggestions(
      SEARCH_FORESTS.filter(f => f.name.toLowerCase().includes(q))
    )
  }, [searchQuery, SEARCH_FORESTS])

  const handleSearchSelect = (forest) => {
    setFlyToPoint([forest.lat, forest.lng, 12])
    setSearchQuery('')
    setSearchSuggestions([])
    setSearchFocused(false)
  }

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter' && searchSuggestions.length > 0) {
      handleSearchSelect(searchSuggestions[0])
    }
    if (e.key === 'Escape') {
      setSearchQuery('')
      setSearchSuggestions([])
    }
  }

  useEffect(() => {
    if (!selectedPoint) return
    
    // Prevent compare fetch if years are not selected
    if (activeTab === 'compare' && (yearA === "" || yearB === "")) {
      setError("Please select both years to compare.")
      setTiles(null)
      setAnalyzeResult(null)
      setCompareResult(null)
      setShowTimeSeries(false)
      return
    }

    const fetchData = async () => {

      const [lat, lng] = selectedPoint
      setError(null)
      setLoading(true)
      setTilesLoading(true)
      setTiles(null)
      // Clear previous results to trigger loading visual
      setAnalyzeResult(null)
      setCompareResult(null)

      // Resolve year options so we get the correct year int + date range
      const ry  = resolveYear(year)
      const ryA = yearA ? resolveYear(yearA) : null
      const ryB = yearB ? resolveYear(yearB) : null

      // Tiles use yearA/yearB integers; in analyze mode we use year-1 vs year (full years)
      const tileYearA = activeTab === 'analyze' ? ry.year - 1 : ryA?.year
      const tileYearB = activeTab === 'analyze' ? ry.year     : ryB?.year

      // Tile date opts: analyze mode uses full years; compare mode mirrors selection
      const tileOpts = activeTab === 'analyze' ? {} : {
        date_start_a: ryA?.dateStart, date_end_a: ryA?.dateEnd, label_a: ryA?.label,
        date_start_b: ryB?.dateStart, date_end_b: ryB?.dateEnd, label_b: ryB?.label,
      }

      try {
        const [analysisResult] = await Promise.all([
          activeTab === 'analyze'
            ? analyzeForest(lat, lng, ry.year, radiusKm, {
                date_start: ry.dateStart, date_end: ry.dateEnd, label: ry.label,
              })
            : compareForest(lat, lng, ryA.year, ryB.year, radiusKm, {
                date_start_a: ryA.dateStart, date_end_a: ryA.dateEnd, label_a: ryA.label,
                date_start_b: ryB.dateStart, date_end_b: ryB.dateEnd, label_b: ryB.label,
              }),

          getMapTiles(lat, lng, tileYearA, tileYearB, radiusKm, tileOpts)
            .then(t => setTiles(t))
            .catch(() => {})
            .finally(() => setTilesLoading(false)),
        ])

        if (activeTab === 'analyze') setAnalyzeResult(analysisResult)
        else                          setCompareResult(analysisResult)

        setResultsOpen(true) // Pop out results when data arrives

      } catch (err) {
        console.error('Backend request failed:', err)
        setError(`Could not reach backend. Check the Render URL and deployment status. ${err?.message || ''}`.trim())
        setTilesLoading(false)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [selectedPoint, activeTab, year, yearA, yearB, radiusKm])

  // Open results panel when switching to hotzones tab
  useEffect(() => {
    if (activeTab === 'hotzones') setResultsOpen(true)
  }, [activeTab])

  const handleZoneFlyTo = (lat, lng) => setFlyToPoint([lat, lng, 16])
  const handleZoneShowSatCompare = (satData, tiles) => {
    if (!satData) { setHotZoneSatData(null); return }
    setHotZoneSatData({ ...satData, tiles })
  }
  const handleZoneSetCircle = (c) => setHotZoneCircle(c)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* Header */}
      <header style={{
        padding: '16px 24px',
        borderBottom: '1px solid rgba(34,197,94,0.1)',
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
        background: 'linear-gradient(135deg, rgba(6,13,7,0.98) 0%, rgba(10,30,12,0.95) 100%)',
        flexShrink: 0,
        backdropFilter: 'blur(10px)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            fontSize: 28,
            filter: 'drop-shadow(0 0 8px rgba(34,197,94,0.3))'
          }}>🛰️</div>
          <div>
            <div style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: 20,
              fontWeight: 800,
              background: 'linear-gradient(135deg, #4ade80 0%, #22c55e 100%)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: '-0.5px'
            }}>
              Canopy<span style={{ color: '#4ade80' }}>AI</span>
            </div>
            <div style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 8.5,
              color: '#4b5563',
              letterSpacing: 2.5,
              marginTop: '2px',
              fontWeight: 500
            }}>
              UGANDA FOREST INTELLIGENCE
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 14px',
            background: 'linear-gradient(135deg, rgba(239,68,68,0.15) 0%, rgba(249,115,22,0.1) 100%)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 20,
            backdropFilter: 'blur(8px)',
          }}>
            <div style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#ef4444',
              animation: 'pulse 1.5s infinite',
              boxShadow: '0 0 8px rgba(239,68,68,0.6)'
            }} />
            <span style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 9,
              color: '#ef4444',
              letterSpacing: 1,
              fontWeight: 600
            }}>LIVE</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 9,
              color: '#6b7280',
              letterSpacing: 0.5,
            }}>{user?.email}</span>
            <button onClick={signOut} style={{
              padding: '6px 14px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 20,
              color: '#9ca3af',
              fontFamily: "'Inter', sans-serif",
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
            }}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>

        {/* Drawer Toggle Button */}
        <button 
          onClick={() => setDrawerOpen(!drawerOpen)}
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            zIndex: 1000,
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: drawerOpen ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)',
            border: drawerOpen ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(34,197,94,0.4)',
            color: drawerOpen ? '#ef4444' : '#22c55e',
            fontSize: 20,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.3s ease',
          }}>
          {drawerOpen ? '✕' : '☰'}
        </button>

        {/* Drawer Overlay */}
        {drawerOpen && (
          <div 
            onClick={() => setDrawerOpen(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.5)',
              zIndex: 999,
              animation: 'fadeIn 0.3s ease'
            }}
          />
        )}

        {/* Sidebar Drawer */}
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 340,
          borderRight: '1px solid rgba(34,197,94,0.1)',
          background: 'linear-gradient(180deg, rgba(6,13,7,0.98) 0%, rgba(10,30,12,0.95) 100%)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          backdropFilter: 'blur(5px)',
          transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.3s ease',
          zIndex: 1000,
          boxShadow: drawerOpen ? '0 8px 32px rgba(0,0,0,0.4)' : 'none',
        }}>
          {/* Search Bar */}
          <div ref={searchRef} style={{ padding: '12px 16px', borderBottom: '1px solid rgba(34,197,94,0.08)', position: 'relative' }}>
            <div style={{ position: 'relative' }}>
              <span style={{
                position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                fontSize: 13, color: '#4b5563', pointerEvents: 'none',
              }}>🔍</span>
              <input
                type="text"
                placeholder="Search forests..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                onKeyDown={handleSearchKeyDown}
                style={{
                  width: '100%',
                  padding: '9px 12px 9px 30px',
                  background: 'rgba(34,197,94,0.08)',
                  border: '1.5px solid rgba(34,197,94,0.25)',
                  borderRadius: 8,
                  color: '#e2f5e8',
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 12,
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.2s',
                }}
                onFocusCapture={e => e.target.style.borderColor = 'rgba(34,197,94,0.55)'}
                onBlurCapture={e => e.target.style.borderColor = 'rgba(34,197,94,0.25)'}
              />
            </div>
            {searchFocused && searchSuggestions.length > 0 && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 16, right: 16,
                background: 'rgba(6,13,7,0.97)',
                border: '1px solid rgba(34,197,94,0.3)',
                borderRadius: 8,
                zIndex: 2000,
                overflow: 'hidden',
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              }}>
                {searchSuggestions.map(f => (
                  <div
                    key={f.name}
                    onMouseDown={() => handleSearchSelect(f)}
                    style={{
                      padding: '10px 14px',
                      cursor: 'pointer',
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 12,
                      color: '#4ade80',
                      borderBottom: '1px solid rgba(34,197,94,0.08)',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(34,197,94,0.1)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    🌿 {f.name}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Manual coordinate entry */}
          <div style={{ padding: '0 16px 12px', borderBottom: '1px solid rgba(34,197,94,0.08)' }}>
            <div style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 9.5,
              color: '#4b5563',
              letterSpacing: 1,
              marginBottom: 6,
            }}>
              OR ENTER COORDINATES
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="number" step="any" placeholder="Lat"
                value={manualLat} onChange={e => setManualLat(e.target.value)}
                style={{
                  flex: 1, minWidth: 0, padding: '8px 10px',
                  background: 'rgba(34,197,94,0.08)', border: '1.5px solid rgba(34,197,94,0.25)',
                  borderRadius: 8, color: '#e2f5e8', fontFamily: "'Inter', sans-serif",
                  fontSize: 12, outline: 'none',
                }}
              />
              <input
                type="number" step="any" placeholder="Lng"
                value={manualLng} onChange={e => setManualLng(e.target.value)}
                style={{
                  flex: 1, minWidth: 0, padding: '8px 10px',
                  background: 'rgba(34,197,94,0.08)', border: '1.5px solid rgba(34,197,94,0.25)',
                  borderRadius: 8, color: '#e2f5e8', fontFamily: "'Inter', sans-serif",
                  fontSize: 12, outline: 'none',
                }}
              />
              <button
                onClick={handleManualGo} disabled={!manualLat || !manualLng}
                style={{
                  padding: '8px 14px',
                  background: 'linear-gradient(135deg, rgba(34,197,94,0.25) 0%, rgba(22,163,74,0.2) 100%)',
                  border: '1px solid rgba(34,197,94,0.4)', borderRadius: 8, color: '#4ade80',
                  fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 600,
                  cursor: (!manualLat || !manualLng) ? 'default' : 'pointer',
                }}
              >
                Go
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid rgba(34,197,94,0.08)', padding: '8px 0' }}>
            {[['analyze', '🔍 Analyze'], ['compare', '📊 Compare'], ['hotzones', '🔥 Hot Zones']].map(([key, label]) => (
              <button key={key} onClick={() => setActiveTab(key)} style={{
                flex: 1,
                padding: '10px 8px',
                border: 'none',
                background: activeTab === key ? 'rgba(34,197,94,0.1)' : 'transparent',
                borderBottom: activeTab === key ? '2px solid #4ade80' : '2px solid transparent',
                color: activeTab === key ? '#4ade80' : '#4b5563',
                fontFamily: "'Inter', sans-serif",
                fontSize: 12,
                fontWeight: activeTab === key ? 600 : 500,
                cursor: 'pointer',
                transition: 'all 0.3s ease',
              }}>{label}</button>
            ))}
          </div>

          {/* Controls — hidden on hotzones tab (panel manages its own UI) */}
          {activeTab !== 'hotzones' && (
          <div style={{ padding: '16px', borderBottom: '1px solid rgba(34,197,94,0.08)' }}>
            {activeTab === 'analyze' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <label style={{
                  fontSize: 11,
                  color: '#4b5563',
                  fontFamily: "'Space Mono', monospace",
                  letterSpacing: 1,
                  fontWeight: 600
                }}>
                  YEAR — <span style={{ color: '#22c55e', fontWeight: 700 }}>{resolveYear(year).label}</span>
                  <select value={String(year)} onChange={e => setYear(e.target.value)} style={{
                    display: 'block',
                    width: '100%',
                    marginTop: 6,
                    background: 'rgba(34,197,94,0.12)',
                    border: '1.5px solid rgba(34,197,94,0.3)',
                    borderRadius: 8,
                    padding: '10px 12px',
                    color: '#e2f5e8',
                    fontSize: 13,
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}>
                    {YEAR_OPTIONS.map(o =>
                      <option key={o.value} value={String(o.value)} style={{ color: '#000', background: '#fff' }}>{o.label}</option>
                    )}
                  </select>
                </label>
                <div style={{ marginBottom: 4 }}>
                  <div style={{
                    fontSize: 11,
                    color: '#4b5563',
                    fontFamily: "'Space Mono', monospace",
                    letterSpacing: 1,
                    fontWeight: 600,
                    marginBottom: 8,
                  }}>
                    RADIUS — <span style={{ color: '#22c55e', fontWeight: 700 }}>{formatRadius(radiusKm)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                    {[0.1, 0.5, 1, 2, 5, 10, 20].map(preset => (
                      <button
                        key={preset}
                        onClick={() => setRadiusKm(preset)}
                        style={{
                          padding: '5px 10px',
                          background: radiusKm === preset ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${radiusKm === preset ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.12)'}`,
                          borderRadius: 6,
                          color: radiusKm === preset ? '#4ade80' : '#9ca3af',
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {formatRadius(preset)}
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    min={0.1}
                    max={20}
                    step={0.1}
                    value={radiusKm}
                    onChange={e => {
                      const v = parseFloat(e.target.value)
                      if (!Number.isNaN(v)) setRadiusKm(Math.min(20, Math.max(0.1, v)))
                    }}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      background: 'rgba(34,197,94,0.08)',
                      border: '1.5px solid rgba(34,197,94,0.25)',
                      borderRadius: 8,
                      color: '#e2f5e8',
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 13,
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[['BASELINE YEAR', yearA, setYearA], ['COMPARE YEAR', yearB, setYearB]].map(([lbl, val, setter]) => (
                  <label key={lbl} style={{
                    fontSize: 11,
                    color: '#4b5563',
                    fontFamily: "'Space Mono', monospace",
                    letterSpacing: 1,
                    fontWeight: 600
                  }}>
                    {lbl} — <span style={{ color: '#22c55e', fontWeight: 700 }}>{val ? resolveYear(val).label : ''}</span>
                    <select value={String(val)} onChange={e => setter(e.target.value === '' ? '' : e.target.value)} style={{
                      display: 'block',
                      width: '100%',
                      marginTop: 6,
                      background: 'rgba(34,197,94,0.12)',
                      border: '1.5px solid rgba(34,197,94,0.3)',
                      borderRadius: 8,
                      padding: '10px 12px',
                      color: '#e2f5e8',
                      fontSize: 13,
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}>
                      <option value="" disabled>Select year</option>
                      {YEAR_OPTIONS.map(o =>
                        <option key={o.value} value={String(o.value)} style={{ color: '#000', background: '#fff' }}>{o.label}</option>
                      )}
                    </select>
                  </label>
                ))}
                <div style={{ marginBottom: 4 }}>
                  <div style={{
                    fontSize: 11,
                    color: '#4b5563',
                    fontFamily: "'Space Mono', monospace",
                    letterSpacing: 1,
                    fontWeight: 600,
                    marginBottom: 8,
                  }}>
                    RADIUS — <span style={{ color: '#22c55e', fontWeight: 700 }}>{formatRadius(radiusKm)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                    {[0.1, 0.5, 1, 2, 5, 10, 20].map(preset => (
                      <button
                        key={preset}
                        onClick={() => setRadiusKm(preset)}
                        style={{
                          padding: '5px 10px',
                          background: radiusKm === preset ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${radiusKm === preset ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.12)'}`,
                          borderRadius: 6,
                          color: radiusKm === preset ? '#4ade80' : '#9ca3af',
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {formatRadius(preset)}
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    min={0.1}
                    max={20}
                    step={0.1}
                    value={radiusKm}
                    onChange={e => {
                      const v = parseFloat(e.target.value)
                      if (!Number.isNaN(v)) setRadiusKm(Math.min(20, Math.max(0.1, v)))
                    }}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      background: 'rgba(34,197,94,0.08)',
                      border: '1.5px solid rgba(34,197,94,0.25)',
                      borderRadius: 8,
                      color: '#e2f5e8',
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 13,
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                
                <button
                  onClick={() => setShowTimeSeries(true)}
                  disabled={!selectedPoint || yearA === "" || yearB === ""}
                  style={{
                    marginTop: 8,
                    padding: '12px',
                    background: (!selectedPoint || yearA === "" || yearB === "") ? 'rgba(34,197,94,0.05)' : 'linear-gradient(135deg, rgba(34,197,94,0.2) 0%, rgba(22,163,74,0.15) 100%)',
                    border: `1px solid ${(!selectedPoint || yearA === "" || yearB === "") ? 'rgba(34,197,94,0.1)' : 'rgba(34,197,94,0.4)'}`,
                    borderRadius: 8,
                    color: (!selectedPoint || yearA === "" || yearB === "") ? '#4b5563' : '#4ade80',
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: (!selectedPoint || yearA === "" || yearB === "") ? 'not-allowed' : 'pointer',
                    transition: 'all 0.3s ease',
                  }}
                >
                  📈 View Time Series
                </button>
              </div>
            )}
          </div>
          )}

          {/* Hot Zones */}
          {activeTab === 'hotzones' && (
            <HotZonesPanel
              onFlyTo={handleZoneFlyTo}
              onShowSatCompare={handleZoneShowSatCompare}
              onSetCircle={handleZoneSetCircle}
            />
          )}
        </div>

        {/* Secondary Drawer: Results Panel (Spawns to the right of the Control Drawer) */}
        <div style={{
          position: 'absolute',
          left: drawerOpen ? 340 : 0, 
          top: 0,
          bottom: 0,
          width: 420,
          background: 'linear-gradient(180deg, rgba(6,13,7,0.95) 0%, rgba(10,30,12,0.92) 100%)',
          borderRight: '1px solid rgba(34,197,94,0.2)',
          display: 'flex',
          flexDirection: 'column',
          transform: resultsOpen && (selectedPoint || loading || activeTab === 'hotzones') ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
          zIndex: 998, // Just behind main drawer
          backdropFilter: 'blur(10px)',
          boxShadow: resultsOpen ? '8px 0 32px rgba(0,0,0,0.5)' : 'none',
        }}>
          {/* Results Header w/ Close Button */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 20px',
            borderBottom: '1px solid rgba(34,197,94,0.1)'
          }}>
            <div style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 12,
              fontWeight: 600,
              color: '#22c55e',
              letterSpacing: 1.5,
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}>
              {loading ? '⏳ PROCESSING' : activeTab === 'hotzones' ? '🔥 HOT ZONES' : '📋 ANALYSIS RESULTS'}
            </div>
            <button onClick={() => setResultsOpen(false)} style={{
              background: 'transparent',
              border: 'none',
              color: '#9ca3af',
              cursor: 'pointer',
              fontSize: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28, height: 28,
              borderRadius: '50%',
              transition: 'all 0.2s',
            }} onMouseOver={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
               onMouseOut={e => { e.currentTarget.style.color = '#9ca3af'; e.currentTarget.style.background = 'transparent' }}
            >
              ✕
            </button>
          </div>

          {/* Results Body */}
          <div style={{ padding: activeTab === 'hotzones' ? 0 : '20px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: activeTab === 'hotzones' ? 0 : 16 }}>
            {error && (
              <div style={{
                padding: '12px 14px',
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: 10,
                fontSize: 12,
                color: '#ef4444',
                fontWeight: 500
              }}>
                ⚠️ {error}
              </div>
            )}

            {!selectedPoint && !loading && !error && activeTab !== 'hotzones' && (
               <div style={{ textAlign: 'center', marginTop: 40, color: '#4b5563', fontFamily: "'Space Mono', monospace", fontSize: 11 }}>
                 WAITING FOR MAP INPUT...
               </div>
            )}

            {selectedPoint && (
              <div style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: 10,
                color: '#6b7280',
                letterSpacing: 0.5,
                fontWeight: 500,
                padding: '8px 12px',
                background: 'rgba(255,255,255,0.03)',
                borderRadius: 6,
                display: 'inline-block',
                alignSelf: 'flex-start'
              }}>
                📍 {selectedPoint[0].toFixed(4)}°N, {selectedPoint[1].toFixed(4)}°E
              </div>
            )}

            {analyzeResult && !loading && (
              <div style={{ animation: 'fadeUp 0.4s ease' }}>
                <AlertBadge
                  level={analyzeResult?.alert?.level}
                  score={analyzeResult.alert.score}
                  message={analyzeResult.alert.message}
                  large
                />
              </div>
            )}

            {activeTab === 'analyze' && analyzeResult && !loading && (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <StatsPanel
      stats={analyzeResult?.stats}
      ndvi={analyzeResult?.stats?.ndvi_mean}
      year={year}
      loading={loading}
    />
    <InsightPanel
      analysisData={analyzeResult ? {
        lat: analyzeResult.location.lat,
        lng: analyzeResult.location.lng,
        year: analyzeResult.year,
        location_name: analyzeResult.location.name || 'Unknown Forest',
        healthy_pct: analyzeResult.stats.healthy_pct,
        at_risk_pct: analyzeResult.stats.at_risk_pct,
        degraded_pct: analyzeResult.stats.degraded_pct,
        cleared_pct: analyzeResult.stats.cleared_pct,
        total_area_ha: analyzeResult.stats.total_area_ha,
        ndvi_mean: analyzeResult.stats.ndvi_mean,
        alert_level: analyzeResult.alert.level,
        risk_score: analyzeResult.alert.score,
      } : null}
    />
    <SaveParcelButton
      mode="analyze"
      lat={selectedPoint[0]}
      lng={selectedPoint[1]}
      radiusKm={radiusKm}
      year={analyzeResult.year}
      stats={analyzeResult.stats}
      alertLevel={analyzeResult.alert.level}
      riskScore={analyzeResult.alert.score}
      raw={analyzeResult}
    />
  </div>
)}

{activeTab === 'compare' && compareResult && !loading && (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <ComparePanel
  data={compareResult}
  loading={loading}
  onShowSat={() => setShowSatCompare(true)}
  resolvedYearA={resolveYear(yearA)}
  resolvedYearB={resolveYear(yearB)}
  radiusKm={radiusKm}
  onFlyToZone={handleZoneFlyTo}
  onShowZoneSatCompare={handleZoneShowSatCompare}
  onSetZoneCircle={handleZoneSetCircle}
/>
    <SaveParcelButton
      mode="compare"
      lat={selectedPoint[0]}
      lng={selectedPoint[1]}
      radiusKm={radiusKm}
      yearA={resolveYear(yearA).year}
      yearB={resolveYear(yearB).year}
      statsA={compareResult.stats_a}
      statsB={compareResult.stats_b}
      alertLevel={compareResult.alert.level}
      riskScore={compareResult.alert.score}
      raw={compareResult}
    />
  </div>
)}

          </div>
        </div>

        {/* Map */}
        <div style={{ flex: 1, position: 'relative' }}>
          <Map
            selectedPoint={hotZoneCircle ? [hotZoneCircle.lat, hotZoneCircle.lng] : (activeTab !== 'hotzones' ? selectedPoint : null)}
            alertLevel={analyzeResult?.alert?.level || compareResult?.alert?.level}
            onMapClick={handleMapClick}
            radiusKm={activeTab === 'hotzones' ? 2 : radiusKm}
            tiles={tiles}
            tilesLoading={tilesLoading}
            flyToPoint={flyToPoint}
          />
          
          {showTimeSeries && selectedPoint && activeTab === 'compare' && yearA !== "" && yearB !== "" && (
            <TimeSeriesPanel
              lat={selectedPoint[0]}
              lng={selectedPoint[1]}
              startYear={resolveYear(yearA).year}
              endYear={resolveYear(yearB).year}
              radiusKm={radiusKm}
              onClose={() => setShowTimeSeries(false)}
            />
          )}
          {showSatCompare && selectedPoint && tiles && compareResult && activeTab === 'compare' && (
            <SatelliteComparePanel
              yearA={yearA ? resolveYear(yearA).label : String(yearA)}
              yearB={yearB ? resolveYear(yearB).label : String(yearB)}
              statsA={compareResult.stats_a}
              statsB={compareResult.stats_b}
              tiles={tiles}
              selectedPoint={selectedPoint}
              radiusKm={radiusKm}
              onClose={() => setShowSatCompare(false)}
              onNavigate={(lat, lng) => setFlyToPoint([lat, lng])}
            />
          )}
          {/* Hot Zones satellite comparison panel */}
          {hotZoneSatData && (activeTab === 'hotzones' || activeTab === 'compare') && (
            <SatelliteComparePanel
              yearA={hotZoneSatData.yearA}
              yearB={hotZoneSatData.yearB}
              statsA={hotZoneSatData.statsA}
              statsB={hotZoneSatData.statsB}
              tiles={hotZoneSatData.tiles}
              selectedPoint={[hotZoneSatData.zone.lat, hotZoneSatData.zone.lng]}
              radiusKm={2}
              onClose={() => setHotZoneSatData(null)}
              onNavigate={(lat, lng) => setFlyToPoint([lat, lng, 16])}
            />
          )}
        </div>
      </div>
    </div>
  )
}
