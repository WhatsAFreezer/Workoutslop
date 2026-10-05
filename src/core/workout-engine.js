'use strict';

// Vælger hvilken øvelse brugeren skal lave, og hvor meget.

const { FOCUS_AREAS } = require('./catalog');
const { startOfDay } = require('./stats');

const MINUTE = 60 * 1000;

// Hvordan tiden siden sidste øvelse påvirker mængden: [minutter, faktor].
// Kort tid siden = musklerne er stadig trætte = færre gentagelser.
// Lang tid siden = mere overskud = flere gentagelser.
const TIME_CURVE = [
  [0, 0.5],
  [10, 0.8],
  [20, 1.0],
  [45, 1.2],
  [90, 1.4],
];

// Efter så lang tid starter vi forfra med normal mængde, fordi man ikke er varmet op.
const FRESH_START_MINUTES = 6 * 60;

// Hvor gerne en øvelse vælges ud fra dens sværhedsgrad [let, middel, svær] på hvert
// styrkeniveau. En begynder får mest lette øvelser, en stærk mest de svære.
const DIFFICULTY_WEIGHT = {
  1: [1, 0.5, 0.15],
  2: [1, 1, 0.4],
  3: [0.7, 1, 1],
  4: [0.5, 1, 1.2],
};

// Progression: hver 3. gang en øvelse gennemføres, bliver den 5 % sværere (højst +50 %).
// "For hårdt" gør den 20 % lettere fremover (højst ned til det halve).
const PROGRESS_EVERY = 3;
const PROGRESS_STEP = 1.05;
const PROGRESS_MAX = 1.5;
const EASIER_STEP = 0.8;
const PROGRESS_MIN = 0.5;
// Trykker man "For hårdt" under en øvelse, sættes mængden straks så meget ned.
const EASIER_NOW = 0.7;

// Statusser i historikken: 'done', 'skipped', 'missed' – og 'easier' når brugeren har trykket "For hårdt".
const isAttempt = (entry) => entry.status === 'done' || entry.status === 'skipped' || entry.status === 'missed';

