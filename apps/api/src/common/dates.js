/**
 * @file apps/api/src/common/dates.js
 * Helpers for Indian Standard Time (IST, UTC+05:30) date handling and ranges.
 */

/**
 * Returns today's date in IST formatted as YYYY-MM-DD.
 * @returns {string}
 */
export function getTodayIST() {
  const now = new Date();
  // IST is UTC + 5 hours 30 minutes
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffsetMs);
  return istDate.toISOString().slice(0, 10);
}

/**
 * Returns the current month in IST formatted as YYYY-MM.
 * @returns {string}
 */
export function getCurrentMonthIST() {
  return getTodayIST().slice(0, 7);
}

/**
 * Generates an array of all YYYY-MM-DD date strings between from and to (inclusive).
 *
 * @param {string} from - YYYY-MM-DD
 * @param {string} to - YYYY-MM-DD
 * @returns {string[]}
 */
export function getDaysInRange(from, to) {
  const dates = [];
  const curr = new Date(from + 'T00:00:00.000Z');
  const end = new Date(to + 'T00:00:00.000Z');

  while (curr <= end) {
    dates.push(curr.toISOString().slice(0, 10));
    curr.setUTCDate(curr.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Returns the first day (YYYY-MM-01) and last day of a given YYYY-MM month.
 *
 * @param {string} monthStr - YYYY-MM
 * @returns {{ startDay: string, endDay: string, totalDays: number }}
 */
export function getMonthBounds(monthStr) {
  const [yearStr, monthNumStr] = monthStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthNumStr, 10); // 1-12

  // In Date constructor, month index is 0-11. Day 0 of next month is last day of month.
  const lastDate = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startDay = `${monthStr}-01`;
  const endDay = `${monthStr}-${String(lastDate).padStart(2, '0')}`;

  return { startDay, endDay, totalDays: lastDate };
}

/**
 * Computes how many months monthB is ahead of monthA (both in YYYY-MM format).
 *
 * @param {string} monthA - YYYY-MM
 * @param {string} monthB - YYYY-MM
 * @returns {number}
 */
export function monthsDiff(monthA, monthB) {
  const [yA, mA] = monthA.split('-').map(Number);
  const [yB, mB] = monthB.split('-').map(Number);
  return (yB - yA) * 12 + (mB - mA);
}
