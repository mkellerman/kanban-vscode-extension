import { describe, it, expect } from 'vitest'
import { parseDueDateLocal, isOverdue, isToday, isThisWeek } from '../../src/shared/dateUtils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function localMidnight(offsetDays = 0): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (offsetDays !== 0) d.setDate(d.getDate() + offsetDays)
  return d
}

// ---------------------------------------------------------------------------
// parseDueDateLocal
// ---------------------------------------------------------------------------

describe('parseDueDateLocal', () => {
  it('returns null for null', () => {
    expect(parseDueDateLocal(null)).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(parseDueDateLocal(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseDueDateLocal('')).toBeNull()
  })

  it('returns null for an invalid date string', () => {
    expect(parseDueDateLocal('not-a-date')).toBeNull()
  })

  it('returns a Date at local midnight for a valid YYYY-MM-DD string', () => {
    const result = parseDueDateLocal('2026-06-15')
    expect(result).not.toBeNull()
    expect(result!.getHours()).toBe(0)
    expect(result!.getMinutes()).toBe(0)
    expect(result!.getSeconds()).toBe(0)
    expect(result!.getMilliseconds()).toBe(0)
    expect(result!.getFullYear()).toBe(2026)
    expect(result!.getMonth()).toBe(5) // June is month 5
    expect(result!.getDate()).toBe(15)
  })

  it('produces a local date (not UTC) so local date fields match the string', () => {
    // If the implementation were `new Date("2026-01-01")` it would parse as
    // UTC midnight, and in a negative-offset timezone the local date would be
    // Dec 31. With the T00:00:00 suffix it is always local midnight.
    const result = parseDueDateLocal('2026-01-01')!
    expect(result.getFullYear()).toBe(2026)
    expect(result.getMonth()).toBe(0)
    expect(result.getDate()).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// isOverdue
// ---------------------------------------------------------------------------

describe('isOverdue', () => {
  it('returns true for yesterday', () => {
    expect(isOverdue(localMidnight(-1))).toBe(true)
  })

  it('returns false for today (local midnight)', () => {
    expect(isOverdue(localMidnight(0))).toBe(false)
  })

  it('returns false for tomorrow', () => {
    expect(isOverdue(localMidnight(1))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isToday
// ---------------------------------------------------------------------------

describe('isToday', () => {
  it('returns true for today (local midnight)', () => {
    expect(isToday(localMidnight(0))).toBe(true)
  })

  it('returns false for yesterday', () => {
    expect(isToday(localMidnight(-1))).toBe(false)
  })

  it('returns false for tomorrow', () => {
    expect(isToday(localMidnight(1))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isThisWeek
// ---------------------------------------------------------------------------

describe('isThisWeek', () => {
  it('returns true for today', () => {
    expect(isThisWeek(localMidnight(0))).toBe(true)
  })

  it('returns true for the start of the current week (last Sunday)', () => {
    const today = new Date()
    const startOfWeek = new Date(today)
    startOfWeek.setDate(today.getDate() - today.getDay())
    startOfWeek.setHours(0, 0, 0, 0)
    expect(isThisWeek(startOfWeek)).toBe(true)
  })

  it('returns true for the last day of the week (this Saturday)', () => {
    const today = new Date()
    const startOfWeek = new Date(today)
    startOfWeek.setDate(today.getDate() - today.getDay())
    startOfWeek.setHours(0, 0, 0, 0)
    const saturday = new Date(startOfWeek)
    saturday.setDate(startOfWeek.getDate() + 6)
    expect(isThisWeek(saturday)).toBe(true)
  })

  it('returns false for a date 8 days out', () => {
    expect(isThisWeek(localMidnight(8))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Badge / filter consistency
// ---------------------------------------------------------------------------

describe('badge and filter consistency', () => {
  it('a local-midnight Date for today passes isToday and not isOverdue', () => {
    const today = localMidnight(0)
    expect(isToday(today)).toBe(true)
    expect(isOverdue(today)).toBe(false)
  })

  it('a local-midnight Date for yesterday passes isOverdue and not isToday', () => {
    const yesterday = localMidnight(-1)
    expect(isOverdue(yesterday)).toBe(true)
    expect(isToday(yesterday)).toBe(false)
  })
})
