'use strict';

// Hovedprocessen: holder styr på vinduer, bakkeikon, genvejstaster og
// "løkken" der hvert sekund tjekker, om brugeren holder pause i et spil.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  globalShortcut,
  powerMonitor,
  screen,
  nativeImage,
  Notification,
  dialog,
  clipboard,
} = require('electron');

const { createStore } = require('./store');
const { listProcesses } = require('./process-list');
const { startGsiServer } = require('./gsi-server');
const { installIntegration, integrationStatus } = require('./gsi-install');
const { createUpdater, describeUpdate } = require('./updater');
const { LEVELS, EQUIPMENT, FREQUENCIES, MUSCLE_GROUPS, FOCUS_AREAS, MAX_SETS_PER_DAY } = require('../core/catalog');
const { EXERCISES } = require('../core/exercises');
const engine = require('../core/workout-engine');
const {
  KNOWN_GAMES,
  customGamesToDefinitions,
  autoGamesToDefinitions,
  GameDetector,
  selectableProcesses,
  normalizeProcessName,
} = require('../core/games');
const { GameFinder, isGameFocused, isKnownNonGame, gameFromPath } = require('../core/game-detection');
const { EventLog, formatTime, formatReport } = require('../core/event-log');
const { INTEGRATIONS, parseGsiPayload } = require('../core/gsi');
const { normalizeSettings, MAX_CUSTOM_DAYS } = require('../core/settings');
const { PauseDetector } = require('../core/pause-detector');
const { Coach } = require('../core/coach');
const { todaySummary, describeToday, setsByDay, streakDays } = require('../core/stats');
const { GamepadActivity } = require('../core/gamepad-activity');
const windowsNative = require('./windows-native');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, 'preload.js');
const APP_ICON = path.join(ROOT, 'assets', 'icon.png');
const TRAY_ICON = path.join(ROOT, 'assets', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png');

const TICK_MS = 1000;
const PROCESS_SCAN_MS = 5000;
const GSI_STALE_MS = 30 * 1000; // spillet sender et "heartbeat" hvert 10. sekund
const SNOOZE_MINUTES = 10;
const BACKGROUND_SECONDS = 15; // så længe skal spillet være i baggrunden, før det er en pause
const UPDATE_INSTALL_AFTER_MS = 2 * 60 * 1000; // ingen spil i 2 min. = tid til at opdatere
const OVERLAY_WIDTH = 392;
const OVERLAY_MARGIN = 12;

const modifierLabel = process.platform === 'darwin' ? 'Cmd+Alt' : 'Ctrl+Alt';
const HOTKEYS = {
  now: { accelerator: 'CommandOrControl+Alt+W', key: 'W', description: 'Vis en øvelse nu' },
  done: { accelerator: 'CommandOrControl+Alt+D', key: 'D', description: 'Markér øvelsen som færdig' },
  hide: { accelerator: 'CommandOrControl+Alt+S', key: 'S', description: 'Spring øvelsen over' },
};
const hotkeyLabel = (id) => `${modifierLabel}+${HOTKEYS[id].key}`;

// De felter opsætningen må ændre.
const EDITABLE_KEYS = [
  'level',
  'equipment',
  'focus',
  'customDays',
  'disabledExercises',
  'setsPerDay',
  'minMinutesBetween',
  'useIdleDetection',
  'useFocusDetection',
  'idleSeconds',
  'customGames',
  'overlayPosition',
  'sound',
  'speak',
  'openAtLogin',
];

// Gør det muligt at teste med en tom profil: WORKOUTSLOP_DATA_DIR=./tmp npm start
if (process.env.WORKOUTSLOP_DATA_DIR) app.setPath('userData', path.resolve(process.env.WORKOUTSLOP_DATA_DIR));

let store;
let settings;
let tray = null;
let setupWindow = null;
let overlayWindow = null;
let overlayReady = false;
let overlayHeight = 300;
let overlayShowPending = false;
const overlayQueue = [];

let gsiServer = null;
let gsiError = null;
let gsiState = null; // { game, isBreak, label, at }

let detected = null; // { game, phase }
let scanning = false;
let lastScanAt = 0;
let lastPause = { state: 'noGame', source: 'none', reason: 'Intet spil kører', game: null };
let lastIdleSeconds = 0;
let hotkeyStatus = {};
let trayKey = '';
let updater = null;
let notifiedUpdateVersion = null;
let noGameSince = Date.now(); // til automatisk installation af opdateringer
let topmostTimer = null;

// Det vi ved om spillets vindue (kun Windows).
const focus = {
  foreground: null, // seneste forgrundsvindue (ikke vores eget)
  gameFocused: null, // true/false/null
  backgroundSince: null, // hvornår spillet sidst mistede fokus
  gameMonitor: null, // skærmen spillet sidst blev vist på (fysiske pixels)
  gameFullscreen: false, // fylder spillet hele skærmen?
};
const gameFinder = new GameFinder();
const gameDetector = new GameDetector();

// Fejlfinding: hvad appen har registreret og gjort (kun i hukommelsen).
const events = new EventLog(300);
const logEvent = (text) => events.add(text);
let scanInfo = { at: 0, processes: 0, windowCheck: false, failed: false };
let lastForegroundKey = '';
let lastWindowless = '';
let lastGsiLabel = '';
let lastUpdateState = '';

const exeName = (file) => (file ? path.basename(String(file).replace(/\\/g, '/')) : 'ukendt program');
const gameKind = (game) => (game?.custom ? 'tilføjet af dig' : game?.auto ? 'fundet automatisk' : 'kendt spil');
const SOURCE_NAMES = {
  integration: 'spillets egen integration',
  process: 'lobby/kamp-programmer',
  focus: 'alt-tab',
  idle: 'inaktivitet',
  none: 'ingen',
};

function describePause(p) {
  if (p.state === 'noGame') return 'Intet spil kører';
  const name = p.game?.name ?? 'Spil';
  const signal = SOURCE_NAMES[p.source] ?? p.source;
  if (p.state === 'pause') return `Pause i ${name}: ${p.reason} (signal: ${signal})`;
  return `Spiller ${name} (signal: ${signal})`;
}

const pauseDetector = new PauseDetector();
const gamepads = new GamepadActivity();
const coach = new Coach({
  suggest: (now, exclude, override, options = {}) =>
    engine.createSuggestion({
      exercises: EXERCISES,
      settings: override || settings,
      history: store.history,
      now,
      exclude,
      ignoreTargets: options.ignoreTargets,
    }),
  ease: (suggestion) => engine.easierSuggestion(suggestion),
});

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj && k in obj).map((k) => [k, obj[k]]));

// --- Spil og pauser -----------------------------------------------------------

function allGames() {
  return [
    ...customGamesToDefinitions(settings.customGames),
    ...autoGamesToDefinitions(settings.autoGames),
    ...KNOWN_GAMES,
  ];
}

