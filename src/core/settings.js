'use strict';

const {
  LEVELS,
  EQUIPMENT,
  FOCUS_AREAS,
  OVERLAY_POSITIONS,
  DEFAULT_SETS_PER_DAY,
  MAX_SETS_PER_DAY,
} = require('./catalog');
const { EXERCISES } = require('./exercises');
const { INTEGRATIONS } = require('./gsi');

const SPEAK_MODES = ['never', 'fullscreen', 'always'];

const DEFAULT_SETTINGS = {
  setupComplete: false,
  level: 2,
  equipment: [],
  focus: [], // tom = hele kroppen
  disabledExercises: [], // øvelser brugeren har fravalgt
  setsPerDay: { ...DEFAULT_SETS_PER_DAY },
  minMinutesBetween: 10,
  useIdleDetection: true,
  idleSeconds: 25,
  customGames: [],
  overlayPosition: 'top-right',
  sound: true,
  speak: 'fullscreen', // læs øvelsen højt: 'never' | 'fullscreen' (kun når overlayet ikke kan ses) | 'always'
  openAtLogin: false,
  gsiPort: 3417,
  gsiToken: '',
  // Hvor cfg-filerne til CS2/Dota 2 er installeret, fx { cs2: 'D:\\...\\cfg\\...cfg' }.
  integrationFiles: {},
};

const clampInt = (value, min, max, fallback) => {
  if (value == null || value === '') return fallback;
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function normalizeIntegrationFiles(value) {
  const result = {};
  if (!value || typeof value !== 'object') return result;
  for (const id of Object.keys(INTEGRATIONS)) {
    if (typeof value[id] === 'string' && value[id].length < 1000) result[id] = value[id];
  }
  return result;
}

function normalizeSetsPerDay(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(
    Object.entries(DEFAULT_SETS_PER_DAY).map(([group, fallback]) => [
      group,
      clampInt(raw[group], 0, MAX_SETS_PER_DAY, fallback),
    ]),
  );
}

function normalizeCustomGames(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];
  for (const item of list) {
    const processName = String(item?.process ?? '')
      .trim()
      .slice(0, 120);
    if (!processName) continue;
    const key = processName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const name =
      String(item?.name ?? '')
        .trim()
        .slice(0, 60) || processName.replace(/\.exe$/i, '');
    result.push({ name, process: processName });
  }
  return result.slice(0, 40);
}

// Gør indstillinger gyldige, uanset om de kommer fra en gammel fil eller fra UI'et.
function normalizeSettings(raw = {}) {
  const d = DEFAULT_SETTINGS;
  const knownEquipment = new Set(EQUIPMENT.map((e) => e.id));
  const knownFocus = new Set(FOCUS_AREAS.map((f) => f.id));
  const knownExercises = new Set(EXERCISES.map((e) => e.id));

  return {
    setupComplete: Boolean(raw.setupComplete),
    level: LEVELS.some((l) => l.id === Number(raw.level)) ? Number(raw.level) : d.level,
    equipment: Array.isArray(raw.equipment) ? [...new Set(raw.equipment.filter((id) => knownEquipment.has(id)))] : [],
    focus: Array.isArray(raw.focus) ? [...new Set(raw.focus.filter((id) => knownFocus.has(id)))] : [],
    disabledExercises: Array.isArray(raw.disabledExercises)
      ? [...new Set(raw.disabledExercises.filter((id) => knownExercises.has(id)))]
      : [],
    setsPerDay: normalizeSetsPerDay(raw.setsPerDay),
    minMinutesBetween: clampInt(raw.minMinutesBetween, 1, 120, d.minMinutesBetween),
    useIdleDetection: raw.useIdleDetection == null ? d.useIdleDetection : Boolean(raw.useIdleDetection),
    idleSeconds: clampInt(raw.idleSeconds, 10, 120, d.idleSeconds),
    customGames: normalizeCustomGames(raw.customGames),
    overlayPosition: OVERLAY_POSITIONS.includes(raw.overlayPosition) ? raw.overlayPosition : d.overlayPosition,
    sound: raw.sound == null ? d.sound : Boolean(raw.sound),
    speak: SPEAK_MODES.includes(raw.speak) ? raw.speak : d.speak,
    openAtLogin: Boolean(raw.openAtLogin),
    gsiPort: clampInt(raw.gsiPort, 1024, 65535, d.gsiPort),
    gsiToken: typeof raw.gsiToken === 'string' && /^[a-f0-9]{16,64}$/.test(raw.gsiToken) ? raw.gsiToken : '',
    integrationFiles: normalizeIntegrationFiles(raw.integrationFiles),
  };
}

module.exports = { DEFAULT_SETTINGS, SPEAK_MODES, normalizeSettings };
