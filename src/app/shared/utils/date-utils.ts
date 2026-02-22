/**
 * Shared utility functions for date handling
 */

/**
 * Safely convert any date-like value to a Date object.
 * Handles: Date objects, ISO strings, timestamps, null/undefined.
 *
 * @param value - The value to convert (Date, string, number, or unknown)
 * @returns A valid Date object or null if conversion fails
 *
 * @example
 * toDate(new Date()) // returns Date object
 * toDate('2024-01-15T10:30:00.000Z') // returns Date object
 * toDate(1705315800000) // returns Date object
 * toDate(null) // returns null
 * toDate('invalid') // returns null
 */
export function toDate(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  return null;
}

/**
 * Format a date as a relative time string (e.g., "5 minutes ago").
 * Falls back to locale date string for dates older than 7 days.
 *
 * @param date - The date to format (Date, string, number, or unknown)
 * @returns Formatted relative time string, or empty string if invalid
 *
 * @example
 * formatRelativeDate(new Date()) // "Just now"
 * formatRelativeDate(new Date(Date.now() - 300000)) // "5 minutes ago"
 * formatRelativeDate('2024-01-01') // "1/1/2024" (or locale equivalent)
 */
export function formatRelativeDate(date: unknown): string {
  const d = toDate(date);
  if (!d) return '';

  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 7) {
    return d.toLocaleDateString();
  } else if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''} ago`;
  } else if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  } else {
    return 'Just now';
  }
}

/**
 * Format a date as a locale-aware date/time string.
 *
 * @param date - The date to format (Date, string, number, or unknown)
 * @returns Formatted date/time string, or empty string if invalid
 *
 * @example
 * formatDateTime(new Date()) // "1/15/2024, 10:30:00 AM" (or locale equivalent)
 */
export function formatDateTime(date: unknown): string {
  const d = toDate(date);
  if (!d) return '';
  return d.toLocaleString();
}