// Er programmet allerede kendt, tilføjet eller afvist? (Foreslåede programmer
// vurderes igen, så de bliver tilføjet, hvis man spiller i dem.)
function isKnownProcess(exe) {
  const key = normalizeProcessName(exe);
  const lists = [settings.customGames, settings.autoGames];
  return (
    settings.ignoredGames.includes(key) ||
    lists.some((list) => list.some((g) => normalizeProcessName(g.process) === key)) ||
    KNOWN_GAMES.some((g) => g.processes.some((p) => normalizeProcessName(p) === key))
  );
}

// Hvert sekund: hvilket program er i forgrunden? Bruges til at finde nye spil,
// opdage alt-tab ud af spillet og placere overlayet på spillets skærm.
function trackForeground(now, idleSeconds) {
  const fg = windowsNative.foregroundWindow();
  // Vores eget overlay/vindue i forgrunden ændrer ikke på, hvad spillet gør.
  if (!fg || fg.pid === process.pid) return;
  focus.foreground = fg;
  const fgKey = `${exeName(fg.path)}|${fg.coversMonitor}|${fg.minimized}`;
  if (fgKey !== lastForegroundKey) {
    lastForegroundKey = fgKey;
    const how = fg.coversMonitor ? ' (fylder skærmen)' : fg.minimized ? ' (minimeret)' : '';
    logEvent(`Forgrund: ${exeName(fg.path)}${how}`);
  }

  const exclusive = fg.coversMonitor && windowsNative.notificationState() === 'exclusive';
  const found = gameFinder.update(fg, now, isKnownProcess, { idleSeconds, exclusive });
  if (found?.added) {
    const why = gameFromPath(fg.path)
      ? 'ligger i et spilbibliotek'
      : exclusive
        ? 'kører i eksklusiv fuldskærm'
        : 'fyldte skærmen, mens du var aktiv';
    logEvent(`Nyt spil tilføjet: ${found.added.name} – ${why}`);
  } else if (found?.suggested) {
    logEvent(`Foreslået som spil: ${found.suggested.name} (fyldte skærmen, men uden ret meget aktivitet)`);
  }
  const same = (game) => (g) => normalizeProcessName(g.process) === normalizeProcessName(game.process);
  if (found?.added) {
    settings = store.saveSettings({
      ...settings,
      autoGames: [...settings.autoGames, found.added],
      gameSuggestions: settings.gameSuggestions.filter((g) => !same(found.added)(g)),
    });
    scanProcesses();
  } else if (found?.suggested && !settings.gameSuggestions.some(same(found.suggested))) {
    settings = store.saveSettings({ ...settings, gameSuggestions: [...settings.gameSuggestions, found.suggested] });
  }

  const focused = isGameFocused(detected?.game, fg);
  if (focused === true) {
    focus.backgroundSince = null;
    focus.gameMonitor = fg.monitor;
    focus.gameFullscreen = fg.coversMonitor;
  } else if (focused === false && focus.gameFocused !== false) {
    focus.backgroundSince = now;
  }
  focus.gameFocused = focused;
}

async function scanProcesses() {
  if (scanning) return;
  scanning = true;
  lastScanAt = Date.now();
  try {
    const processes = await listProcesses();
    if (processes.length === 0) {
      // Kunne ikke læses – behold det, vi ved.
      if (!scanInfo.failed) logEvent('Kunne ikke læse listen over kørende programmer');
      scanInfo.failed = true;
      return;
    }
    // Kun Windows: hvilke af processerne har et synligt vindue?
    const pids = windowsNative.visibleWindowPids();
    const windowed = pids && processes.filter((p) => pids.has(p.pid)).map((p) => p.name);
    const before = detected?.game ?? null;
    detected = gameDetector.update(
      processes.map((p) => p.name),
      allGames(),
      windowed,
    );
    scanInfo = { at: Date.now(), processes: processes.length, windowCheck: windowed != null, failed: false };

    const after = detected?.game ?? null;
    if (before?.name !== after?.name) {
      if (before) logEvent(`Spil lukket: ${before.name}`);
      if (after) logEvent(`Spil fundet: ${after.name} (${gameKind(after)}, ${after.processes.join(', ')})`);
    }
    const windowless = gameDetector.windowless.join(', ');
    if (windowless !== lastWindowless && windowless) {
      logEvent(`${windowless} kører stadig, men har intet synligt vindue – regnes som lukket`);
    }
    lastWindowless = windowless;
  } finally {
    scanning = false;
  }
}

function currentIntegration(game, now) {
  if (!game?.integration || !gsiState) return null;
  if (gsiState.game !== game.integration || now - gsiState.at > GSI_STALE_MS) return null;
  return gsiState;
}

function tick() {
  const now = Date.now();
  if (now - lastScanAt >= PROCESS_SCAN_MS) scanProcesses();

  // Windows tæller ikke controller-input som aktivitet, så vi bruger det korteste af de to.
  const idleSeconds = Math.min(powerMonitor.getSystemIdleTime(), gamepads.idleSeconds(now));
  trackForeground(now, idleSeconds);

  const game = detected?.game ?? null;
  const backgroundSeconds =
    game && focus.gameFocused === false && focus.backgroundSince != null ? (now - focus.backgroundSince) / 1000 : null;
  lastPause = pauseDetector.update({
    now,
    game,
    phase: detected?.phase ?? null,
    integration: currentIntegration(game, now),
    idleSeconds,
    useIdle: settings.useIdleDetection,
    idleThreshold: settings.idleSeconds,
    backgroundSeconds: settings.useFocusDetection ? backgroundSeconds : null,
    backgroundThreshold: BACKGROUND_SECONDS,
  });
  lastIdleSeconds = idleSeconds;
  if (lastPause.changed) logEvent(describePause(lastPause));

  runCommands(coach.tick({ now, pause: lastPause, idleSeconds, settings }));
  maybeInstallUpdate(now);
  refreshTray();
}

// En hentet opdatering installeres automatisk, når der ikke har kørt et spil i
// et par minutter, og der ikke vises en øvelse. Appen genstarter stille.
function maybeInstallUpdate(now) {
  if (lastPause.state !== 'noGame') noGameSince = now;
  if (updater.status().state !== 'ready' || coach.current) return;
  if (now - noGameSince >= UPDATE_INSTALL_AFTER_MS) updater.install();
}

// Aflæser Xbox-kompatible controllere flere gange i sekundet (kun Windows).
// Ikke-tilsluttede pladser tjekkes sjældnere, fordi det er langsomt i XInput.
function startGamepadPolling() {
  if (!windowsNative.capabilities().gamepads) return;
  const nextCheck = new Array(windowsNative.XUSER_MAX_COUNT).fill(0);
  setInterval(() => {
    const now = Date.now();
    for (let i = 0; i < windowsNative.XUSER_MAX_COUNT; i++) {
      if (now < nextCheck[i]) continue;
      const state = windowsNative.readGamepad(i);
      gamepads.update(i, state, now);
      nextCheck[i] = state ? 0 : now + 3000;
    }
  }, 250);
}

