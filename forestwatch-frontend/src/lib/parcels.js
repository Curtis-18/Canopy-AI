import { supabase } from '../supabaseClient'

async function createParcel({ name, lat, lng, radiusKm }) {
  const { data, error } = await supabase
    .from('parcels')
    .insert({ name, lat, lng, radius_km: radiusKm })
    .select()
    .single()

  if (error) throw error
  return data
}

async function createScan(parcelId, { year, stats, alertLevel, riskScore, raw }) {
  const { data, error } = await supabase
    .from('scans')
    .insert({
      parcel_id: parcelId,
      year,
      healthy_pct: stats?.healthy_pct ?? null,
      at_risk_pct: stats?.at_risk_pct ?? null,
      degraded_pct: stats?.degraded_pct ?? null,
      cleared_pct: stats?.cleared_pct ?? null,
      ndvi_mean: stats?.ndvi_mean ?? null,
      risk_score: riskScore ?? null,
      alert_level: alertLevel ?? null,
      raw_response: raw ?? null,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function saveAnalyzeAsParcel({ name, lat, lng, radiusKm, year, stats, alertLevel, riskScore, raw }) {
  const parcel = await createParcel({ name, lat, lng, radiusKm })
  const scan = await createScan(parcel.id, { year, stats, alertLevel, riskScore, raw })
  return { parcel, scan }
}

export async function saveCompareAsParcel({ name, lat, lng, radiusKm, yearA, statsA, yearB, statsB, alertLevel, riskScore, raw }) {
  const parcel = await createParcel({ name, lat, lng, radiusKm })
  const scanA = await createScan(parcel.id, { year: yearA, stats: statsA })
  const scanB = await createScan(parcel.id, { year: yearB, stats: statsB, alertLevel, riskScore, raw })
  return { parcel, scanA, scanB }
}