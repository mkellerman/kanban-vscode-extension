export interface PlanColor {
  border: string
  chipBg: string
  chipText: string
}

const PALETTE: PlanColor[] = [
  { border: '#7c3aed', chipBg: '#f5f3ff', chipText: '#6d28d9' }, // violet
  { border: '#0284c7', chipBg: '#e0f2fe', chipText: '#0369a1' }, // sky
  { border: '#059669', chipBg: '#d1fae5', chipText: '#065f46' }, // emerald
  { border: '#d97706', chipBg: '#fef3c7', chipText: '#b45309' }, // amber
  { border: '#e11d48', chipBg: '#fce7f3', chipText: '#9f1239' }, // rose
  { border: '#a21caf', chipBg: '#fdf4ff', chipText: '#86198f' }, // fuchsia
  { border: '#0d9488', chipBg: '#ccfbf1', chipText: '#115e59' }, // teal
  { border: '#ea580c', chipBg: '#fff7ed', chipText: '#9a3412' }, // orange
]

function simpleHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0
  }
  return h
}

export function getPlanColor(featureId: string): PlanColor {
  return PALETTE[simpleHash(featureId) % PALETTE.length]
}
