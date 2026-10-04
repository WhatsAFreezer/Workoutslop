'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../src/core/workout-engine');
const { EXERCISES } = require('../src/core/exercises');

const MINUTE = 60 * 1000;
const byId = (id) => EXERCISES.find((e) => e.id === id);

test('tidsfaktor: kort tid siden giver færre, lang tid giver flere gentagelser', () => {
  assert.equal(engine.timeFactor(null), 1);
  assert.equal(engine.timeFactor(0), 0.5);
  assert.equal(engine.timeFactor(10), 0.8);
  assert.equal(engine.timeFactor(20), 1);
  assert.equal(engine.timeFactor(90), 1.4);
  assert.equal(engine.timeFactor(200), 1.4);
  assert.ok(engine.timeFactor(30) > 1 && engine.timeFactor(30) < 1.2);
  // Efter mange timer starter man forfra med normal mængde.
  assert.equal(engine.timeFactor(engine.FRESH_START_MINUTES + 1), 1);
});

test('udstyr: alle krav skal være opfyldt, lister betyder "én af dem"', () => {
  assert.ok(engine.hasEquipment(byId('pushup'), []));
  assert.ok(!engine.hasEquipment(byId('pullup'), []));
  assert.ok(engine.hasEquipment(byId('pullup'), ['pullupBar']));
  assert.ok(engine.hasEquipment(byId('gobletSquat'), ['kettlebell']));
  assert.ok(engine.hasEquipment(byId('gobletSquat'), ['dumbbells']));
  assert.ok(!engine.hasEquipment(byId('benchPress'), ['dumbbells']));
  assert.ok(engine.hasEquipment(byId('benchPress'), ['dumbbells', 'bench']));
});

test('tilgængelige øvelser afhænger af niveau og udstyr', () => {
  const beginner = engine.availableExercises(EXERCISES, { level: 1, equipment: [] }).map((e) => e.id);
  assert.ok(beginner.includes('kneePushup'));
  assert.ok(!beginner.includes('burpee'));
  assert.ok(!beginner.includes('bicepCurl'));

  const strong = engine.availableExercises(EXERCISES, { level: 4, equipment: ['pullupBar'] }).map((e) => e.id);
  assert.ok(strong.includes('pullup'));
  assert.ok(!strong.includes('kneePushup'));
  assert.ok(!strong.includes('negativePullup'));

  // Der skal altid være noget at lave, uanset niveau, når man intet udstyr har.
  for (const level of [1, 2, 3, 4]) {
    assert.ok(engine.availableExercises(EXERCISES, { level, equipment: [] }).length >= 8, `niveau ${level}`);
  }
});

test('mængden rundes pænt', () => {
  const plank = byId('plank');
  const { amount } = engine.computeAmount(plank, 1, 3); // 20 * ~0.57
  assert.equal(amount % 5, 0);
  assert.ok(amount >= 10);

  const pullup = byId('pullup');
  assert.equal(engine.computeAmount(pullup, 2, 0).amount, 2); // 3 * 0.5 = 1.5 -> 2
  assert.equal(engine.computeAmount(byId('pushup'), 3, null).amount, 18);
  assert.equal(engine.computeAmount(byId('burpee'), 1, null), null);
});

test('vælger ikke den samme øvelse to gange i træk, når der er alternativer', () => {
  const now = Date.now();
  const history = [
    { at: now - 2 * MINUTE, exerciseId: 'pushup', muscleGroup: 'push', amount: 10, unit: 'reps', status: 'done' },
  ];
  const settings = { level: 2, equipment: [] };
  const picks = new Set();
  for (let i = 0; i < 200; i++) {
    const ex = engine.chooseExercise({ exercises: EXERCISES, settings, history, now, random: () => i / 200 });
    picks.add(ex.id);
  }
  assert.ok(!picks.has('pushup') || picks.size > 5);
  // Muskelgruppen fra sidst er nedprioriteret, men samme øvelse er næsten udelukket.
  let same = 0;
  for (let i = 0; i < 1000; i++) {
    const ex = engine.chooseExercise({ exercises: EXERCISES, settings, history, now, random: Math.random });
    if (ex.id === 'pushup') same++;
  }
  assert.ok(same < 20, `pushup valgt ${same} gange`);
});

test('exclude bruges til "Anden øvelse"', () => {
  const settings = { level: 2, equipment: [] };
  const all = engine.availableExercises(EXERCISES, settings).map((e) => e.id);
  const exclude = all.slice(1);
  const ex = engine.chooseExercise({ exercises: EXERCISES, settings, history: [], now: 0, exclude });
  assert.equal(ex.id, all[0]);
  assert.equal(engine.chooseExercise({ exercises: EXERCISES, settings, history: [], now: 0, exclude: all }), null);
});

test('forslag bruger tiden siden sidste gennemførte øvelse', () => {
  const now = 10 * 60 * MINUTE;
  const history = [
    { at: now - 45 * MINUTE, exerciseId: 'squat', muscleGroup: 'legs', amount: 15, unit: 'reps', status: 'done' },
    { at: now - 5 * MINUTE, exerciseId: 'plank', muscleGroup: 'core', amount: 30, unit: 'seconds', status: 'skipped' },
  ];
  const s = engine.createSuggestion({
    exercises: EXERCISES,
    settings: { level: 2, equipment: [] },
    history,
    now,
    random: () => 0.5,
  });
  assert.equal(Math.round(s.minutesSinceLast), 45);
  assert.equal(s.factor, engine.timeFactor(45));
});

