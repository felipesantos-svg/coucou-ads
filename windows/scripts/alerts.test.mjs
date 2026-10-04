import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest, evaluateRule } from '../src/traffic/alert-model.ts';
const now = 200000;
const entry = { id:'act_1/c_1',status:'Ativa',objective:'Vendas',spend:100,clicks:9,impressions:1000,fetchedAt:now,roas:4,messageCost:12 };
const ctr = { metric:'ctr',threshold:1,minImpressions:1000,accountId:'' };
test('accepts explicit thresholds, including comma decimals, and refuses ambiguous requests', () => {
  assert.deepEqual(parseRequest('ROAS abaixo de 5'), {metric:'roas',threshold:5});
  assert.deepEqual(parseRequest('CTR abaixo de 1%'), {metric:'ctr',threshold:1});
  assert.deepEqual(parseRequest('custo por mensagem acima de 12,50'), {metric:'message',threshold:12.5});
  for (const text of ['ROAS BAIXO','campanha precisa de atenção','CTR abaixo de 200%','ROAS abaixo de 5%','custo por mensagem acima de X']) assert.equal(parseRequest(text),null);
});
test('CTR is weighted clicks over impressions and threshold is strict', () => {
  assert.equal(evaluateRule(entry,ctr,now).state,'alert');
  assert.equal(evaluateRule({...entry,clicks:10},ctr,now).state,'ok');
});
test('paused campaigns, other accounts, stale and small samples cannot trigger alerts', () => {
  assert.equal(evaluateRule({...entry,status:'Pausada'},ctr,now).state,'outside');
  assert.equal(evaluateRule(entry,{...ctr,accountId:'act_2'},now).state,'outside');
  assert.equal(evaluateRule(entry,ctr,now+86401).state,'stale');
  assert.equal(evaluateRule({...entry,impressions:999},ctr,now).state,'insufficient');
});
test('missing ROAS is unknown, not zero, and lead campaigns do not use sales ROAS', () => {
  const rule={...ctr,metric:'roas',threshold:5};
  assert.equal(evaluateRule(entry,rule,now).state,'alert');
  assert.equal(evaluateRule({...entry,roas:null},rule,now).state,'unavailable');
  assert.equal(evaluateRule({...entry,objective:'Leads'},rule,now).state,'unavailable');
});
test('message cost uses upper threshold and missing conversations remain unknown', () => {
  const rule={...ctr,metric:'message',threshold:10,accountId:'act_1'};
  assert.equal(evaluateRule(entry,rule,now).state,'alert');
  assert.equal(evaluateRule({...entry,messageCost:10},rule,now).state,'ok');
  assert.equal(evaluateRule({...entry,messageCost:null},rule,now).state,'unavailable');
});
