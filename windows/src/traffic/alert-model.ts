export interface Rule { id: string; metric: "ctr" | "roas" | "message"; threshold: number; minImpressions: number; accountId: string }
export interface AlertEntry { id: string; account: string; campaign: string; objective: string; status: string; spend: number | null; clicks: number | null; impressions: number | null; fetchedAt: number; messageCost?: number | null; roas?: number | null }
export function parseRequest(text: string): Pick<Rule, "metric" | "threshold"> | null {
  const cost = text.trim().match(/^custo por mensagem\s+(?:acima de|>)\s*(\d+(?:[.,]\d+)?)$/i);
  if (cost) { const threshold = Number(cost[1].replace(",", ".")); return threshold > 0 && Number.isFinite(threshold) ? { metric: "message", threshold } : null; }
  const match = text.trim().match(/^(ctr|roas)\s+(?:baixo\s*:?|abaixo\s+de|<)\s*(\d+(?:[.,]\d+)?)\s*(%|x)?$/i);
  if (!match) return null;
  const metric = match[1].toLowerCase() as Rule["metric"], threshold = Number(match[2].replace(",", "."));
  if (!(threshold > 0) || !Number.isFinite(threshold) || (metric === "ctr" && (threshold > 100 || match[3] === "x")) || (metric === "roas" && match[3] === "%")) return null;
  return { metric, threshold };
}
export function evaluateRule(entry: AlertEntry, rule: Rule, now = Date.now() / 1000) {
  if (entry.status !== "Ativa" || (rule.accountId && entry.id.split("/")[0] !== rule.accountId)) return { state: "outside", value: null } as const;
  if (now - entry.fetchedAt > 86400) return { state: "stale", value: null } as const;
  if (entry.impressions === null || entry.impressions < rule.minImpressions || entry.impressions <= 0) return { state: "insufficient", value: null } as const;
  const value = rule.metric === "ctr" ? entry.clicks === null ? null : entry.clicks / entry.impressions * 100 : rule.metric === "message" ? entry.messageCost ?? null : entry.objective !== "Vendas" || !entry.spend || entry.roas == null ? null : entry.roas;
  if (value === null || !Number.isFinite(value)) return { state: "unavailable", value: null } as const;
  return { state: (rule.metric === "message" ? value > rule.threshold : value < rule.threshold) ? "alert" : "ok", value } as const;
}

