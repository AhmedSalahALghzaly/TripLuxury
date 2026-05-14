/**
 * Convert minutes-since-midnight (integer stored in DB) to "HH:MM" display string.
 * Returns null if value is null/undefined/0-and-open.
 */
export function minutesToHHMM(minutes: number | null | undefined): string | null {
  if (minutes == null || minutes < 0) return null;
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Convert "HH:MM" string to minutes-since-midnight integer for DB storage.
 * Returns null if the string is empty or invalid.
 */
export function hhmmToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const parts = hhmm.split(':');
  if (parts.length !== 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Format a minutes-since-midnight value into a human-readable label.
 * e.g. 480 → "08:00 ص" (Arabic) or "08:00 AM" (English)
 */
export function formatOpeningHours(
  openMinutes: number | null | undefined,
  closeMinutes: number | null | undefined,
  language: string,
): string | null {
  const open = minutesToHHMM(openMinutes);
  const close = minutesToHHMM(closeMinutes);
  if (!open && !close) return null;

  const fmt = (mins: number, lang: string) => {
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    const period = h < 12 ? (lang === 'ar' ? 'ص' : 'AM') : (lang === 'ar' ? 'م' : 'PM');
    const displayH = h % 12 || 12;
    return `${String(displayH).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
  };

  if (open && close) {
    const o = openMinutes as number;
    const c = closeMinutes as number;
    return language === 'ar'
      ? `${fmt(o, 'ar')} — ${fmt(c, 'ar')}`
      : `${fmt(o, 'en')} — ${fmt(c, 'en')}`;
  }
  if (openMinutes != null) return language === 'ar' ? `فتح: ${fmt(openMinutes, 'ar')}` : `Open: ${fmt(openMinutes, 'en')}`;
  if (closeMinutes != null) return language === 'ar' ? `إغلاق: ${fmt(closeMinutes as number, 'ar')}` : `Close: ${fmt(closeMinutes as number, 'en')}`;
  return null;
}

export interface OpenStatus {
  isOpen: boolean;
  label: string;
  sublabel: string | null;
}

export interface DayHours {
  day_of_week: number;
  open_minutes: number | null;
  close_minutes: number | null;
  is_closed: boolean;
}

/**
 * Determine open/closed status from a per-day schedule array.
 * Uses today's day-of-week (0=Sunday) to find the matching row.
 * Falls back to getOpenStatus when hours are available.
 */
export function getOpenStatusFromSchedule(
  schedule: DayHours[],
  language: string,
): OpenStatus | null {
  if (!Array.isArray(schedule) || schedule.length === 0) return null;
  const today = new Date().getDay();
  const todayRow = schedule.find((h) => h.day_of_week === today);
  if (!todayRow) return null;
  const isAr = language === 'ar';
  if (todayRow.is_closed) {
    return {
      isOpen: false,
      label: isAr ? 'مغلق اليوم' : 'Closed Today',
      sublabel: null,
    };
  }
  return getOpenStatus(todayRow.open_minutes, todayRow.close_minutes, language);
}

/**
 * Compute whether a restaurant is currently open, handling overnight hours.
 * - openMin / closeMin: minutes-since-midnight from the DB (year_start / year_end)
 * - language: 'ar' or 'en'
 * Returns null if either value is missing.
 *
 * Sublabel rules:
 *   - When OPEN and closing within 60 min  → "Closes at HH:MM" / "يغلق HH:MM"
 *   - When CLOSED                          → "Opens at HH:MM"  / "يفتح HH:MM"
 */
export function getOpenStatus(
  openMin: number | null | undefined,
  closeMin: number | null | undefined,
  language: string,
): OpenStatus | null {
  if (openMin == null || closeMin == null) return null;

  const now = new Date();
  const currentMin = now.getHours() * 60 + now.getMinutes();

  let isOpen: boolean;
  if (openMin <= closeMin) {
    isOpen = currentMin >= openMin && currentMin < closeMin;
  } else {
    // Overnight hours (e.g. 22:00 → 02:00)
    isOpen = currentMin >= openMin || currentMin < closeMin;
  }

  const isAr = language === 'ar';
  const label = isOpen
    ? (isAr ? 'مفتوح' : 'Open Now')
    : (isAr ? 'مغلق' : 'Closed');

  let sublabel: string | null = null;

  if (isOpen) {
    let minutesUntilClose: number;
    if (openMin <= closeMin) {
      minutesUntilClose = closeMin - currentMin;
    } else {
      // Overnight: if we're in the "before midnight" open window
      minutesUntilClose =
        currentMin >= openMin
          ? 24 * 60 - currentMin + closeMin
          : closeMin - currentMin;
    }
    if (minutesUntilClose > 0 && minutesUntilClose <= 60) {
      const closeHHMM = minutesToHHMM(closeMin);
      sublabel = isAr ? `يغلق ${closeHHMM}` : `Closes at ${closeHHMM}`;
    }
  } else {
    const openHHMM = minutesToHHMM(openMin);
    sublabel = isAr ? `يفتح ${openHHMM}` : `Opens at ${openHHMM}`;
  }

  return { isOpen, label, sublabel };
}