function startGsi() {
  gsiError = null;
  gsiServer = startGsiServer({
    port: settings.gsiPort,
    getToken: () => settings.gsiToken,
    onPayload: (payload) => {
      const parsed = parseGsiPayload(payload);
      if (!parsed) return;
      gsiState = { ...parsed, at: Date.now() };
      const label = `${INTEGRATIONS[parsed.game]?.name ?? parsed.game} sender: ${parsed.label}`;
      if (label !== lastGsiLabel) logEvent(label);
      lastGsiLabel = label;
    },
    onError: (err) => {
      gsiError = err.code === 'EADDRINUSE' ? `Port ${settings.gsiPort} er allerede i brug.` : err.message;
      logEvent(`CS2/Dota 2-integration: ${gsiError}`);
    },
  });
}

// --- Overlay ---------------------------------------------------------------------

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: overlayHeight,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    title: 'Workoutslop',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  // 'screen-saver' lægger vinduet over spil i (kantløs) fuldskærm.
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  lockDownNavigation(overlayWindow);
  overlayWindow.webContents.on('did-finish-load', () => {
    overlayReady = true;
    for (const [channel, payload] of overlayQueue.splice(0)) overlayWindow.webContents.send(channel, payload);
  });
  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
  overlayWindow.loadFile(path.join(RENDERER, 'overlay', 'index.html'));
}

function sendOverlay(channel, payload) {
  if (!overlayWindow) return;
  if (overlayReady) overlayWindow.webContents.send(channel, payload);
  else overlayQueue.push([channel, payload]);
}

function overlayCorner() {
  const c = coach.current;
  return c?.trigger === 'preview' && c.settingsOverride ? c.settingsOverride.overlayPosition : settings.overlayPosition;
}

// Skærmen spillet kører på – ellers hovedskærmen.
function overlayDisplay() {
  const monitor = focus.gameMonitor;
  if (!monitor) return screen.getPrimaryDisplay();
  const physical = {
    x: monitor.left,
    y: monitor.top,
    width: monitor.right - monitor.left,
    height: monitor.bottom - monitor.top,
  };
  const dip = process.platform === 'win32' ? screen.screenToDipRect(null, physical) : physical;
  return screen.getDisplayMatching(dip);
}

function positionOverlay() {
  if (!overlayWindow) return;
  const area = overlayDisplay().workArea;
  const height = Math.min(Math.round(overlayHeight), area.height - OVERLAY_MARGIN * 2);
  const corner = overlayCorner();
  const x = corner.endsWith('right') ? area.x + area.width - OVERLAY_WIDTH - OVERLAY_MARGIN : area.x + OVERLAY_MARGIN;
  const y = corner.startsWith('top') ? area.y + OVERLAY_MARGIN : area.y + area.height - height - OVERLAY_MARGIN;
  overlayWindow.setBounds({ x: Math.round(x), y: Math.round(y), width: OVERLAY_WIDTH, height });
}

// Overlayet vises først, når siden har målt sin højde – så det ikke hopper.
function showOverlaySoon() {
  overlayShowPending = true;
  setTimeout(() => {
    if (overlayShowPending) revealOverlay();
  }, 400);
}

function revealOverlay() {
  overlayShowPending = false;
  if (!overlayWindow || !coach.current) return;
  positionOverlay();
  if (!overlayWindow.isVisible()) {
    overlayWindow.showInactive(); // stjæl ikke fokus fra spillet
    const display = overlayDisplay();
    const all = screen.getAllDisplays();
    const index = all.findIndex((d) => d.id === display.id);
    const fs = fullscreenState();
    logEvent(
      `Overlay vist på skærm ${index + 1} af ${all.length} (${display.size.width}×${display.size.height})` +
        (fs === 'exclusive' ? ' – spillet er i eksklusiv fuldskærm, så overlayet kan ikke ses' : ''),
    );
  }
  keepOnTop();
  // Mange spil lægger sig selv "altid øverst" igen og igen. Så længe overlayet
  // vises, lægger vi det øverst igen hvert halve sekund.
  clearInterval(topmostTimer);
  topmostTimer = setInterval(keepOnTop, 500);
}

function keepOnTop() {
  if (!overlayWindow?.isVisible()) return;
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.moveTop();
  windowsNative.bringToTop(overlayWindow.getNativeWindowHandle());
}

function hideOverlay() {
  overlayShowPending = false;
  clearInterval(topmostTimer);
  topmostTimer = null;
  sendOverlay('overlay:clear');
  overlayWindow?.hide();
}

function equipmentNames(exercise) {
  return exercise.equipment.map((req) => {
    const ids = Array.isArray(req) ? req : [req];
    return ids.map((id) => EQUIPMENT.find((e) => e.id === id)?.name ?? id).join(' eller ');
  });
}

function contextLabel(current) {
  if (current.trigger === 'preview') return 'Eksempel';
  if (current.trigger === 'manual') return 'Øvelse nu';
  return current.gameName ? `Pause · ${current.gameName}` : 'Pause registreret';
}

// "sæt 2 af 3 i dag" for øvelsens muskelgruppe.
function setProgressText(exercise, activeSettings) {
  const group = engine.dailyPlan(EXERCISES, activeSettings, store.history, Date.now()).perGroup[exercise.muscleGroup];
  if (!group || group.target === 0) return '';
  return group.done < group.target ? `sæt ${group.done + 1} af ${group.target} i dag` : 'ekstra sæt';
}

// 'exclusive' (overlayet kan ikke ses), 'borderless' (spillet fylder skærmen) eller null.
function fullscreenState() {
  if (windowsNative.notificationState() === 'exclusive') return 'exclusive';
  if (focus.gameFocused && focus.gameFullscreen) return 'borderless';
  return null;
}

// Læs øvelsen højt, hvis brugeren vil – eller hvis spillet kører i fuld skærm.
// I eksklusiv fuldskærm kan overlayet slet ikke ses, og i kantløs fuldskærm kan et
// spil i sjældne tilfælde ligge ovenpå, så oplæsningen er en sikkerhed.
function shouldSpeak(current) {
  const mode = (current.settingsOverride || settings).speak;
  if (mode === 'always') return true;
  if (mode === 'never' || current.trigger === 'preview') return false;
  return fullscreenState() != null;
}

function todayText(now) {
  const plan = engine.dailyPlan(EXERCISES, settings, store.history, now);
  if (plan.hasTargets) return `${plan.done} af ${plan.target} sæt i dag`;
  return describeToday(todaySummary(store.history, now, EXERCISES));
}

// Forklarer, hvis mængden er tilpasset brugeren (progression eller "For hårdt").
function adjustText(suggestion) {
  if (suggestion.eased) return 'Sat ned – den er også lettere næste gang';
  const pct = Math.round(((suggestion.progress ?? 1) - 1) * 100);
  if (pct >= 1) return `+${pct} % – du har klaret den før`;
  if (pct <= -1) return `${pct} % efter "For hårdt"`;
  return '';
}

