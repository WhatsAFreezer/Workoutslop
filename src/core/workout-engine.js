'use strict';

// Vælger hvilken øvelse brugeren skal lave, og hvor meget.

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

function availableExercises(exercises, { level, equipment }) {
  return exercises.filter((ex) => hasEquipment(ex, equipment) && baseAmount(ex, level) != null);
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
function chooseExercise({ exercises, settings, history, now, random = Math.random, exclude = [] }) {
  const pool = availableExercises(exercises, settings).filter((ex) => !exclude.includes(ex.id));
  if (pool.length === 0) return null;

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

function createSuggestion({ exercises, settings, history, now, random, exclude }) {
  const exercise = chooseExercise({ exercises, settings, history, now, random, exclude });
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
  availableExercises,
  computeAmount,
  lastCompletedAt,
  chooseExercise,
  createSuggestion,
  unitLabel,
  describeAmount,
  describeTimeSince,
};