function timeFactor(minutesSinceLast) {
  if (minutesSinceLast == null || !Number.isFinite(minutesSinceLast)) return 1;
  if (minutesSinceLast >= FRESH_START_MINUTES) return 1;
  const m = Math.max(0, minutesSinceLast);
  for (let i = 1; i < TIME_CURVE.length; i++) {
    const [x1, y1] = TIME_CURVE[i];
    if (m <= x1) {
      const [x0, y0] = TIME_CURVE[i - 1];
      return y0 + ((m - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return TIME_CURVE[TIME_CURVE.length - 1][1];
}

function hasEquipment(exercise, owned) {
  const have = new Set(owned);
  return exercise.equipment.every((req) => (Array.isArray(req) ? req.some((r) => have.has(r)) : have.has(req)));
}

function baseAmount(exercise, level) {
  return exercise.amounts[level - 1] ?? null;
}

// De fokusområder en øvelse hører til, fx ['backPosture', 'arms'] for pull-ups.
function focusAreasOf(exercise) {
  const fromGroup = FOCUS_AREAS.filter((area) => area.groups.includes(exercise.muscleGroup)).map((area) => area.id);
  return [...new Set([...fromGroup, ...(exercise.extraFocus || [])])];
}

// Intet fokus valgt = hele kroppen.
function matchesFocus(exercise, focus) {
  return !focus || focus.length === 0 || focusAreasOf(exercise).some((area) => focus.includes(area));
}

// Antal sæt om dagen for en muskelgruppe – eller null, hvis der ikke er sat noget mål.
function setsFor(settings, group) {
  const sets = settings.setsPerDay;
  return sets && sets[group] != null ? sets[group] : null;
}

// Fravalgte øvelser og muskelgrupper sat til 0 sæt er slået fra.
function isEnabled(exercise, settings) {
  return !(settings.disabledExercises || []).includes(exercise.id) && setsFor(settings, exercise.muscleGroup) !== 0;
}

function availableExercises(exercises, settings) {
  const { level, equipment, focus } = settings;
  return exercises.filter(
    (ex) =>
      hasEquipment(ex, equipment) &&
      baseAmount(ex, level) != null &&
      matchesFocus(ex, focus) &&
      isEnabled(ex, settings),
  );
}

// Gennemførte sæt i dag pr. muskelgruppe.
function setsDoneToday(history, now) {
  const from = startOfDay(now);
  const done = {};
  for (const entry of history) {
    if (entry.status === 'done' && entry.at >= from && entry.at <= now) {
      done[entry.muscleGroup] = (done[entry.muscleGroup] || 0) + 1;
    }
  }
  return done;
}

// Dagens plan: hvor mange sæt hver muskelgruppe mangler. Kun muskelgrupper med
// mindst én mulig øvelse tæller med – ellers kunne målet aldrig nås.
function dailyPlan(exercises, settings, history, now) {
  const done = setsDoneToday(history, now);
  const groups = [...new Set(availableExercises(exercises, settings).map((ex) => ex.muscleGroup))];
  const perGroup = {};
  let target = 0;
  let doneTotal = 0;
  for (const group of groups) {
    const sets = setsFor(settings, group);
    if (sets == null) continue;
    const d = done[group] || 0;
    perGroup[group] = { done: d, target: sets, remaining: Math.max(0, sets - d) };
    target += sets;
    doneTotal += Math.min(d, sets);
  }
  const hasTargets = Object.keys(perGroup).length > 0;
  const complete = hasTargets && Object.values(perGroup).every((g) => g.remaining === 0);
  return { perGroup, target, done: doneTotal, hasTargets, complete };
}

function difficultyWeight(level, difficulty) {
  return DIFFICULTY_WEIGHT[level]?.[(difficulty || 2) - 1] ?? 1;
}

// Hvor meget en øvelse er justeret for brugeren på dette niveau: 1 = som udgangspunkt.
// Ældre historik uden niveau tæller med.
function progressionFactor(history, exerciseId, level) {
  let factor = 1;
  let streak = 0;
  for (const entry of history) {
    if (entry.exerciseId !== exerciseId || (entry.level != null && entry.level !== level)) continue;
    if (entry.status === 'done') {
      streak++;
      if (streak >= PROGRESS_EVERY) {
        factor = Math.min(PROGRESS_MAX, factor * PROGRESS_STEP);
        streak = 0;
      }
    } else if (entry.status === 'easier') {
      factor = Math.max(PROGRESS_MIN, factor * EASIER_STEP);
      streak = 0;
    }
  }
  return factor;
}

const MIN_SECONDS = 10;

// Sekunder rundes til nærmeste 5, så det er let at tælle.
function roundAmount(exercise, raw) {
  return exercise.unit === 'seconds' ? Math.max(MIN_SECONDS, Math.round(raw / 5) * 5) : Math.max(1, Math.round(raw));
}

function computeAmount(exercise, level, minutesSinceLast, progress = 1) {
  const base = baseAmount(exercise, level);
  if (base == null) return null;
  const factor = timeFactor(minutesSinceLast);
  return { amount: roundAmount(exercise, base * factor * progress), base, factor };
}

// "For hårdt": samme øvelse med færre gentagelser/sekunder – eller null, hvis den
// allerede er så lav, som den kan blive.
function easierSuggestion(suggestion) {
  const { exercise, amount } = suggestion;
  let next = roundAmount(exercise, amount * EASIER_NOW);
  if (next >= amount) next = roundAmount(exercise, amount - (exercise.unit === 'seconds' ? 5 : 1));
  if (next >= amount) return null;
  return { ...suggestion, amount: next, eased: true };
}

function lastCompletedAt(history) {
  let last = -Infinity;
  for (const entry of history) {
    if (entry.status === 'done' && entry.at > last) last = entry.at;
  }
  return last;
}

// Vægtet tilfældigt valg: øvelser man lige har lavet, eller som rammer samme
// muskelgruppe som sidst, bliver mindre sandsynlige. Så får man variation.
// ignoreTargets: brug ikke dagens mål (fx når brugeren selv beder om en øvelse).
function chooseExercise({
  exercises,
  settings,
  history,
  now,
  random = Math.random,
  exclude = [],
  ignoreTargets = false,
}) {
  let effective = settings;
  let pool = availableExercises(exercises, settings).filter((ex) => !exclude.includes(ex.id));
  // Passer intet til fokus + udstyr, er det bedre at foreslå noget andet end ingenting.
  if (pool.length === 0) {
    effective = { ...settings, focus: [] };
    pool = availableExercises(exercises, effective).filter((ex) => !exclude.includes(ex.id));
  }
  if (pool.length === 0) return null;

  // Dagens sæt: vælg kun blandt muskelgrupper, der mangler sæt. Er alle mål nået, er der fri.
  const plan = dailyPlan(exercises, effective, history, now);
  if (plan.hasTargets && !ignoreTargets) {
    pool = pool.filter((ex) => (plan.perGroup[ex.muscleGroup]?.remaining ?? 1) > 0);
    if (pool.length === 0) return null;
  }
  const from = startOfDay(now);
  const doneToday = history.filter((h) => h.status === 'done' && h.at >= from);

  const recent = history.filter((h) => now - h.at < 60 * MINUTE && isAttempt(h));
  const last = recent.length > 0 ? recent[recent.length - 1] : null;

  const weights = pool.map((ex) => {
    let w = difficultyWeight(effective.level, ex.difficulty);
    // Brugeren har valgt udstyret af en grund – brug det lidt oftere.
    if (ex.equipment.length > 0) w *= 1.6;
    const timesRecently = recent.filter((h) => h.exerciseId === ex.id).length;
    w *= Math.pow(0.35, timesRecently);
    if (last && last.exerciseId === ex.id) w *= 0.1;
    if (last && last.muscleGroup === ex.muscleGroup) w *= 0.3;
    // Muskelgrupper der mangler flest af dagens sæt kommer først.
    const group = plan.perGroup[ex.muscleGroup];
    if (group && group.target > 0) w *= 0.5 + group.remaining / group.target;
    // Spred sættene ud på flere øvelser.
    w *= Math.pow(0.5, doneToday.filter((h) => h.exerciseId === ex.id).length);
    return w;
  });

  const total = weights.reduce((a, b) => a + b, 0);
  let pick = random() * total;
  for (let i = 0; i < pool.length; i++) {
    pick -= weights[i];
    if (pick < 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function createSuggestion({ exercises, settings, history, now, random, exclude, ignoreTargets }) {
  const exercise = chooseExercise({ exercises, settings, history, now, random, exclude, ignoreTargets });
  if (!exercise) return null;
  const lastDone = lastCompletedAt(history);
  const minutesSinceLast = Number.isFinite(lastDone) ? (now - lastDone) / MINUTE : null;
  const progress = progressionFactor(history, exercise.id, settings.level);
  const { amount, factor } = computeAmount(exercise, settings.level, minutesSinceLast, progress);
  return { exercise, amount, factor, progress, level: settings.level, minutesSinceLast, createdAt: now };
}

function unitLabel(exercise, amount) {
  if (exercise.unit === 'seconds') return 'sekunder';
  if (exercise.unit === 'perSide') return exercise.sideLabel || 'pr. side';
  return amount === 1 ? 'gentagelse' : 'gentagelser';
}

function describeAmount(exercise, amount) {
  return `${amount} ${unitLabel(exercise, amount)}`;
}

function describeTimeSince(minutesSinceLast) {
  if (minutesSinceLast == null || !Number.isFinite(minutesSinceLast)) return 'Din første øvelse – god fornøjelse!';
  if (minutesSinceLast >= FRESH_START_MINUTES) return 'Første øvelse i et stykke tid';
  if (minutesSinceLast < 1) return 'Under et minut siden sidste øvelse';
  if (minutesSinceLast < 60) return `${Math.round(minutesSinceLast)} min. siden sidste øvelse`;
  const hours = Math.floor(minutesSinceLast / 60);
  const minutes = Math.round(minutesSinceLast % 60);
  return `${hours} t. ${minutes} min. siden sidste øvelse`;
}

module.exports = {
  TIME_CURVE,
  FRESH_START_MINUTES,
  timeFactor,
  hasEquipment,
  focusAreasOf,
  matchesFocus,
  setsFor,
  isEnabled,
  availableExercises,
  setsDoneToday,
  dailyPlan,
  difficultyWeight,
  progressionFactor,
  computeAmount,
  easierSuggestion,
  lastCompletedAt,
  chooseExercise,
  createSuggestion,
  unitLabel,
  describeAmount,
  describeTimeSince,
};
