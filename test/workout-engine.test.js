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
  assert.deepEqual(engine.focusAreasOf(byId('romanianDeadlift')), ['legsAbs']);
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

const MIN = 60 * 1000;
const doneEntry = (at, exerciseId) => {
  const ex = byId(exerciseId);
  return { at, exerciseId, muscleGroup: ex.muscleGroup, amount: 10, unit: ex.unit, status: 'done' };
};

test('sæt pr. dag: dagens plan tæller gennemførte sæt pr. muskelgruppe', () => {
  const now = new Date(2026, 9, 4, 20, 0).getTime();
  const settings = { level: 2, equipment: [], focus: ['legsAbs'], setsPerDay: { legs: 2, core: 1, cardio: 0 } };
  const yesterday = now - 24 * 60 * MIN;
  const history = [
    doneEntry(yesterday, 'squat'),
    doneEntry(now - 30 * MIN, 'squat'),
    doneEntry(now - 5 * MIN, 'plank'),
  ];
  const plan = engine.dailyPlan(EXERCISES, settings, history, now);
  assert.deepEqual(plan.perGroup.legs, { done: 1, target: 2, remaining: 1 });
  assert.deepEqual(plan.perGroup.core, { done: 1, target: 1, remaining: 0 });
  assert.equal(plan.perGroup.cardio, undefined); // 0 sæt = trænes ikke
  assert.equal(plan.target, 3);
  assert.equal(plan.done, 2);
  assert.equal(plan.complete, false);

  // Kun ben mangler – så får man en benøvelse, og aldrig samme øvelse to gange hvis det kan undgås.
  for (let i = 0; i < 50; i++) {
    const ex = engine.chooseExercise({ exercises: EXERCISES, settings, history, now, random: () => i / 50 });
    assert.equal(ex.muscleGroup, 'legs');
  }
});

test('sæt pr. dag: når målet er nået, er der fri – medmindre man selv beder om en øvelse', () => {
  const now = new Date(2026, 9, 4, 20, 0).getTime();
  const settings = { level: 2, equipment: [], focus: ['legsAbs'], setsPerDay: { legs: 1, core: 1, cardio: 0 } };
  const history = [doneEntry(now - 30 * MIN, 'squat'), doneEntry(now - 5 * MIN, 'plank')];
  assert.equal(engine.dailyPlan(EXERCISES, settings, history, now).complete, true);
  assert.equal(engine.createSuggestion({ exercises: EXERCISES, settings, history, now }), null);
  assert.ok(engine.createSuggestion({ exercises: EXERCISES, settings, history, now, ignoreTargets: true }));
});

test('fravalgte øvelser og muskelgrupper med 0 sæt bruges ikke', () => {
  const settings = {
    level: 2,
    equipment: ['dumbbells'],
    focus: ['arms'],
    disabledExercises: ['bicepCurl', 'diamondPushup'],
    setsPerDay: { biceps: 2, triceps: 0, forearms: 2 },
  };
  const ids = engine.availableExercises(EXERCISES, settings).map((e) => e.id);
  assert.ok(!ids.includes('bicepCurl'));
  assert.ok(!ids.includes('diamondPushup'));
  assert.ok(!ids.some((id) => byId(id).muscleGroup === 'triceps'));
  assert.ok(ids.includes('hammerCurl'));
});

test('alle øvelser har en sværhedsgrad og en animation', () => {
  const ANIMATIONS = require('../src/renderer/shared/animations');
  for (const ex of EXERCISES) {
    assert.ok([1, 2, 3].includes(ex.difficulty), `${ex.id}: sværhedsgrad`);
    assert.ok(ANIMATIONS[ex.animation], `${ex.id}: animation`);
    assert.ok(ex.steps.length >= 2 && ex.tip, `${ex.id}: forklaring`);
  }
  assert.equal(new Set(EXERCISES.map((e) => e.id)).size, EXERCISES.length, 'ingen dubletter');
});

test('skuldre, ryg og triceps kan trænes uden vægte', () => {
  const groups = (equipment, level = 2) =>
    new Set(engine.availableExercises(EXERCISES, { level, equipment }).map((e) => e.muscleGroup));
  const bodyweight = groups([]);
  for (const g of ['chest', 'shoulders', 'back', 'posture', 'neck', 'triceps', 'legs', 'core', 'cardio']) {
    assert.ok(bodyweight.has(g), `uden udstyr: ${g}`);
  }
  const band = groups(['resistanceBand']);
  for (const g of ['back', 'posture', 'biceps', 'triceps']) assert.ok(band.has(g), `elastik: ${g}`);
});

test('sværhedsgrad: begyndere får mest lette øvelser, stærke mest svære', () => {
  const easy = { ...byId('kneePushup') };
  const hard = { ...byId('diamondPushup') };
  assert.ok(engine.difficultyWeight(1, 1) > engine.difficultyWeight(1, 3) * 5);
  assert.ok(engine.difficultyWeight(4, 3) > engine.difficultyWeight(4, 1));
  // Med to mulige øvelser vælges den lette langt oftest på niveau 1.
  const pick = (level) => {
    const settings = { level, equipment: [], focus: [] };
    const exercises = [
      { ...easy, amounts: [5, 5, 5, 5] },
      { ...hard, amounts: [5, 5, 5, 5] },
    ];
    let hardCount = 0;
    for (let i = 0; i < 200; i++) {
      const r = (i + 0.5) / 200;
      const ex = engine.chooseExercise({ exercises, settings, history: [], now: 0, random: () => r });
      if (ex.id === hard.id) hardCount++;
    }
    return hardCount;
  };
  assert.ok(pick(1) < 40, `niveau 1: ${pick(1)} svære ud af 200`);
  assert.ok(pick(4) > 100, `niveau 4: ${pick(4)} svære ud af 200`);
});

