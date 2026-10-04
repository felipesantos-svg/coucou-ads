import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, ratio, change, metrics, alerts, DEMO_CLIENTS, DEMO_CAMPAIGNS } from '../src/traffic/model.ts';

test('zero denominators and missing revenue remain unavailable', () => {
  assert.equal(ratio(200, 0), null);
  assert.equal(change(100, 0), null);
  assert.equal(summarize([]).revenue, null);
  assert.equal(summarize([{ spend: 100, clicks: 1, impressions: 20, conversions: 0, revenue: null }]).revenue, null);
});
test('monetary totals use cents and weighted CPA, not an average of ratios', () => {
  const m = summarize([{ spend: 10000, clicks: 20, impressions: 1000, conversions: 1, revenue: 15000 }, { spend: 30000, clicks: 80, impressions: 3000, conversions: 9, revenue: 135000 }]);
  assert.equal(m.spend, 40000);
  assert.equal(ratio(m.spend, m.conversions), 4000);
  assert.equal(ratio(m.clicks * 100, m.impressions), 2.5);
});
test('current and previous 14-day windows partition the sample', () => {
  const c = DEMO_CAMPAIGNS[0];
  assert.equal(metrics(c, 14).spend + metrics(c, 14, true).spend, summarize(c.daily).spend);
});
test('lead scenarios never invent revenue and clients remain isolated', () => {
  const lead = DEMO_CLIENTS.find(c => c.objective === 'leads');
  const rows = DEMO_CAMPAIGNS.filter(c => c.clientId === lead.id);
  assert.equal(rows.length, 4);
  assert.equal(summarize(rows.map(c => metrics(c, 7))).revenue, null);
});
test('alerts require enough evidence and active status', () => {
  const c = DEMO_CAMPAIGNS[0];
  const low = { ...c, daily: c.daily.map(d => ({ ...d, conversions: 0 })) };
  assert.equal(alerts([low], DEMO_CLIENTS[0], 7).length, 0);
  assert.equal(alerts([{ ...c, status: 'paused' }], { ...DEMO_CLIENTS[0], targetCpa: 1 }, 7).length, 0);
  assert.equal(alerts([c], { ...DEMO_CLIENTS[0], targetCpa: 1 }, 7).length, 1);
});
test('default demo provides a reviewable alert without changing evidence thresholds', () => {
  const rows = DEMO_CAMPAIGNS.filter(c => c.clientId === DEMO_CLIENTS[0].id);
  assert.ok(alerts(rows, DEMO_CLIENTS[0], 7).length > 0);
});
