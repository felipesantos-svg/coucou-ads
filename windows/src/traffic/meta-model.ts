export interface Account { id: string; name: string; currency: string; timezone_name: string; account_status?: number | null }
export function activeAccounts(accounts: Account[]) { return accounts.filter(a => a.account_status === 1); }
export function groupedTotals(reports: Report[]) {
  const groups = new Map<string, { currency: string; spend: number; clicks: number; impressions: number }>();
  for (const report of reports) {
    const currency = report.account.currency;
    const group = groups.get(currency) ?? { currency, spend: 0, clicks: 0, impressions: 0 };
    const total = totals(report.rows);
    group.spend += total.spend; group.clicks += total.clicks; group.impressions += total.impressions;
    groups.set(currency, group);
  }
  return [...groups.values()];
}
export interface Insight { campaign_id: string; campaign_name: string; date_start: string; date_stop: string; spend: string; impressions: string; clicks: string; website_purchase_roas?: { action_type: string; value: string }[]; actions: { action_type: string; value: string }[] }
export interface CampaignInfo { id: string; name: string; objective: string | null; effective_status: string | null }
export interface Report { account: Account; campaigns: CampaignInfo[]; rows: Insight[]; fetchedAt: number; apiVersion: string }
export function objectiveLabel(objective: string | null | undefined) {
  const names: Record<string, string> = { OUTCOME_SALES: "Vendas", CONVERSIONS: "Conversões", PRODUCT_CATALOG_SALES: "Vendas do catálogo", OUTCOME_LEADS: "Leads", LEAD_GENERATION: "Leads", OUTCOME_TRAFFIC: "Tráfego", LINK_CLICKS: "Tráfego", OUTCOME_ENGAGEMENT: "Engajamento", POST_ENGAGEMENT: "Engajamento", MESSAGES: "Mensagens", OUTCOME_AWARENESS: "Reconhecimento", BRAND_AWARENESS: "Reconhecimento", REACH: "Alcance", OUTCOME_APP_PROMOTION: "Promoção de app", APP_INSTALLS: "Instalações do app", VIDEO_VIEWS: "Visualizações de vídeo" };
  return objective ? names[objective] ?? objective : "Objetivo não informado";
}
export function numeric(value: string): number {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error("Métrica inválida recebida do Meta.");
  const result = Number(value);
  if (!Number.isFinite(result) || result > Number.MAX_SAFE_INTEGER) throw new Error("Métrica fora do limite suportado.");
  return result;
}
export function resultCount(row: Insight, action: string): number | null {
  if (!action) return null;
  const matches = row.actions.filter(a => a.action_type === action);
  if (matches.length > 1) throw new Error("Ação duplicada na resposta do Meta.");
  return matches.length ? numeric(matches[0].value) : 0;
}
export function totals(rows: Insight[]) {
  return rows.reduce((total, row) => ({ spend: total.spend + numeric(row.spend), impressions: total.impressions + numeric(row.impressions), clicks: total.clicks + numeric(row.clicks) }), { spend: 0, impressions: 0, clicks: 0 });
}

