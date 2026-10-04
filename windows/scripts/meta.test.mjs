import test from 'node:test';
import assert from 'node:assert/strict';
import { numeric, resultCount, totals, activeAccounts, groupedTotals, objectiveLabel } from '../src/traffic/meta-model.ts';
const row = { spend: '12.34', impressions: '100', clicks: '4', actions: [{ action_type: 'purchase', value: '2' }, { action_type: 'omni_purchase', value: '2' }] };
test('overlapping actions are never added together', () => {
  assert.equal(resultCount(row, ''), null);
  assert.equal(resultCount(row, 'purchase'), 2);
  assert.equal(resultCount(row, 'lead'), 0);
  assert.throws(() => resultCount({ ...row, actions: [...row.actions, row.actions[0]] }, 'purchase'));
});
test('missing and malformed metrics cannot silently become zero', () => {
  for (const v of ['', 'NaN', 'Infinity', '-1', '12,34', '1e300']) assert.throws(() => numeric(v));
  assert.equal(numeric('0'), 0);
});
test('Meta monetary units are retained, without cents conversion', () => {
  assert.deepEqual(totals([row, row]), { spend: 24.68, impressions: 200, clicks: 8 });
});
test('active selection excludes disabled and unknown statuses', () => {
  assert.deepEqual(activeAccounts([{id:'a',account_status:1},{id:'b',account_status:2},{id:'c'},{id:'d',account_status:null}]).map(a=>a.id), ['a']);
});
test('multi-account totals keep currencies separate and include empty accounts', () => {
  const reports = ['BRL','USD','BRL'].map(currency=>({account:{currency},rows:[row]}));
  reports.push({account:{currency:'EUR'},rows:[]});
  assert.deepEqual(groupedTotals(reports), [
    {currency:'BRL',spend:24.68,clicks:8,impressions:200},
    {currency:'USD',spend:12.34,clicks:4,impressions:100},
    {currency:'EUR',spend:0,clicks:0,impressions:0}
  ]);
});

test('campaign objective identification uses explicit metadata and preserves unknown objectives', () => {
  assert.equal(objectiveLabel('OUTCOME_SALES'), 'Vendas');
  assert.equal(objectiveLabel('OUTCOME_LEADS'), 'Leads');
  assert.equal(objectiveLabel('OUTCOME_TRAFFIC'), 'Tráfego');
  assert.equal(objectiveLabel(null), 'Objetivo não informado');
  assert.equal(objectiveLabel('NEW_OBJECTIVE'), 'NEW_OBJECTIVE');
});
