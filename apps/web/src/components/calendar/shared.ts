import type { Appointment } from "@/components/panel/types";

export const START_H = 8;
export const END_H = 22;
export const PX_PER_MIN = 1.2;
export const SNAP = 15;

export type TimeOff = { id: string; startsAt: string; endsAt: string; reason: string | null; staff: { id: string; displayName: string } };

export const STATUS_STYLE: Record<string, string> = {
  BOOKED: "border-amber-400 bg-amber-50 text-amber-950",
  CONFIRMED: "border-sky-500 bg-sky-50 text-sky-950",
  COMPLETED: "border-emerald-500 bg-emerald-50 text-emerald-950",
  NO_SHOW: "border-red-400 bg-red-50 text-red-900 opacity-70",
  CANCELLED: "border-neutral-300 bg-neutral-100 text-neutral-500 line-through opacity-60",
};
export const STATUS_DOT: Record<string, string> = {
  BOOKED: "bg-amber-400",
  CONFIRMED: "bg-sky-500",
  COMPLETED: "bg-emerald-500",
  NO_SHOW: "bg-red-400",
  CANCELLED: "bg-neutral-300",
};

export const movable = (a: Appointment) => a.status === "BOOKED" || a.status === "CONFIRMED";

/** Çakışan randevuları yan yana yerleştirmek için şerit ataması. */
export function layoutLanes<T extends { startsAt: string; endsAt: string }>(items: T[]) {
  const sorted = [...items].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const out: { item: T; lane: number; lanes: number }[] = [];
  let group: { item: T; lane: number }[] = [];
  let groupEnd = "";
  const flush = () => {
    const lanes = Math.max(1, ...group.map((g) => g.lane + 1));
    group.forEach((g) => out.push({ ...g, lanes }));
    group = [];
  };
  for (const item of sorted) {
    if (group.length && item.startsAt >= groupEnd) flush();
    const used = new Set(group.filter((g) => g.item.endsAt > item.startsAt).map((g) => g.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    group.push({ item, lane });
    if (item.endsAt > groupEnd) groupEnd = item.endsAt;
  }
  flush();
  return out;
}