test('tekster til mængde og tid', () => {
  assert.equal(engine.describeAmount(byId('pushup'), 1), '1 gentagelse');
  assert.equal(engine.describeAmount(byId('pushup'), 12), '12 gentagelser');
  assert.equal(engine.describeAmount(byId('plank'), 30), '30 sekunder');
  assert.equal(engine.describeAmount(byId('lunge'), 8), '8 pr. ben');
  assert.equal(engine.describeTimeSince(25.4), '25 min. siden sidste øvelse');
  assert.equal(engine.describeTimeSince(125), '2 t. 5 min. siden sidste øvelse');
  assert.match(engine.describeTimeSince(null), /første/);
});

test('alle øvelser har gyldige data', () => {
  const ids = new Set();
  for (const ex of EXERCISES) {
    assert.ok(!ids.has(ex.id), `dublet: ${ex.id}`);
    ids.add(ex.id);
    assert.equal(ex.amounts.length, 4, ex.id);
    assert.ok(
      ex.amounts.some((a) => a != null),
      ex.id,
    );
    assert.ok(['reps', 'seconds', 'perSide'].includes(ex.unit), ex.id);
    assert.ok(ex.steps.length >= 2, ex.id);
    assert.ok(ex.animation, ex.id);
  }
});

test('fokus: kun øvelser fra de valgte områder', () => {
  const settings = { level: 3, equipment: ['dumbbells', 'bench', 'barbell'], focus: ['arms'] };
  const ids = engine.availableExercises(EXERCISES, settings).map((e) => e.id);
  assert.ok(ids.includes('bicepCurl'));
  assert.ok(ids.includes('preacherCurl'));
  assert.ok(ids.includes('pullup') === false); // kræver pull-up bar
  assert.ok(!ids.includes('squat'));
  assert.ok(!ids.includes('pushup'));

  // Kombination: bryst & skuldre + arme.
  const combo = engine
    .availableExercises(EXERCISES, { ...settings, focus: ['chestShoulders', 'arms'] })
    .map((e) => e.id);
  assert.ok(combo.includes('pushup') && combo.includes('bicepCurl') && combo.includes('overheadPress'));
  assert.ok(!combo.includes('squat') && !combo.includes('neckCurl'));

  // Intet fokus = hele kroppen.
  assert.ok(engine.availableExercises(EXERCISES, { ...settings, focus: [] }).length > combo.length);
});

test('fokus: øvelser kan høre til flere områder', () => {
  assert.deepEqual(engine.focusAreasOf(byId('pullup')).sort(), ['arms', 'backPosture']);
  assert.deepEqual(engine.focusAreasOf(byId('neckCurl')), ['backPosture']);
  assert.deepEqual(engine.focusAreasOf(byId('romanianDeadlift')).sort(), ['backPosture', 'legsAbs']);
  for (const ex of EXERCISES) assert.ok(engine.focusAreasOf(ex).length > 0, `${ex.id} har intet fokusområde`);
});

test('fokus: hvert område har øvelser uden udstyr på alle niveauer', () => {
  const { FOCUS_AREAS } = require('../src/core/catalog');
  for (const area of FOCUS_AREAS) {
    for (const level of [1, 2, 3, 4]) {
      const n = engine.availableExercises(EXERCISES, { level, equipment: [], focus: [area.id] }).length;
      assert.ok(n > 0, `${area.name}, niveau ${level}`);
    }
  }
});

test('fokus: passer intet, foreslås noget fra hele kroppen i stedet', () => {
  const settings = { level: 1, equipment: [], focus: ['arms'] };
  const exclude = engine.availableExercises(EXERCISES, settings).map((e) => e.id);
  const ex = engine.chooseExercise({ exercises: EXERCISES, settings, history: [], now: 0, exclude });
  assert.ok(ex);
  assert.ok(!exclude.includes(ex.id));
});

test('nakke, holdning, preacher curls og vægtstang', () => {
  const benchAndWeights = { level: 2, equipment: ['bench', 'dumbbells'], focus: ['backPosture'] };
  const ids = engine.availableExercises(EXERCISES, benchAndWeights).map((e) => e.id);
  for (const id of ['neckCurl', 'neckExtension', 'proneYRaise', 'chestSupportedRow', 'chinTuck', 'wallAngel']) {
    assert.ok(ids.includes(id), id);
  }
  assert.ok(!engine.hasEquipment(byId('neckCurl'), ['bench']));
  assert.ok(engine.hasEquipment(byId('neckCurl'), ['bench', 'barbell']));
  assert.ok(engine.hasEquipment(byId('preacherCurl'), ['bench', 'barbell']));
  assert.ok(!engine.hasEquipment(byId('preacherCurl'), ['dumbbells']));
  const barbellOnly = engine.availableExercises(EXERCISES, { level: 3, equipment: ['barbell'] }).map((e) => e.id);
  for (const id of ['barbellCurl', 'barbellRow', 'overheadPress', 'romanianDeadlift']) {
    assert.ok(barbellOnly.includes(id), id);
  }
});

test('arme inkluderer underarme', () => {
  const ids = engine
    .availableExercises(EXERCISES, { level: 2, equipment: ['dumbbells', 'barbell'], focus: ['arms'] })
    .map((e) => e.id);
  for (const id of ['wristCurl', 'reverseWristCurl', 'hammerCurl', 'reverseCurl', 'farmersHold', 'wristStretch']) {
    assert.ok(ids.includes(id), id);
  }
  assert.ok(engine.focusAreasOf(byId('deadHang')).includes('arms'));
  // Uden udstyr: håndledsstræk er altid muligt.
  const bodyweight = engine
    .availableExercises(EXERCISES, { level: 1, equipment: [], focus: ['arms'] })
    .map((e) => e.id);
  assert.ok(bodyweight.includes('wristStretch'));
});
