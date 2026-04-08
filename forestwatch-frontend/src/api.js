const BASE = 'http://localhost:8000'

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body) opts.body = JSON.stringify(body)

  const res = await fetch(`${BASE}${path}`, opts)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export const analyzeForest = (lat, lng, year, radius_km = 5, opts = {}) =>
  api('POST', '/analyze', { lat, lng, year, radius_km, ...opts })

export const compareForest = (lat, lng, year_a, year_b, radius_km = 5, opts = {}) =>
  api('POST', '/compare', { lat, lng, year_a, year_b, radius_km, ...opts })

export const getMapTiles = (lat, lng, year_a, year_b, radius_km = 10, opts = {}) =>
  api('POST', '/tiles', { lat, lng, year_a, year_b, radius_km, ...opts })

export const listForests = () =>
  api('GET', '/forests').then(d => d.forests)

export const getPhoto = (lat, lng, year_a, year_b) =>
  api('POST', '/photo', { lat, lng, year_a, year_b })

export const scanHotZones = (forest_name, year_a, year_b, radius_km = 2, opts = {}) =>
  api('POST', '/hotzones', { forest_name, year_a, year_b, radius_km, ...opts })

export const getInsight = (data) =>
  api('POST', '/insight', data)