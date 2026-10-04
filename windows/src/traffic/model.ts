// Monetary values are integer cents. The prototype never requests advertising APIs.
export type Platform = "meta" | "google";
export interface Client {
  id: string; name: string; objective: "sales" | "leads"; monthlyBudget: number;
  targetCpa: number; demo: boolean;
}
export interface Metrics { spend: number; impressions: number; clicks: number; conversions: number; revenue: number | null }
export interface Daily extends Metrics { day: number }
export interface Campaign {
  id: string; clientId: string; name: string; platform: Platform;
  status: "active" | "paused"; channel: string; daily: Daily[];
}
export interface Alert { id: string; campaignId: string; title: string; detail: string; severity: "attention" | "info" }
export const PLATFORM_NAME = { meta: "Meta Ads", google: "Google Ads" };
export const DEMO_CLIENTS: Client[] = [
  { id: "demo-atelier", name: "Ateliê Aurora", objective: "sales", monthlyBudget: 1600000, targetCpa: 4500, demo: true },
  { id: "demo-studio", name: "Studio Horizonte", objective: "leads", monthlyBudget: 900000, targetCpa: 3200, demo: true },
];
const definitions: [string, string, Platform, string, number, number][] = [
  ["prospecting", "Novos clientes · Coleção primavera", "meta", "Vendas", 23000, 7],
  ["remarketing", "Remarketing · Visitantes 30 dias", "meta", "Vendas", 13000, 3],
  ["search", "Pesquisa · Produtos e intenção", "google", "Pesquisa", 18000, 6],
  ["brand", "Pesquisa · Marca", "google", "Pesquisa", 4500, 3],
];
export const DEMO_CAMPAIGNS: Campaign[] = DEMO_CLIENTS.flatMap((client, ci) => definitions.map(([id, name, platform, channel, spend, conversions], i) => ({
  id: `${client.id}-${id}`, clientId: client.id, name: ci ? name.replace("Coleção primavera", "Avaliação inicial").replace("Produtos", "Serviços") : name,
  platform, channel: ci && platform === "meta" ? "Cadastros" : channel, status: "active" as const,
  daily: Array.from({ length: 28 }, (_, day) => {
    const factor = 0.86 + ((day * 7 + i * 3) % 11) / 30;
    const cost = Math.round(spend * factor * (ci ? 0.62 : 1));
    const results = Math.max(0, Math.round(conversions * factor * (i === 1 && day >= 21 ? 0.6 : 1)));
    return { day, spend: cost, impressions: Math.round(cost * (platform === "meta" ? 0.43 : 0.13)), clicks: Math.round(cost / (platform === "meta" ? 85 : 175)), conversions: results, revenue: client.objective === "sales" ? results * 24900 : null };
  }),
})));
export function summarize(rows: Metrics[]): Metrics {
  return rows.reduce<Metrics>((a, b) => ({
    spend: a.spend + b.spend, impressions: a.impressions + b.impressions,
    clicks: a.clicks + b.clicks, conversions: a.conversions + b.conversions,
    revenue: a.revenue === null || b.revenue === null ? null : a.revenue + b.revenue,
  }), { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: rows.length ? 0 : null });
}
export function ratio(n: number, d: number): number | null { return d > 0 ? n / d : null; }
export function metrics(c: Campaign, days: number, previous = false): Metrics {
  const end = previous ? 28 - days : 28;
  return summarize(c.daily.filter(d => d.day >= end - days && d.day < end));
}
export function change(current: number, previous: number): number | null { return previous > 0 ? (current - previous) / previous * 100 : null; }
export function alerts(campaigns: Campaign[], client: Client, days: number): Alert[] {
  return campaigns.filter(c => c.status === "active").flatMap(c => {
    const m = metrics(c, days);
    const cpa = ratio(m.spend, m.conversions);
    if (m.conversions < 10 || cpa === null || cpa <= client.targetCpa) return [];
    return [{ id: `${c.id}-cpa-${days}-${client.targetCpa}`, campaignId: c.id, title: `${client.objective === "sales" ? "CPA" : "CPL"} acima da meta`, detail: `${c.name}: ${m.conversions} resultados atribuídos no período. Revise público, oferta e atraso das conversões antes de decidir.`, severity: "attention" as const }];
  });
}