test('progression: hver 3. gennemførte gang bliver øvelsen 5 % sværere', () => {
  const done = (id, at, level = 2) => ({ at, exerciseId: id, muscleGroup: 'chest', status: 'done', level });
  assert.equal(engine.progressionFactor([], 'pushup', 2), 1);
  const six = [1, 2, 3, 4, 5, 6].map((t) => done('pushup', t));
  assert.ok(Math.abs(engine.progressionFactor(six, 'pushup', 2) - 1.05 * 1.05) < 1e-9);
  // Andre øvelser og andre niveauer tæller ikke.
  assert.equal(engine.progressionFactor(six, 'squat', 2), 1);
  assert.equal(engine.progressionFactor(six, 'pushup', 3), 1);
  // Højst +50 %.
  const many = Array.from({ length: 300 }, (_, i) => done('pushup', i));
  assert.equal(engine.progressionFactor(many, 'pushup', 2), 1.5);
  // "For hårdt" sætter den 20 % ned og starter tællingen forfra.
  const eased = [...six, { at: 7, exerciseId: 'pushup', status: 'easier', level: 2 }];
  assert.ok(Math.abs(engine.progressionFactor(eased, 'pushup', 2) - 1.05 * 1.05 * 0.8) < 1e-9);

  // Mængden i forslaget følger med.
  const settings = { level: 2, equipment: [], focus: ['chestShoulders'], disabledExercises: [] };
  const only = [byId('pushup')];
  const s1 = engine.createSuggestion({ exercises: only, settings, history: [], now: 0 });
  const s2 = engine.createSuggestion({ exercises: only, settings, history: many, now: 1e12 });
  assert.equal(s1.amount, 10);
  assert.equal(s2.amount, 15);
  assert.equal(s2.progress, 1.5);
  assert.equal(s2.level, 2);
});

test('"For hårdt" sætter mængden ned, men aldrig under minimum', () => {
  const reps = { exercise: byId('pushup'), amount: 10 };
  assert.equal(engine.easierSuggestion(reps).amount, 7);
  assert.equal(engine.easierSuggestion(reps).eased, true);
  assert.equal(engine.easierSuggestion({ exercise: byId('pushup'), amount: 2 }).amount, 1);
  assert.equal(engine.easierSuggestion({ exercise: byId('pushup'), amount: 1 }), null);
  const seconds = { exercise: byId('plank'), amount: 30 };
  assert.equal(engine.easierSuggestion(seconds).amount, 20);
  assert.equal(engine.easierSuggestion({ exercise: byId('plank'), amount: 10 }), null);
});

test('fokus: øvelser vises og tælles under en muskelgruppe i det valgte fokus', () => {
  const { FOCUS_AREAS } = require('../src/core/catalog');
  const all = ['dumbbells', 'kettlebell', 'bench', 'pullupBar', 'resistanceBand', 'barbell'];
  // Med ét fokus ad gangen havner alle øvelser i en gruppe, der hører til fokus.
  for (const area of FOCUS_AREAS) {
    for (const level of [1, 2, 3, 4]) {
      const settings = { level, equipment: all, focus: [area.id] };
      for (const ex of engine.availableExercises(EXERCISES, settings)) {
        const group = engine.groupFor(ex, settings.focus);
        assert.ok(area.groups.includes(group), `${area.name}: ${ex.name} vises under ${group}`);
      }
    }
  }
  assert.equal(engine.groupFor(byId('pullup'), ['arms']), 'biceps');
  assert.equal(engine.groupFor(byId('deadHang'), ['arms']), 'forearms');
  assert.equal(engine.groupFor(byId('diamondPushup'), ['chestShoulders']), 'chest');
  assert.equal(engine.groupFor(byId('birdDog'), ['backPosture']), 'back');
  // Er øvelsens egen gruppe med i fokus – eller er der intet fokus – bruges den.
  assert.equal(engine.groupFor(byId('pullup'), ['arms', 'backPosture']), 'back');
  assert.equal(engine.groupFor(byId('diamondPushup'), ['chestShoulders', 'arms']), 'triceps');
  assert.equal(engine.groupFor(byId('pullup'), []), 'back');

  // Sættet gemmes under den gruppe, det tæller under, og dagens plan bruger det.
  const settings = { level: 3, equipment: ['pullupBar'], focus: ['arms'], setsPerDay: { biceps: 2, forearms: 1 } };
  const plan = engine.dailyPlan(EXERCISES, settings, [], 0);
  assert.deepEqual(Object.keys(plan.perGroup).sort(), ['biceps', 'forearms']);
  const s = engine.createSuggestion({ exercises: [byId('pullup')], settings, history: [], now: 0 });
  assert.equal(s.group, 'biceps');
});
