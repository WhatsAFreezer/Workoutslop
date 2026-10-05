'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Coach, ACTIVE_BEFORE_COMPACT_MS, COMPACT_TIMEOUT_MS, DISMISS_COOLDOWN_MS } = require('../src/core/coach');

const MINUTE = 60 * 1000;
const settings = { minMinutesBetween: 10 };
const game = { id: 'cs2', name: 'Counter-Strike 2' };
const pause = (source = 'integration') => ({ state: 'pause', source, reason: 'Kampen er slut', game });
const playing = (source = 'integration') => ({ state: 'playing', source, reason: 'I kamp', game });

function makeCoach() {
  let n = 0;
  const calls = [];
  const coach = new Coach({
    suggest: (now, exclude, override, options) => {
      calls.push({ exclude, override, options });
      n++;
      return { exercise: { id: `ex${n}`, muscleGroup: 'push' }, amount: 10, minutesSinceLast: null };
    },
  });
  return { coach, calls };
}

const types = (commands) => commands.map((c) => c.type);

test('foreslår en øvelse, når pausen starter', () => {
  const { coach } = makeCoach();
  assert.deepEqual(coach.tick({ now: 0, pause: playing(), idleSeconds: 0, settings }), []);
  const cmds = coach.tick({ now: 1000, pause: pause(), idleSeconds: 0, settings });
  assert.deepEqual(types(cmds), ['show']);
  assert.equal(cmds[0].fresh, true);
  assert.equal(cmds[0].current.gameName, 'Counter-Strike 2');
  // Ikke en ny øvelse ved hvert tick.
  assert.deepEqual(coach.tick({ now: 2000, pause: pause(), idleSeconds: 0, settings }), []);
});

test('respekterer mindste tid mellem øvelser', () => {
  const { coach } = makeCoach();
  coach.tick({ now: 0, pause: pause(), idleSeconds: 0, settings });
  const done = coach.complete(30 * 1000);
  assert.deepEqual(types(done), ['record', 'hide']);
  assert.equal(done[0].entry.status, 'done');
  assert.equal(done[0].entry.exerciseId, 'ex1');

  assert.deepEqual(coach.tick({ now: 5 * MINUTE, pause: pause(), idleSeconds: 0, settings }), []);
  assert.deepEqual(types(coach.tick({ now: 11 * MINUTE, pause: pause(), idleSeconds: 0, settings })), ['show']);
});

test('bliver lille, når kampen starter, og forsvinder senere', () => {
  const { coach } = makeCoach();
  coach.tick({ now: 0, pause: pause(), idleSeconds: 0, settings });
  assert.deepEqual(types(coach.tick({ now: 1000, pause: playing(), idleSeconds: 0, settings })), ['compact']);
  assert.deepEqual(coach.tick({ now: 2000, pause: playing(), idleSeconds: 0, settings }), []);
  const cmds = coach.tick({ now: 1000 + COMPACT_TIMEOUT_MS, pause: playing(), idleSeconds: 0, settings });
  assert.deepEqual(types(cmds), ['record', 'hide']);
  assert.equal(cmds[0].entry.status, 'missed');
  assert.equal(coach.current, null);
});

test('en ny pause folder den lille udgave ud igen', () => {
  const { coach } = makeCoach();
  coach.tick({ now: 0, pause: pause(), idleSeconds: 0, settings });
  coach.tick({ now: 1000, pause: playing(), idleSeconds: 0, settings });
  assert.deepEqual(types(coach.tick({ now: 5000, pause: pause(), idleSeconds: 0, settings })), ['expand']);
});

test('ved inaktivitets-pauser gøres overlayet først lille efter et stykke tids aktivitet', () => {
  const { coach } = makeCoach();
  coach.tick({ now: 0, pause: pause('idle'), idleSeconds: 30, settings });
  // Brugeren bevæger musen for at klikke "Færdig" – det skal ikke skjule noget.
  assert.deepEqual(coach.tick({ now: 1000, pause: playing('idle'), idleSeconds: 0, settings }), []);
  assert.deepEqual(
    coach.tick({ now: 1000 + ACTIVE_BEFORE_COMPACT_MS - 1, pause: playing('idle'), idleSeconds: 0, settings }),
    [],
  );
  assert.deepEqual(
    types(coach.tick({ now: 1000 + ACTIVE_BEFORE_COMPACT_MS, pause: playing('idle'), idleSeconds: 0, settings })),
    ['compact'],
  );
});