function overlayPayload(current, fresh) {
  const { suggestion } = current;
  const ex = suggestion.exercise;
  return {
    fresh,
    mode: current.mode,
    context: contextLabel(current),
    reason: current.reason,
    exercise: {
      id: ex.id,
      name: ex.name,
      unit: ex.unit,
      steps: ex.steps,
      tip: ex.tip,
      animation: ex.animation,
      muscleGroup: MUSCLE_GROUPS[ex.muscleGroup],
      equipment: equipmentNames(ex),
    },
    amount: suggestion.amount,
    unitLabel: engine.unitLabel(ex, suggestion.amount),
    adjustText: adjustText(suggestion),
    canEase: engine.easierSuggestion(suggestion) != null,
    sinceText: engine.describeTimeSince(suggestion.minutesSinceLast),
    setText: setProgressText(ex, current.settingsOverride || settings),
    hotkeys: { done: hotkeyLabel('done'), hide: hotkeyLabel('hide') },
    snoozeMinutes: SNOOZE_MINUTES,
    sound: settings.sound,
    speak: fresh && shouldSpeak(current),
    speechText: `${ex.name}. ${suggestion.amount} ${engine.unitLabel(ex, suggestion.amount)}. Tryk kontrol, alt, D, når du er færdig.`,
  };
}

// Udfører de kommandoer "træneren" (coach.js) beder om.
const TRIGGER_NAMES = { pause: 'pause i spillet', manual: 'genvejstast eller knap', preview: 'eksempel' };
const STATUS_NAMES = {
  done: 'færdig',
  skipped: 'sprunget over',
  missed: 'ikke nået',
  easier: '"For hårdt"',
};

function logCommand(cmd) {
  if (cmd.type === 'show') {
    const { suggestion, trigger } = cmd.current;
    const what = `${suggestion.exercise.name}, ${engine.describeAmount(suggestion.exercise, suggestion.amount)}`;
    logEvent(cmd.fresh ? `Øvelse vist: ${what} (${TRIGGER_NAMES[trigger] ?? trigger})` : `Øvelse ændret: ${what}`);
  } else if (cmd.type === 'compact') {
    logEvent('Øvelsen blev gjort lille – spillet er i gang igen');
  } else if (cmd.type === 'record') {
    const name = EXERCISES.find((e) => e.id === cmd.entry.exerciseId)?.name ?? cmd.entry.exerciseId;
    logEvent(`Gemt: ${name} – ${STATUS_NAMES[cmd.entry.status] ?? cmd.entry.status}`);
  }
}

function runCommands(commands) {
  for (const cmd of commands) {
    logCommand(cmd);
    switch (cmd.type) {
      case 'show':
        sendOverlay('overlay:show', overlayPayload(cmd.current, cmd.fresh));
        showOverlaySoon();
        break;
      case 'compact':
        sendOverlay('overlay:mode', 'compact');
        break;
      case 'expand':
        sendOverlay('overlay:mode', 'full');
        showOverlaySoon();
        break;
      case 'hide':
        hideOverlay();
        break;
      case 'record':
        store.addHistory(cmd.entry);
        break;
      default:
        break;
    }
  }
  if (commands.length > 0) refreshTray(true);
}

// --- Bakkeikon ------------------------------------------------------------------

function formatClock(timestamp) {
  return new Date(timestamp).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
}

