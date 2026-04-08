// Shared year options used in Analyze, Compare, and Hot Zones tabs.
// Monthly 2026 entries appear at the top; full years 2003–2025 follow.

const MONTHLY_2026 = [
  { value: 'Mar 2026', label: 'Mar 2026', year: 2026, dateStart: '2026-03-01', dateEnd: '2026-03-31' },
  { value: 'Feb 2026', label: 'Feb 2026', year: 2026, dateStart: '2026-02-01', dateEnd: '2026-02-28' },
  { value: 'Jan 2026', label: 'Jan 2026', year: 2026, dateStart: '2026-01-01', dateEnd: '2026-01-31' },
]

const YEARLY = Array.from({ length: 23 }, (_, i) => ({
  value:     2025 - i,
  label:     String(2025 - i),
  year:      2025 - i,
  dateStart: null,
  dateEnd:   null,
}))

export const YEAR_OPTIONS = [...MONTHLY_2026, ...YEARLY]

const YEAR_OPTIONS_MAP = Object.fromEntries(YEAR_OPTIONS.map(o => [String(o.value), o]))

/** Resolve a raw select value (number or string like "Jan 2026") to the full option object. */
export function resolveYear(v) {
  return YEAR_OPTIONS_MAP[String(v)] || {
    value: v, label: String(v), year: Number(v) || 2024, dateStart: null, dateEnd: null,
  }
}
