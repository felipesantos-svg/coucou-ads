import test from 'node:test';
import assert from 'node:assert/strict';
import { weekRange, eventsOnDay, upcomingEvents } from '../src/views/calendar-model.ts';
const date = (y,m,d,h=0) => new Date(y,m-1,d,h);
test('week is Monday to exclusive next Monday, including month boundaries', () => {
  for (const day of [date(2026,10,2), date(2026,10,4)]) {
    const {start,end} = weekRange(day);
    assert.equal(start.toDateString(),date(2026,9,28).toDateString());
    assert.equal(end.toDateString(),date(2026,10,5).toDateString());
  }
});
test('all-day end is exclusive and multi-day events appear on each occupied day', () => {
  const events=[{id:'multi',start:{date:'2026-10-01'},end:{date:'2026-10-03'}}];
  assert.equal(eventsOnDay(events,date(2026,10,2)).length,1);
  assert.equal(eventsOnDay(events,date(2026,10,3)).length,0);
});
test('overnight events overlap today; cancelled and tomorrow events do not', () => {
  const event = (id,start,end,status) => ({id,start:{dateTime:start.toISOString()},end:{dateTime:end.toISOString()},status});
  const events=[event('night',date(2026,10,1,23),date(2026,10,2,1)),event('cancelled',date(2026,10,2,9),date(2026,10,2,10),'cancelled'),event('tomorrow',date(2026,10,3,9),date(2026,10,3,10))];
  assert.deepEqual(eventsOnDay(events,date(2026,10,2)).map(e=>e.id),['night']);
});

test('next week starts at current exclusive end and handles year rollover', () => {
  const day = date(2026,12,31);
  const current = weekRange(day);
  const next = weekRange(day,1);
  assert.equal(+next.start,+current.end);
  assert.equal(next.start.toDateString(),date(2027,1,4).toDateString());
  assert.equal(next.end.toDateString(),date(2027,1,11).toDateString());
});

test('past days disappear but all events today stay until the following day', () => {
 const events = [
  {id:'past',start:{date:'2026-10-02'},end:{date:'2026-10-03'}},
  {id:'today',start:{dateTime:date(2026,10,3,8).toISOString()},end:{dateTime:date(2026,10,3,9).toISOString()}},
  {id:'multi',start:{date:'2026-10-02'},end:{date:'2026-10-04'}},
  {id:'future',start:{date:'2026-10-05'},end:{date:'2026-10-06'}}
 ];
 assert.deepEqual(upcomingEvents(events,date(2026,10,3,23)).map(e=>e.id),['today','multi','future']);
 assert.deepEqual(upcomingEvents(events,date(2026,10,4)).map(e=>e.id),['future']);
});
