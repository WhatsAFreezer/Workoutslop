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

function computeAmount(exercise, level, minutesSinceLast) {
  const base = baseAmount(exercise, level);
  if (base == null) return null;
  const factor = timeFactor(minutesSinceLast);
  const raw = base * factor;
  // Sekunder rundes til nærmeste 5, så det er let at tælle.
  const amount = exercise.unit === 'seconds' ? Math.max(10, Math.round(raw / 5) * 5) : Math.max(1, Math.round(raw));
  return { amount, base, factor };
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

  const recent = history.filter((h) => now - h.at < 60 * MINUTE && h.status !== 'preview');
  const last = recent.length > 0 ? recent[recent.length - 1] : null;

  const weights = pool.map((ex) => {
    let w = 1;
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
  const { amount, factor } = computeAmount(exercise, settings.level, minutesSinceLast);
  return { exercise, amount, factor, minutesSinceLast, createdAt: now };
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
  computeAmount,
  lastCompletedAt,
  chooseExercise,
  createSuggestion,
  unitLabel,
  describeAmount,
  describeTimeSince,
};
