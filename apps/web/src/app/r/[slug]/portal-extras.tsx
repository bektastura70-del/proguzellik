"use client";

import type { AppInfo } from "./portal-api";

/** Hesabım sekmesi ekleri (ana ekrana ekleme rehberi, bildirim ayarları) — PWA/Push fazlarında doldurulur. */
export function AccountExtras(_props: { slug: string; app: AppInfo; me: { email: string; notifyAppointments: boolean; notifyReminders: boolean } | null }) {
  return null;
}
