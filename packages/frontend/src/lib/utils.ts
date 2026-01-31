import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Timezone utilities
export const TIMEZONE_OPTIONS = [
  { value: 'auto', label: 'Browser Default', offset: '' },
  { value: 'UTC', label: 'UTC', offset: '+00:00' },
  // Americas
  { value: 'America/New_York', label: 'Eastern Time (US)', offset: '-05:00' },
  { value: 'America/Chicago', label: 'Central Time (US)', offset: '-06:00' },
  { value: 'America/Denver', label: 'Mountain Time (US)', offset: '-07:00' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (US)', offset: '-08:00' },
  // Europe
  { value: 'Europe/London', label: 'London (GMT)', offset: '+00:00' },
  { value: 'Europe/Paris', label: 'Paris (CET)', offset: '+01:00' },
  { value: 'Europe/Berlin', label: 'Berlin (CET)', offset: '+01:00' },
  // Asia
  { value: 'Asia/Dubai', label: 'Dubai (GST)', offset: '+04:00' },
  { value: 'Asia/Kolkata', label: 'Mumbai (IST)', offset: '+05:30' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)', offset: '+08:00' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong (HKT)', offset: '+08:00' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)', offset: '+09:00' },
  // Australia
  { value: 'Australia/Sydney', label: 'Sydney (AEST)', offset: '+10:00' },
] as const;

export type TimezoneValue = typeof TIMEZONE_OPTIONS[number]['value'];

const TIMEZONE_STORAGE_KEY = 'verbatim-timezone';

export function getStoredTimezone(): TimezoneValue {
  if (typeof window === 'undefined') return 'auto';
  return (localStorage.getItem(TIMEZONE_STORAGE_KEY) as TimezoneValue) || 'auto';
}

export function setStoredTimezone(timezone: TimezoneValue): void {
  localStorage.setItem(TIMEZONE_STORAGE_KEY, timezone);
  // Dispatch event so components can react to timezone changes
  window.dispatchEvent(new CustomEvent('timezone-change', { detail: timezone }));
}

function getEffectiveTimezone(timezone: TimezoneValue): string | undefined {
  if (timezone === 'auto') {
    return undefined; // Use browser default
  }
  return timezone;
}

/**
 * Format a date string from the backend (UTC without Z suffix) to the user's selected timezone.
 * The backend returns timestamps like "2026-01-31T15:13:48" which are in UTC.
 */
export function formatDateTime(
  dateString: string | Date | null | undefined,
  options?: {
    timezone?: TimezoneValue;
    includeTime?: boolean;
    includeSeconds?: boolean;
  }
): string {
  if (!dateString) return '';

  const { timezone = getStoredTimezone(), includeTime = true, includeSeconds = false } = options || {};

  // Parse the date - append Z if no timezone indicator to treat as UTC
  let date: Date;
  if (typeof dateString === 'string') {
    // Backend sends UTC times without Z suffix, so add it
    const normalized = dateString.includes('Z') || dateString.includes('+') || dateString.includes('-', 10)
      ? dateString
      : dateString + 'Z';
    date = new Date(normalized);
  } else {
    date = dateString;
  }

  if (isNaN(date.getTime())) return '';

  const effectiveTimezone = getEffectiveTimezone(timezone);

  const dateOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(effectiveTimezone && { timeZone: effectiveTimezone }),
  };

  if (includeTime) {
    dateOptions.hour = '2-digit';
    dateOptions.minute = '2-digit';
    if (includeSeconds) {
      dateOptions.second = '2-digit';
    }
  }

  return date.toLocaleString(undefined, dateOptions);
}

/**
 * Format just the date portion.
 */
export function formatDate(dateString: string | Date | null | undefined, timezone?: TimezoneValue): string {
  return formatDateTime(dateString, { timezone, includeTime: false });
}

/**
 * Format just the time portion.
 */
export function formatTime(
  dateString: string | Date | null | undefined,
  options?: { timezone?: TimezoneValue; includeSeconds?: boolean }
): string {
  if (!dateString) return '';

  const { timezone = getStoredTimezone(), includeSeconds = false } = options || {};

  let date: Date;
  if (typeof dateString === 'string') {
    const normalized = dateString.includes('Z') || dateString.includes('+') || dateString.includes('-', 10)
      ? dateString
      : dateString + 'Z';
    date = new Date(normalized);
  } else {
    date = dateString;
  }

  if (isNaN(date.getTime())) return '';

  const effectiveTimezone = getEffectiveTimezone(timezone);

  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds && { second: '2-digit' }),
    ...(effectiveTimezone && { timeZone: effectiveTimezone }),
  };

  return date.toLocaleTimeString(undefined, timeOptions);
}

/**
 * Format a relative time string (e.g., "2 hours ago", "yesterday").
 */
export function formatRelativeTime(dateString: string | Date | null | undefined, timezone?: TimezoneValue): string {
  if (!dateString) return '';

  let date: Date;
  if (typeof dateString === 'string') {
    const normalized = dateString.includes('Z') || dateString.includes('+') || dateString.includes('-', 10)
      ? dateString
      : dateString + 'Z';
    date = new Date(normalized);
  } else {
    date = dateString;
  }

  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  // Fall back to formatted date for older items
  return formatDateTime(date, { timezone, includeTime: false });
}
