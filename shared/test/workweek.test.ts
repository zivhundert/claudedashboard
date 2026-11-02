import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKWEEK,
  addDays,
  formatWorkweek,
  isWorkday,
  parseWeekStart,
  parseWorkweek,
  weekStartOf,
  weekdayOf,
  weekdayOrder,
  workdaysBetween,
} from '../src/time/workweek.js';

const sorted = (s: ReadonlySet<number>): number[] => [...s].sort((a, b) => a - b);

describe('parseWorkweek', () => {
  it('reads the presets', () => {
    expect(sorted(parseWorkweek('sun-thu'))).toEqual([0, 1, 2, 3, 4]);
    expect(sorted(parseWorkweek('mon-fri'))).toEqual([1, 2, 3, 4, 5]);
  });

  it('reads lists of day names or numbers, ignoring case, spaces and duplicates', () => {
    expect(sorted(parseWorkweek('mon,tue,wed,thu,fri'))).toEqual([1, 2, 3, 4, 5]);
    expect(sorted(parseWorkweek('0,1,2,3,4'))).toEqual([0, 1, 2, 3, 4]);
    expect(sorted(parseWorkweek('  Mon , WED,fri '))).toEqual([1, 3, 5]);
    expect(sorted(parseWorkweek(' MON-FRI '))).toEqual([1, 2, 3, 4, 5]);
    expect(sorted(parseWorkweek('sat,6,sat'))).toEqual([6]);
    expect(sorted(parseWorkweek('mon,tue,'))).toEqual([1, 2]);
  });

  it('rejects unknown days and lists with no days, naming the culprit', () => {
    expect(() => parseWorkweek('mon-fry')).toThrow(/unknown day "mon-fry"/);
    expect(() => parseWorkweek('xyz')).toThrow(/unknown day "xyz"/);
    expect(() => parseWorkweek('mon,7')).toThrow(/unknown day "7"/);
    expect(() => parseWorkweek('monday')).toThrow(RangeError);
    expect(() => parseWorkweek(',')).toThrow(/no days/);
    expect(() => parseWorkweek(' , ')).toThrow(/no days/);
    expect(() => parseWorkweek('')).toThrow(/no days/);
  });
});

describe('parseWeekStart', () => {
  it('reads sun and mon in any case', () => {
    expect(parseWeekStart('sun')).toBe(0);
    expect(parseWeekStart(' MON ')).toBe(1);
  });

  it('rejects anything else', () => {
    expect(() => parseWeekStart('wed')).toThrow(/unknown week start "wed"/);
    expect(() => parseWeekStart('1')).toThrow(RangeError);
  });
});

describe('isWorkday', () => {
  it('follows the given week', () => {
    expect(isWorkday('2026-10-25', DEFAULT_WORKWEEK)).toBe(true); // Sunday
    expect(isWorkday('2026-10-30', DEFAULT_WORKWEEK)).toBe(false); // Friday
    const monFri = parseWorkweek('mon-fri');
    expect(isWorkday('2026-10-25', monFri)).toBe(false);
    expect(isWorkday('2026-10-30', monFri)).toBe(true);
  });
});

describe('workdaysBetween', () => {
  // 2026-10-26 is a Monday, 2026-10-30 the Friday after it
  it('counts a Mon–Fri range by the configured week', () => {
    expect(weekdayOf('2026-10-26')).toBe(1);
    expect(workdaysBetween('2026-10-26', '2026-10-30', parseWorkweek('mon-fri'))).toBe(5);
    expect(workdaysBetween('2026-10-26', '2026-10-30', parseWorkweek('sun-thu'))).toBe(4);
  });

  it('gives 5 for any full week under either five-day week', () => {
    for (const start of ['2026-10-25', '2026-10-26', '2026-10-29']) {
      const end = addDays(start, 6);
      expect(workdaysBetween(start, end, parseWorkweek('mon-fri'))).toBe(5);
      expect(workdaysBetween(start, end, parseWorkweek('sun-thu'))).toBe(5);
    }
  });

  it('handles a single-day range', () => {
    expect(workdaysBetween('2026-10-30', '2026-10-30', parseWorkweek('mon-fri'))).toBe(1);
    expect(workdaysBetween('2026-10-30', '2026-10-30', DEFAULT_WORKWEEK)).toBe(0);
  });
});

describe('weekStartOf', () => {
  it('Sunday weeks', () => {
    expect(weekStartOf('2026-10-25', 0)).toBe('2026-10-25'); // the Sunday itself
    expect(weekStartOf('2026-10-31', 0)).toBe('2026-10-25'); // Saturday
    expect(weekStartOf('2026-10-26', 0)).toBe('2026-10-25');
  });

  it('Monday weeks', () => {
    expect(weekStartOf('2026-10-26', 1)).toBe('2026-10-26'); // the Monday itself
    expect(weekStartOf('2026-11-01', 1)).toBe('2026-10-26'); // Sunday closes the week
    expect(weekStartOf('2026-10-31', 1)).toBe('2026-10-26');
  });

  it('crosses month and year boundaries', () => {
    expect(weekStartOf('2026-12-03', 0)).toBe('2026-11-29'); // Thursday
    expect(weekStartOf('2026-12-03', 1)).toBe('2026-11-30');
    expect(weekStartOf('2027-01-02', 0)).toBe('2026-12-27'); // Saturday
    expect(weekStartOf('2027-01-02', 1)).toBe('2026-12-28');
    expect(weekStartOf('2027-01-03', 1)).toBe('2026-12-28'); // Sunday
  });

  it('always lands on the week-start weekday, at most 6 days back', () => {
    for (let d = 0; d < 21; d++) {
      const date = addDays('2026-12-20', d);
      for (const ws of [0, 1] as const) {
        const start = weekStartOf(date, ws);
        expect(weekdayOf(start)).toBe(ws);
        expect(start <= date && start > addDays(date, -7)).toBe(true);
      }
    }
  });
});

describe('weekdayOrder / formatWorkweek', () => {
  it('orders weekdays from the week start', () => {
    expect(weekdayOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it('labels contiguous weeks as a range, even across the week start', () => {
    expect(formatWorkweek(parseWorkweek('sun-thu'), 0)).toBe('Sun–Thu');
    expect(formatWorkweek(parseWorkweek('mon-fri'), 0)).toBe('Mon–Fri');
    expect(formatWorkweek(parseWorkweek('sun-thu'), 1)).toBe('Sun–Thu');
    expect(formatWorkweek(parseWorkweek('fri,sat,sun'), 0)).toBe('Fri–Sun');
    expect(formatWorkweek(parseWorkweek('0,1,2,3,4,5,6'), 1)).toBe('Mon–Sun');
  });

  it('lists anything else in week order', () => {
    expect(formatWorkweek(parseWorkweek('mon,wed,fri'), 0)).toBe('Mon, Wed, Fri');
    expect(formatWorkweek(parseWorkweek('sun,tue'), 1)).toBe('Tue, Sun');
    expect(formatWorkweek(parseWorkweek('wed'), 0)).toBe('Wed');
  });
});
