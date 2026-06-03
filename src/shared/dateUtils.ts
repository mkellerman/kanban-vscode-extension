/**
 * Parses a YYYY-MM-DD date string as local midnight (not UTC).
 * The T00:00:00 suffix ensures dates are interpreted in the local timezone,
 * preventing off-by-one-day errors in UTC− zones where UTC midnight would resolve to the previous calendar day.
 */
export function parseDueDateLocal(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  return isNaN(d.getTime()) ? null : d
}

export function isOverdue(date: Date): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date < today
}

export function isToday(date: Date): boolean {
  const today = new Date()
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  )
}

export function isThisWeek(date: Date): boolean {
  const today = new Date()
  const startOfWeek = new Date(today)
  startOfWeek.setDate(today.getDate() - today.getDay())
  startOfWeek.setHours(0, 0, 0, 0)
  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 7)
  return date >= startOfWeek && date < endOfWeek
}
