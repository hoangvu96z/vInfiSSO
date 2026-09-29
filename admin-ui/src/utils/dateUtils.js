/**
 * Date & Timezone utilities for vInfiSSO Admin Dashboard
 * Ensures consistent timezone-based rendering across all tables,
 * independent of the client browser's local timezone.
 */

export const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh'; // GMT+7 (Vietnam Time)

export const TIMEZONE_OPTIONS = [
  { value: 'Asia/Ho_Chi_Minh', label: '🇻🇳 GMT+7 (Việt Nam)', shortLabel: 'GMT+7 (VN)', offset: '+07:00' },
  { value: 'Asia/Bangkok', label: '🇹🇭 GMT+7 (Bangkok)', shortLabel: 'GMT+7 (TH)', offset: '+07:00' },
  { value: 'Asia/Singapore', label: '🇸🇬 GMT+8 (Singapore)', shortLabel: 'GMT+8 (SG)', offset: '+08:00' },
  { value: 'Asia/Tokyo', label: '🇯🇵 GMT+9 (Tokyo / Seoul)', shortLabel: 'GMT+9 (JP)', offset: '+09:00' },
  { value: 'UTC', label: '🌐 UTC (Giờ Quốc Tế)', shortLabel: 'UTC (GMT+0)', offset: '+00:00' },
  { value: 'Europe/London', label: '🇬🇧 GMT+0 / +1 (London)', shortLabel: 'London', offset: '+00:00' },
  { value: 'Europe/Paris', label: '🇫🇷 GMT+1 / +2 (Paris / Berlin)', shortLabel: 'Paris', offset: '+01:00' },
  { value: 'America/New_York', label: '🇺🇸 GMT-5 / -4 (New York)', shortLabel: 'New York', offset: '-05:00' },
  { value: 'America/Chicago', label: '🇺🇸 GMT-6 / -5 (Chicago)', shortLabel: 'Chicago', offset: '-06:00' },
  { value: 'America/Los_Angeles', label: '🇺🇸 GMT-8 / -7 (Los Angeles)', shortLabel: 'LA (GMT-8)', offset: '-08:00' },
  { value: 'Australia/Sydney', label: '🇦🇺 GMT+10 / +11 (Sydney)', shortLabel: 'Sydney', offset: '+10:00' },
];

/**
 * Format any date input with a specific timezone
 * @param {string|number|Date} dateInput
 * @param {string} timezone e.g. 'Asia/Ho_Chi_Minh'
 * @param {'full'|'short'|'standard'|'dateOnly'|'timeOnly'} format
 * @returns {string}
 */
export function formatTimeWithZone(dateInput, timezone = DEFAULT_TIMEZONE, format = 'full') {
  if (!dateInput) return '-';
  const d = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return '-';

  const tz = timezone || DEFAULT_TIMEZONE;

  try {
    if (format === 'timeOnly') {
      return d.toLocaleTimeString('vi-VN', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    }

    if (format === 'dateOnly') {
      return d.toLocaleDateString('vi-VN', {
        timeZone: tz,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    }

    if (format === 'standard') {
      // 18:40:54 29/09/2026
      return d.toLocaleString('vi-VN', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    }

    // Default 'full' or 'short'
    const parts = new Intl.DateTimeFormat('vi-VN', {
      timeZone: tz,
      year: '2-digit',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: format === 'short' ? undefined : '2-digit',
      hour12: false,
    }).formatToParts(d);

    const map = {};
    parts.forEach((p) => {
      map[p.type] = p.value;
    });

    if (format === 'short') {
      // 18:40 29/9/26
      return `${map.hour}:${map.minute} ${map.day}/${map.month}/${map.year}`;
    }

    // 18:40:54 29/9/26 (Matches requested format)
    return `${map.hour}:${map.minute}:${map.second} ${map.day}/${map.month}/${map.year}`;
  } catch (err) {
    return d.toLocaleString('vi-VN');
  }
}

/**
 * Returns a human-friendly label for the given timezone value
 */
export function getTimezoneLabel(tzValue) {
  const match = TIMEZONE_OPTIONS.find((t) => t.value === tzValue);
  return match ? match.shortLabel : tzValue;
}
