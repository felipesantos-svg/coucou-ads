import { emit, listen } from "@tauri-apps/api/event";
import { IS_TAURI } from "./bridge";

export interface TrafficSummary {
  entries?: { id: string; account: string; campaign: string; objective: string; status: string; currency: string; spend: number | null; clicks: number | null; impressions: number | null; fetchedAt: number; messageCost?: number | null; roas?: number | null }[];
  spendLabel?: string; account: string; currency: string; spend: number; clicks: number;
  impressions: number; days: number; fetchedAt: number;
}
export const SUMMARY_EVENT = "traffic-summary";
export const SUMMARY_REQUEST = "traffic-summary-request";
export async function publishSummary(summary: TrafficSummary | null) {
  if (IS_TAURI) await emit(SUMMARY_EVENT, summary);
}
export async function watchSummary(update: (summary: TrafficSummary | null) => void) {
  if (!IS_TAURI) return;
  await listen<TrafficSummary | null>(SUMMARY_EVENT, e => update(e.payload));
  await emit(SUMMARY_REQUEST);
}


export async function showAlertCenter() { if (IS_TAURI) { await emit('traffic-show-alerts'); } }