test('lukker man spillet, forsvinder øvelsen fra pausen', () => {
  const noGame = { state: 'noGame', source: 'none', reason: 'Intet spil kører', game: null };
  for (const source of ['idle', 'focus', 'integration']) {
    const { coach } = makeCoach();
    coach.tick({ now: 0, pause: pause(source), idleSeconds: 99, settings });
    assert.ok(coach.current);
    const cmds = coach.tick({ now: 5000, pause: noGame, idleSeconds: 0, settings });
    assert.deepEqual(types(cmds), ['record', 'hide'], source);
    assert.equal(cmds[0].entry.status, 'missed');
    assert.equal(coach.current, null);
    // Og der kommer ingen nye øvelser, mens intet spil kører.
    assert.deepEqual(coach.tick({ now: 99 * MINUTE, pause: noGame, idleSeconds: 999, settings }), []);
  }

  // Også den lille udgave forsvinder med det samme.
  const { coach } = makeCoach();
  coach.tick({ now: 0, pause: pause(), idleSeconds: 0, settings });
  coach.tick({ now: 1000, pause: playing(), idleSeconds: 0, settings });
  assert.equal(coach.current.mode, 'compact');
  assert.deepEqual(types(coach.tick({ now: 2000, pause: noGame, idleSeconds: 0, settings })), ['record', 'hide']);
});

test('øvelser man selv beder om bliver stående', () => {
  const { coach, calls } = makeCoach();
  assert.deepEqual(types(coach.requestNow(0)), ['show']);
  assert.deepEqual(calls[0].options, { ignoreTargets: true });
  assert.equal(coach.current.trigger, 'manual');
  assert.deepEqual(coach.tick({ now: 1000, pause: playing(), idleSeconds: 0, settings }), []);
  assert.deepEqual(coach.tick({ now: 10 * MINUTE, pause: playing('idle'), idleSeconds: 0, settings }), []);
});

test('"spring over" giver en pause, før næste forslag', () => {
  const { coach } = makeCoach();
  coach.tick({ now: 0, pause: pause(), idleSeconds: 0, settings });
  const cmds = coach.skip(1000);
  assert.equal(cmds[0].entry.status, 'skipped');
  assert.deepEqual(coach.tick({ now: 2000, pause: pause(), idleSeconds: 0, settings }), []);
  assert.deepEqual(types(coach.tick({ now: 1000 + DISMISS_COOLDOWN_MS, pause: pause(), idleSeconds: 0, settings })), [
    'show',
  ]);
});

test('udsæt og pause fra bakkemenuen', () => {
  const { coach } = makeCoach();
  coach.tick({ now: 0, pause: pause(), idleSeconds: 0, settings });
  assert.deepEqual(types(coach.snooze(0, 10)), ['hide']);
  assert.deepEqual(coach.tick({ now: 9 * MINUTE, pause: pause(), idleSeconds: 0, settings }), []);
  assert.deepEqual(types(coach.tick({ now: 10 * MINUTE, pause: pause(), idleSeconds: 0, settings })), ['show']);

  coach.pauseUntil(60 * MINUTE);
  assert.equal(coach.current, null);
  assert.deepEqual(coach.tick({ now: 30 * MINUTE, pause: pause(), idleSeconds: 0, settings }), []);
  coach.resume();
  assert.deepEqual(types(coach.tick({ now: 31 * MINUTE, pause: pause(), idleSeconds: 0, settings })), ['show']);
});

test('"anden øvelse" udelukker den nuværende', () => {
  const { coach, calls } = makeCoach();
  coach.tick({ now: 0, pause: pause(), idleSeconds: 0, settings });
  const cmds = coach.reroll(1000);
  assert.deepEqual(types(cmds), ['show']);
  assert.equal(cmds[0].fresh, false);
  assert.deepEqual(calls[1].exclude, ['ex1']);
  assert.equal(coach.current.suggestion.exercise.id, 'ex2');
});

test('eksempler fra opsætningen gemmes ikke i historikken', () => {
  const { coach } = makeCoach();
  const override = { level: 4 };
  coach.present(0, { exercise: { id: 'x', muscleGroup: 'legs' }, amount: 5 }, 'preview', null, override);
  coach.reroll(100);
  assert.equal(coach.reroll(100).length, 1);
  assert.deepEqual(types(coach.complete(200)), ['hide']);
  assert.equal(coach.lastCompletedAt, -Infinity);
});
