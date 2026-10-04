import test from 'node:test';
import assert from 'node:assert/strict';
import { IslandStateMachine } from '../src/island/fsm.ts';
test('idle collapses to compact and does not schedule disappearance; click reopens', () => {
  const timers = new Map(); let next = 0;
  globalThis.window = { setTimeout(fn) { timers.set(++next, fn); return next; }, clearTimeout(id) { timers.delete(id); } };
  const fsm = new IslandStateMachine();
  fsm.forceHome(); fsm.mouseLeft();
  assert.equal(timers.size, 1);
  for (const [id, fn] of [...timers]) { timers.delete(id); fn(); }
  assert.equal(fsm.state, 'petit');
  fsm.mouseLeft();
  assert.equal(timers.size, 0);
  assert.equal(fsm.state, 'petit');
  fsm.click(); assert.equal(fsm.state, 'home');
  fsm.forceHidden(); assert.equal(fsm.state, 'hidden');
  fsm.reveal(); assert.equal(fsm.state, 'petit'); assert.equal(timers.size, 0);
});
