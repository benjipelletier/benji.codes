// The study day. Days turn over at 04:00 local time, not midnight, so a late
// session still counts for the day it started in. A card is due "today" if it
// is due before the day ends, whatever the hour.

export const ROLLOVER_HOUR = 4;

export interface StudyDay {
  /** YYYY-MM-DD, the local date the day began on. */
  day: string;
  /** When it ends: the next 04:00, in ms. */
  cutoff: number;
}

/** The study day a moment falls in, in the timezone this runs in (the owner's, in the browser). */
export function studyDay(at: number = Date.now()): StudyDay {
  const shifted = new Date(at - ROLLOVER_HOUR * 3_600_000);
  const day = `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}-${String(shifted.getDate()).padStart(2, "0")}`;
  const end = new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate() + 1, ROLLOVER_HOUR);
  return { day, cutoff: end.getTime() };
}

export function isStudyDay(v: unknown): v is StudyDay {
  if (!v || typeof v !== "object") return false;
  const d = v as StudyDay;
  return typeof d.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.day) && typeof d.cutoff === "number" && Number.isFinite(d.cutoff);
}