function endOfToday(now) {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

// --- Oversigt -----------------------------------------------------------------------

const PAUSE_SIGNALS = {
  integration: (game) => `${game} fortæller selv, når kampen slutter`,
  process: () => 'Lobby og kamp skelnes på spillets programmer',
  focus: () => 'Du har alt-tabbet ud af spillet',
  idle: () => `Ingen aktivitet i ${settings.idleSeconds} sek. = pause`,
  none: () => 'Kun genvejstasten (inaktivitet er slået fra)',
};

function nextExerciseText(now) {
  const next = coach.nextAllowedAt(settings);
  return next > now
    ? `Næste øvelse tidligst om ${Math.ceil((next - now) / 60000)} min.`
    : 'Næste øvelse kommer i næste pause.';
}

// Alt hvad oversigten viser: status, hvad Workoutslop registrerer, dagens sæt og ugen.
function overviewStatus() {
  const now = Date.now();
  const plan = engine.dailyPlan(EXERCISES, settings, store.history, now);
  const game = lastPause.game;
  const definition = detected?.game;
  const snoozed = coach.snoozedUntil > now;
  const caps = windowsNative.capabilities();

  let title;
  let subtitle;
  let tone;
  if (snoozed) {
    [title, subtitle, tone] = ['Motion er sat på pause', `Til kl. ${formatClock(coach.snoozedUntil)}`, 'paused'];
  } else if (plan.complete) {
    [title, subtitle, tone] = ['Dagens sæt er klaret', 'Godt gået! Workoutslop holder fri til i morgen.', 'done'];
  } else if (lastPause.state === 'noGame' || !game) {
    [title, subtitle, tone] = ['Venter på et spil', 'Start et spil – Workoutslop finder det selv.', 'idle'];
  } else if (lastPause.state === 'pause') {
    const sub = coach.current ? 'Der vises en øvelse lige nu.' : nextExerciseText(now);
    [title, subtitle, tone] = [`Pause i ${game.name}`, `${lastPause.reason}. ${sub}`, 'pause'];
  } else {
    [title, subtitle, tone] = [`Du spiller ${game.name}`, nextExerciseText(now), 'playing'];
  }

  const signals = [];
  const kind = gameKind(definition);
  signals.push({
    label: 'Spil',
    value: game ? `${game.name} (${kind})` : 'Intet spil kører',
    // Et automatisk fundet program, der ikke er et spil, kan fjernes direkte herfra.
    action: game && definition?.auto ? { label: 'Ikke et spil', process: definition.processes[0] } : null,
  });
  if (game) {
    const source = lastPause.source in PAUSE_SIGNALS ? lastPause.source : 'idle';
    signals.push({ label: 'Pauser findes ved', value: PAUSE_SIGNALS[source](game.name) });
  }
  let warning = null;
  if (game && caps.foregroundWindow && focus.gameFocused != null) {
    const fullscreen = fullscreenState();
    let value = 'I baggrunden';
    if (focus.gameFocused) {
      value = 'I forgrunden · i et vindue';
      if (fullscreen === 'exclusive') value = 'I forgrunden · eksklusiv fuldskærm';
      else if (fullscreen === 'borderless') value = 'I forgrunden · fylder skærmen';
    }
    signals.push({ label: 'Spillets vindue', value, warn: fullscreen === 'exclusive' });
    if (fullscreen === 'exclusive') {
      warning =
        'Spillet kører i eksklusiv fuldskærm, så overlayet kan ikke ses ovenpå – øvelsen læses højt i stedet. ' +
        'Vælg "kantløst vindue" eller "fuldskærm i vindue" i spillets grafikindstillinger for at se overlayet.';
    }
  }
  const idle = Math.round(lastIdleSeconds);
  signals.push({ label: 'Sidste input', value: idle <= 1 ? 'Lige nu' : `${idle} sek. siden` });
  if (caps.gamepads) {
    signals.push({
      label: 'Controller',
      value: gamepads.connected ? `${gamepads.connected} tilsluttet` : 'Ingen tilsluttet',
    });
  }

  return {
    title,
    subtitle,
    tone,
    snoozed,
    signals,
    warning,
    today: {
      done: plan.done,
      target: plan.target,
      groups: Object.keys(MUSCLE_GROUPS)
        .filter((group) => plan.perGroup[group])
        .map((group) => [group, plan.perGroup[group]])
        .map(([group, g]) => ({
          name: MUSCLE_GROUPS[group],
          done: Math.min(g.done, g.target),
          target: g.target,
        })),
    },
    week: setsByDay(store.history, now, 7),
    streak: streakDays(store.history, now),
    hotkeyNow: hotkeyLabel('now'),
  };
}

// --- Fejlfinding ---------------------------------------------------------------------

const SPEAK_NAMES = { never: 'aldrig', fullscreen: 'i fuldskærm', always: 'altid' };
const CORNER_NAMES = {
  'top-right': 'øverst til højre',
  'top-left': 'øverst til venstre',
  'bottom-right': 'nederst til højre',
  'bottom-left': 'nederst til venstre',
};

// Alt hvad fejlfindingssiden viser – også det, der kopieres som rapport.
// Kun programnavne (ingen filstier eller vinduestitler), så rapporten kan deles.
function debugSections(now) {
  const caps = windowsNative.capabilities();
  const yesNo = (v) => (v == null ? 'ukendt' : v ? 'ja' : 'nej');
  const ago = (t) => `${Math.max(0, Math.round((now - t) / 1000))} sek. siden`;
  const game = detected?.game ?? null;
  const fg = focus.foreground;
  const update = updater.status();
  const plan = engine.dailyPlan(EXERCISES, settings, store.history, now);
  const fsNative = windowsNative.notificationState();
  const next = coach.nextAllowedAt(settings);
  const c = coach.current;
  const list = (items) => (items.length ? items.join(', ') : '–');

  return [
    {
      title: 'App',
      rows: [
        ['Version', app.getVersion()],
        ['System', `${process.platform} ${os.release()} (${process.arch}), Electron ${process.versions.electron}`],
        ['Opdatering', describeUpdate(update) || update.state],
        [
          'Windows-funktioner',
          `controller ${yesNo(caps.gamepads)}, fuldskærm ${yesNo(caps.fullscreenDetection)}, ` +
            `forgrundsvindue ${yesNo(caps.foregroundWindow)}, vinduesliste ${yesNo(caps.windowList)}`,
        ],
        [
          'Genvejstaster',
          Object.keys(HOTKEYS)
            .map((id) => `${hotkeyLabel(id)} ${hotkeyStatus[id] === false ? 'virker ikke' : 'ok'}`)
            .join(', '),
        ],
      ],
    },
    {
      title: 'Spil',
      rows: [
        ['Spil', game ? `${game.name} (${gameKind(game)})` : 'Intet spil kører'],
        ['Programnavne', game ? game.processes.join(', ') : '–'],
        ['Lobby eller kamp', detected?.phase === 'lobby' ? 'lobby' : detected?.phase === 'match' ? 'kamp' : '–'],
        [
          'Sidste scanning',
          scanInfo.at
            ? `${ago(scanInfo.at)} – ${scanInfo.processes} programmer` +
              (scanInfo.windowCheck ? ', med tjek af synlige vinduer' : '')
            : 'endnu ikke',
        ],
        ['Kører uden vindue', list(gameDetector.windowless)],
        [
          'I forgrunden',
          fg
            ? `${exeName(fg.path)}${fg.coversMonitor ? ', fylder skærmen' : ''}${fg.minimized ? ', minimeret' : ''}`
            : 'ukendt',
        ],
        ['Spillet i forgrunden', game ? yesNo(focus.gameFocused) : '–'],
        [
          'Fuldskærm',
          fsNative === 'exclusive'
            ? 'eksklusiv fuldskærm (overlayet kan ikke ses – øvelsen læses højt)'
            : fsNative === 'fullscreen'
              ? 'et program kører i fuld skærm'
              : fsNative === 'normal'
                ? 'nej'
                : 'ukendt',
        ],
        ['Fundet automatisk', list(settings.autoGames.map((g) => `${g.name} (${g.process})`))],
        ['Tilføjet af dig', list(settings.customGames.map((g) => `${g.name} (${g.process})`))],
        ['Foreslået', list(settings.gameSuggestions.map((g) => g.process))],
        ['Afvist', list(settings.ignoredGames)],
      ],
    },
    {
      title: 'Pauser',
      rows: [
        ['Tilstand', describePause(lastPause)],
        [
          'Sidste input',
          `${Math.round(powerMonitor.getSystemIdleTime())} sek. siden (mus/tastatur)` +
            (caps.gamepads ? `, ${Math.round(Math.min(gamepads.idleSeconds(now), 99999))} sek. (controller)` : ''),
        ],
        ['Controllere', caps.gamepads ? String(gamepads.connected) : 'kun på Windows'],
        ['Inaktivitet giver pause', settings.useIdleDetection ? `ja, efter ${settings.idleSeconds} sek.` : 'nej'],
        ['Alt-tab giver pause', settings.useFocusDetection ? `ja, efter ${BACKGROUND_SECONDS} sek.` : 'nej'],
        ['Spillet i baggrunden', game && focus.backgroundSince != null ? ago(focus.backgroundSince) : '–'],
        [
          'CS2/Dota 2-integration',
          gsiError
            ? `fejl: ${gsiError}`
            : gsiState
              ? `${INTEGRATIONS[gsiState.game]?.name ?? gsiState.game}: ${gsiState.label} (${ago(gsiState.at)})`
              : `lytter på port ${settings.gsiPort} – intet modtaget endnu`,
        ],
      ],
    },
    {
      title: 'Øvelser',
      rows: [
        ['Vises nu', c ? `${c.suggestion.exercise.name} (${c.mode}, ${TRIGGER_NAMES[c.trigger] ?? c.trigger})` : 'nej'],
        ['Næste øvelse tidligst', next > now ? `om ${Math.ceil((next - now) / 60000)} min.` : 'nu'],
        ['Sat på pause', coach.snoozedUntil > now ? `til kl. ${formatClock(coach.snoozedUntil)}` : 'nej'],
        ['Dagens sæt', plan.hasTargets ? `${plan.done} af ${plan.target}` : 'intet mål'],
        ['Niveau', LEVELS.find((l) => l.id === settings.level)?.name ?? String(settings.level)],
        ['Udstyr', list(settings.equipment.map((id) => EQUIPMENT.find((e) => e.id === id)?.name ?? id))],
        [
          'Fokus',
          settings.focus.length
            ? list(
                settings.focus.map(
                  (id) => engine.allFocusAreas(settings.customDays).find((f) => f.id === id)?.name ?? id,
                ),
              )
            : 'hele kroppen',
        ],
        [
          'Overlay',
          `${CORNER_NAMES[settings.overlayPosition] ?? settings.overlayPosition}, oplæsning ${SPEAK_NAMES[settings.speak] ?? settings.speak}`,
        ],
      ],
    },
  ];
}

function debugReport(now) {
  return formatReport({
    title: `Workoutslop ${app.getVersion()} – fejlfinding (${new Date(now).toLocaleString('da-DK')})`,
    sections: debugSections(now),
    log: events.list(),
  });
}

function statusText(now) {
  if (coach.snoozedUntil > now) return `Sat på pause til kl. ${formatClock(coach.snoozedUntil)}`;
  if (engine.dailyPlan(EXERCISES, settings, store.history, now).complete) return 'Dagens sæt er klaret – godt gået!';
  const p = lastPause;
  if (p.state === 'noGame') return 'Venter på, at du starter et spil';
  const game = p.game?.name ?? 'Spil';
  if (p.state === 'playing') return `${game}: du spiller`;
  if (coach.current) return `${game}: pause – øvelse vist`;
  const reason = p.source === 'idle' ? 'ingen aktivitet' : p.reason.toLowerCase();
  const next = coach.nextAllowedAt(settings);
  if (next > now) return `${game}: pause (${reason}) – næste øvelse om ${Math.ceil((next - now) / 60000)} min.`;
  return `${game}: pause (${reason})`;
}

function createTray() {
  const image = nativeImage.createFromPath(TRAY_ICON);
  if (process.platform === 'darwin') image.setTemplateImage(true);
  tray = new Tray(image);
  tray.on('click', () => tray.popUpContextMenu());
  refreshTray(true);
}

// --- Opdateringer ----------------------------------------------------------------

function updatePayload() {
  const status = updater.status();
  return { state: status.state, version: status.version ?? null, text: describeUpdate(status) };
}

function onUpdateStatus(status) {
  if (status.state !== lastUpdateState) logEvent(`Opdatering: ${describeUpdate(status) || status.state}`);
  lastUpdateState = status.state;
  refreshTray(true);
  setupWindow?.webContents.send('updates:status', updatePayload());
  if (status.state === 'ready' && notifiedUpdateVersion !== status.version && Notification.isSupported()) {
    notifiedUpdateVersion = status.version;
    const notification = new Notification({
      title: `Workoutslop ${status.version} er klar`,
      body: 'Den installeres af sig selv, når du ikke spiller. Klik her for at genstarte og opdatere nu.',
      icon: APP_ICON,
    });
    notification.on('click', () => updater.install());
    notification.show();
  }
}

function updateMenu(status) {
  const version = { label: `Version ${app.getVersion()}`, enabled: false };
  switch (status.state) {
    case 'dev':
      return [version];
    case 'ready':
      return [{ label: `Genstart og opdatér til ${status.version}`, click: () => updater.install() }, version];
    case 'checking':
    case 'downloading':
      return [{ label: describeUpdate(status), enabled: false }, version];
    default:
      return [{ label: 'Søg efter opdateringer', click: () => updater.check() }, version];
  }
}

function focusLabel(focus) {
  if (focus.length === 0) return 'Hele kroppen';
  return engine
    .allFocusAreas(settings.customDays)
    .filter((area) => focus.includes(area.id))
    .map((area) => area.name)
    .join(' + ');
}

// Skift fokus direkte fra bakkemenuen, fx "Bryst & skuldre" + "Arme" i dag.
function setFocus(focus) {
  settings = store.saveSettings({ ...settings, focus });
  refreshTray(true);
}

function focusMenu() {
  const focus = settings.focus;
  const item = (area) => ({
    label: area.name,
    type: 'checkbox',
    checked: focus.includes(area.id),
    click: () => setFocus(focus.includes(area.id) ? focus.filter((id) => id !== area.id) : [...focus, area.id]),
  });
  return [
    { label: 'Hele kroppen', type: 'checkbox', checked: focus.length === 0, click: () => setFocus([]) },
    { type: 'separator' },
    ...FOCUS_AREAS.map(item),
    ...(settings.customDays.length ? [{ type: 'separator' }, ...settings.customDays.map(item)] : []),
  ];
}

function pauseExercises(until) {
  runCommands(coach.pauseUntil(until));
  refreshTray(true);
}

function refreshTray(force = false) {
  if (!tray) return;
  const now = Date.now();
  const status = statusText(now);
  const today = todayText(now);
  const paused = coach.snoozedUntil > now;
  const update = updater.status();
  const key = `${status}|${today}|${paused}|${settings.focus.join(',')}|${update.state}|${update.percent}`;
  if (!force && key === trayKey) return;
  trayKey = key;

  tray.setToolTip(`Workoutslop – ${status}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: status, enabled: false },
      { label: today, enabled: false },
      { type: 'separator' },
      {
        label: `Vis en øvelse nu (${hotkeyLabel('now')})`,
        click: () => runCommands(coach.requestNow(Date.now())),
      },
      paused
        ? {
            label: 'Genoptag motion',
            click: () => {
              coach.resume();
              refreshTray(true);
            },
          }
        : {
            label: 'Sæt motion på pause',
            submenu: [
              { label: '30 minutter', click: () => pauseExercises(Date.now() + 30 * 60000) },
              { label: '1 time', click: () => pauseExercises(Date.now() + 60 * 60000) },
              { label: 'Resten af dagen', click: () => pauseExercises(endOfToday(Date.now())) },
            ],
          },
      { label: `Træn: ${focusLabel(settings.focus)}`, submenu: focusMenu() },
      { type: 'separator' },
      { label: 'Opsætning…', click: openSetup },
      ...updateMenu(update),
      { label: 'Afslut Workoutslop', click: () => app.quit() },
    ]),
  );
}

// --- Genvejstaster ------------------------------------------------------------------

function registerHotkeys() {
  const actions = {
    now: () => runCommands(coach.requestNow(Date.now())),
    done: () => coach.current && sendOverlay('overlay:action', 'done'),
    hide: () => coach.current && runCommands(coach.skip(Date.now())),
  };
  for (const [id, hotkey] of Object.entries(HOTKEYS)) {
    let ok = false;
    try {
      ok = globalShortcut.register(hotkey.accelerator, actions[id]);
    } catch {
      ok = false;
    }
    hotkeyStatus[id] = ok;
    if (!ok) logEvent(`Genvejstasten ${hotkeyLabel(id)} kunne ikke bruges – et andet program har den måske`);
  }
}

// --- Opsætning ---------------------------------------------------------------------

function openSetup() {
  if (setupWindow) {
    if (setupWindow.isMinimized()) setupWindow.restore();
    setupWindow.show();
    setupWindow.focus();
    return;
  }
  setupWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 860,
    minHeight: 640,
    show: false,
    title: 'Workoutslop – opsætning',
    icon: APP_ICON,
    backgroundColor: '#0d1017',
    autoHideMenuBar: true,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  setupWindow.removeMenu();
  lockDownNavigation(setupWindow);
  setupWindow.once('ready-to-show', () => setupWindow.show());
  setupWindow.on('closed', () => {
    setupWindow = null;
  });
  setupWindow.loadFile(path.join(RENDERER, 'setup', 'index.html'));
}

function levelExamples() {
  const pushup = EXERCISES.find((e) => e.id === 'pushup');
  const squat = EXERCISES.find((e) => e.id === 'squat');
  return Object.fromEntries(
    LEVELS.map((l) => [l.id, `fx ${pushup.amounts[l.id - 1]} armbøjninger · ${squat.amounts[l.id - 1]} squats`]),
  );
}

function integrationStatuses() {
  return Object.fromEntries(
    Object.keys(INTEGRATIONS).map((id) => [id, integrationStatus(id, settings.integrationFiles[id])]),
  );
}

function setupData() {
  return {
    firstRun: !settings.setupComplete,
    version: app.getVersion(),
    update: updatePayload(),
    platform: process.platform,
    settings: pick(settings, EDITABLE_KEYS),
    catalog: {
      levels: LEVELS,
      equipment: EQUIPMENT,
      frequencies: FREQUENCIES,
      levelExamples: levelExamples(),
      focusAreas: FOCUS_AREAS.map(({ id, name, description, groups }) => ({ id, name, description, groups })),
      muscleGroups: Object.entries(MUSCLE_GROUPS).map(([id, name]) => ({ id, name })),
      maxCustomDays: MAX_CUSTOM_DAYS,
      games: KNOWN_GAMES.map((g) => ({
        name: g.name,
        precise: Boolean(g.integration || g.matchProcesses),
      })),
      integrations: Object.values(INTEGRATIONS).map((i) => ({ id: i.id, name: i.name, note: i.note })),
    },
    integrations: integrationStatuses(),
    native: windowsNative.capabilities(),
    games: { autoGames: settings.autoGames, gameSuggestions: settings.gameSuggestions },
    gsiError,
    hotkeys: Object.keys(HOTKEYS).map((id) => ({
      id,
      label: hotkeyLabel(id),
      description: HOTKEYS[id].description,
      registered: hotkeyStatus[id] !== false,
    })),
  };
}

function draftSettings(draft) {
  return normalizeSettings({ ...settings, ...pick(draft, EDITABLE_KEYS) });
}

function applyLoginItem() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  // Under udvikling (npm start) skal Electron have stien til appen med.
  // --hidden: start stille i baggrunden, når computeren tænder.
  const args = [...(app.isPackaged ? [] : [app.getAppPath()]), '--hidden'];
  app.setLoginItemSettings({ openAtLogin: settings.openAtLogin, args });
}

function fromWindow(win) {
  return (event) => win && event.sender === win.webContents;
}

function registerIpc() {
  const fromSetup = (event) => fromWindow(setupWindow)(event);
  const fromOverlay = (event) => fromWindow(overlayWindow)(event);

  ipcMain.handle('setup:get', (event) => (fromSetup(event) ? setupData() : null));

  // Antal øvelser der passer til udkastet – i alt og for hvert fokusområde.
  ipcMain.handle('setup:count', (event, draft) => {
    if (!fromSetup(event)) return null;
    const draftValues = draftSettings(draft);
    const count = (focus) => engine.availableExercises(EXERCISES, { ...draftValues, focus }).length;
    const byGroup = {};
    for (const ex of engine.availableExercises(EXERCISES, { ...draftValues, focus: [] })) {
      byGroup[ex.muscleGroup] = (byGroup[ex.muscleGroup] || 0) + 1;
    }
    return {
      total: count(draftValues.focus),
      wholeBody: count([]),
      byFocus: Object.fromEntries(
        engine.allFocusAreas(draftValues.customDays).map((area) => [area.id, count([area.id])]),
      ),
      byGroup, // til "Lav din egen dag": antal øvelser pr. muskelgruppe
    };
  });

  // Øvelser og sæt pr. muskelgruppe for udkastet (trinnet "Øvelser og sæt").
  ipcMain.handle('setup:plan', (event, draft) => {
    if (!fromSetup(event)) return null;
    const draftValues = draftSettings(draft);
    // Alle muskelgrupper vises – med de øvelser, der passer til udstyr og niveau (også de fravalgte).
    // Grupperne i det valgte fokus markeres og kommer først.
    const candidates = engine.availableExercises(EXERCISES, {
      ...draftValues,
      focus: [],
      disabledExercises: [],
      setsPerDay: null,
    });
    const inFocus = engine.focusGroups(draftValues.focus, draftValues.customDays);
    const groups = Object.keys(MUSCLE_GROUPS)
      .map((group) => ({
        id: group,
        name: MUSCLE_GROUPS[group],
        inFocus: !inFocus || inFocus.has(group),
        sets: draftValues.setsPerDay[group],
        exercises: candidates
          .filter((ex) => ex.muscleGroup === group)
          .map((ex) => {
            const { amount } = engine.computeAmount(ex, draftValues.level, null);
            return {
              id: ex.id,
              name: ex.name,
              amount: engine.describeAmount(ex, amount),
              enabled: !draftValues.disabledExercises.includes(ex.id),
              animation: ex.animation,
              steps: ex.steps,
              difficulty: ex.difficulty,
            };
          }),
      }))
      .filter((group) => group.exercises.length > 0)
      .sort((a, b) => Number(b.inFocus) - Number(a.inFocus));
    return { groups, wholeBody: !inFocus, maxSets: MAX_SETS_PER_DAY };
  });

  ipcMain.handle('setup:processes', async (event) => {
    if (!fromSetup(event)) return [];
    return selectableProcesses((await listProcesses()).map((p) => p.name));
  });

  ipcMain.handle('setup:install-integration', async (event, id) => {
    if (!fromSetup(event) || !INTEGRATIONS[id]) return { ok: false, reason: 'unknown' };
    const integration = INTEGRATIONS[id];
    const options = { port: settings.gsiPort, token: settings.gsiToken };
    let result = installIntegration(id, options);
    if (!result.ok && result.reason === 'not-found') {
      const choice = await dialog.showOpenDialog(setupWindow, {
        title: `Vælg mappen, hvor ${integration.name} er installeret`,
        buttonLabel: 'Vælg mappe',
        properties: ['openDirectory'],
      });
      if (choice.canceled || !choice.filePaths[0]) return { ok: false, reason: 'canceled' };
      result = installIntegration(id, { ...options, gameFolder: choice.filePaths[0] });
    }
    if (result.ok) {
      settings = store.saveSettings({
        ...settings,
        integrationFiles: { ...settings.integrationFiles, [id]: result.file },
      });
    }
    return { ...result, note: integration.note, status: integrationStatus(id, settings.integrationFiles[id]) };
  });

  ipcMain.handle('setup:preview', (event, draft) => {
    if (!fromSetup(event)) return { ok: false };
    if (coach.current && coach.current.trigger !== 'preview') return { ok: false, reason: 'busy' };
    const override = draftSettings(draft);
    const now = Date.now();
    const suggestion = engine.createSuggestion({
      exercises: EXERCISES,
      settings: override,
      history: store.history,
      now,
      ignoreTargets: true,
    });
    runCommands(coach.present(now, suggestion, 'preview', null, override));
    return { ok: Boolean(suggestion) };
  });

  ipcMain.handle('setup:save', (event, draft) => {
    if (!fromSetup(event)) return { ok: false };
    const wasFirstRun = !settings.setupComplete;
    settings = store.saveSettings({ ...draftSettings(draft), setupComplete: true });
    applyLoginItem();
    scanProcesses();
    positionOverlay();
    refreshTray(true);
    if (wasFirstRun && Notification.isSupported()) {
      new Notification({
        title: 'Workoutslop kører nu',
        body:
          process.platform === 'win32'
            ? 'Start et spil – så foreslår jeg øvelser i pauserne. Du finder mig ved uret (klik på ^, hvis ikonet er skjult).'
            : 'Start et spil – så foreslår jeg øvelser i pauserne. Du finder mig i systembakken.',
        icon: APP_ICON,
      }).show();
    }
    return { ok: true };
  });

  ipcMain.on('setup:close', (event) => fromSetup(event) && setupWindow?.close());
  ipcMain.on('updates:check', (event) => fromSetup(event) && updater.check());

  // Oversigten
  ipcMain.handle('app:status', (event) => (fromSetup(event) ? overviewStatus() : null));
  ipcMain.on('app:exercise-now', (event) => fromSetup(event) && runCommands(coach.requestNow(Date.now())));
  ipcMain.on('app:pause', (event, minutes) => {
    if (fromSetup(event) && Number.isFinite(minutes)) pauseExercises(Date.now() + minutes * 60000);
  });
  ipcMain.on('app:resume', (event) => {
    if (!fromSetup(event)) return;
    coach.resume();
    refreshTray(true);
  });

  // Fundne og foreslåede spil: tilføj, afvis eller fjern.
  ipcMain.handle('games:update', (event, { action, process: processName } = {}) => {
    if (!fromSetup(event)) return null;
    const key = normalizeProcessName(processName || '');
    const same = (g) => normalizeProcessName(g.process) === key;
    const suggestion = settings.gameSuggestions.find(same);
    let next = { ...settings };
    if (action === 'accept' && suggestion) {
      next.autoGames = [...settings.autoGames, suggestion];
      next.gameSuggestions = settings.gameSuggestions.filter((g) => !same(g));
    } else if (action === 'ignore' || action === 'remove') {
      next.autoGames = settings.autoGames.filter((g) => !same(g));
      next.gameSuggestions = settings.gameSuggestions.filter((g) => !same(g));
      next.ignoredGames = [...settings.ignoredGames, key];
    }
    settings = store.saveSettings(next);
    scanProcesses();
    return { autoGames: settings.autoGames, gameSuggestions: settings.gameSuggestions };
  });
  ipcMain.on('updates:install', (event) => fromSetup(event) && updater.install());
  ipcMain.handle('debug:status', (event) => {
    if (!fromSetup(event)) return null;
    const now = Date.now();
    return {
      sections: debugSections(now),
      log: events.list().map((e) => ({ time: formatTime(e.at), text: e.text, count: e.count })),
    };
  });
  ipcMain.handle('debug:copy', (event) => {
    if (!fromSetup(event)) return false;
    clipboard.writeText(debugReport(Date.now()));
    return true;
  });

  ipcMain.on('overlay:size', (event, height) => {
    if (!fromOverlay(event) || !Number.isFinite(height)) return;
    overlayHeight = Math.max(80, Math.min(1000, height));
    if (overlayShowPending) revealOverlay();
    else if (overlayWindow?.isVisible()) positionOverlay();
  });
  ipcMain.on('overlay:complete', (event) => fromOverlay(event) && runCommands(coach.complete(Date.now())));
  ipcMain.on('overlay:skip', (event) => fromOverlay(event) && runCommands(coach.skip(Date.now())));
  ipcMain.on('overlay:reroll', (event) => fromOverlay(event) && runCommands(coach.reroll(Date.now())));
  ipcMain.on('overlay:easier', (event) => fromOverlay(event) && runCommands(coach.easier(Date.now())));
  ipcMain.on('overlay:snooze', (event) => fromOverlay(event) && runCommands(coach.snooze(Date.now(), SNOOZE_MINUTES)));
  ipcMain.on('overlay:expand', (event) => fromOverlay(event) && runCommands(coach.expand()));
}

// Vinduerne viser kun vores egne sider – ingen navigation eller pop-ups.
function lockDownNavigation(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
}

// --- Opstart ----------------------------------------------------------------------

// En lille fil fortæller den nye version, at den blev startet af en opdatering.
const updateMarkerPath = () => path.join(app.getPath('userData'), 'just-updated.json');

function markUpdating(version) {
  try {
    fs.writeFileSync(updateMarkerPath(), JSON.stringify({ version, at: Date.now() }));
  } catch {
    // Ikke vigtigt nok til at stoppe opdateringen.
  }
}

function readUpdateMarker() {
  try {
    const marker = JSON.parse(fs.readFileSync(updateMarkerPath(), 'utf8'));
    fs.unlinkSync(updateMarkerPath());
    return Date.now() - marker.at < 15 * 60 * 1000;
  } catch {
    return false;
  }
}

function start() {
  if (process.platform === 'win32') app.setAppUserModelId('dk.workoutslop.app');

  store = createStore(app.getPath('userData'));
  settings = store.settings;
  if (!settings.gsiToken)
    settings = store.saveSettings({ ...settings, gsiToken: crypto.randomBytes(16).toString('hex') });
  // Ældre versioner kunne tilføje værktøjer som Wallpaper Engine som spil.
  const realGames = settings.autoGames.filter((g) => !isKnownNonGame(g));
  if (realGames.length !== settings.autoGames.length)
    settings = store.saveSettings({ ...settings, autoGames: realGames });
  coach.lastCompletedAt = engine.lastCompletedAt(store.history);
  updater = createUpdater({ onChange: onUpdateStatus, beforeInstall: markUpdating });
  const justUpdated = readUpdateMarker();
  logEvent(
    `Workoutslop ${app.getVersion()} startet${justUpdated ? ' efter en opdatering' : ''} ` +
      `(${process.platform} ${os.release()})`,
  );

  registerIpc();
  createOverlayWindow();
  createTray();
  registerHotkeys();
  startGsi();
  applyLoginItem();
  updater.start();
  // Efter dvale: tjek for opdateringer med det samme.
  powerMonitor.on('resume', () => updater.check());
  scanProcesses();
  startGamepadPolling();
  setInterval(tick, TICK_MS);

  // Starter man selv appen (fx fra startmenuen), vises vinduet, så man kan se, at den kører.
  // Ved automatisk start sammen med computeren kører den bare stille i baggrunden.
  // Efter en automatisk opdatering starter appen også stille.
  const startedAtLogin = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin;
  if (!settings.setupComplete || !(startedAtLogin || justUpdated)) openSetup();
  if (justUpdated && Notification.isSupported()) {
    new Notification({
      title: `Workoutslop er opdateret til ${app.getVersion()}`,
      body: 'Den nye version kører allerede i baggrunden.',
      icon: APP_ICON,
    }).show();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openSetup());
  app.on('window-all-closed', () => {
    // Bliv kørende i systembakken, selv om opsætningen lukkes.
  });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    gsiServer?.close();
  });
  app.whenReady().then(start);
}
