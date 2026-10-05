'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setsByDay, streakDays } = require('../src/core/stats');

const at = (day, hour = 12) => new Date(2026, 9, day, hour).getTime();
const done = (time) => ({ at: time, exerciseId: 'pushup', muscleGroup: 'chest', amount: 10, status: 'done' });

test('sæt pr. dag for de sidste 7 dage', () => {
  const now = at(5, 20); // mandag d. 5. oktober 2026
  const history = [done(at(5, 9)), done(at(5, 10)), done(at(3)), { ...done(at(4)), status: 'skipped' }, done(at(1))];
  const week = setsByDay(history, now);
  assert.equal(week.length, 7);
  assert.deepEqual(
    week.map((d) => d.sets),
    [0, 0, 1, 0, 1, 0, 2],
  );
  assert.equal(week[6].label, 'i dag');
  assert.equal(week[5].label, 'søn');
});

test('dage i træk', () => {
  const now = at(5, 20);
  assert.equal(streakDays([], now), 0);
  assert.equal(streakDays([done(at(5)), done(at(4)), done(at(3)), done(at(1))], now), 3);
  // Ikke trænet i dag endnu: rækken fra i går tæller stadig.
  assert.equal(streakDays([done(at(4)), done(at(3))], now), 2);
  // Kun "spring over" tæller ikke.
  assert.equal(streakDays([{ ...done(at(5)), status: 'skipped' }], now), 0);
});

test('hændelsesloggen tæller gentagelser op og holder en grænse', () => {
  const { EventLog, formatReport } = require('../src/core/event-log');
  const log = new EventLog(3);
  log.add('a', 1000);
  log.add('b', 2000);
  log.add('b', 3000);
  log.add('c', 4000);
  log.add('d', 5000);
  const list = log.list();
  assert.deepEqual(
    list.map((e) => [e.text, e.count]),
    [
      ['d', 1],
      ['c', 1],
      ['b', 2],
    ],
  );
  const report = formatReport({
    title: 'Rapport',
    sections: [{ title: 'App', rows: [['Version', '1.0']] }],
    log: list,
  });
  assert.match(report, /^Rapport\n\n## App\nVersion: 1\.0\n\n## Hændelser \(nyeste først\)\n/);
  assert.match(report, /b \(×2\)/);
});
