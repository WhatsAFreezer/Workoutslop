'use strict';

// Hovedprocessen: holder styr på vinduer, bakkeikon, genvejstaster og
// "løkken" der hvert sekund tjekker, om brugeren holder pause i et spil.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
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
  detectGame,
  selectableProcesses,
  normalizeProcessName,
} = require('../core/games');
const { GameFinder, isGameFocused } = require('../core/game-detection');
const { INTEGRATIONS, parseGsiPayload } = require('../core/gsi');
const { normalizeSettings } = require('../core/settings');
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

// Er programmet allerede kendt, tilføjet, foreslået eller afvist?
function isKnownProcess(exe) {
  const key = normalizeProcessName(exe);
  const lists = [settings.customGames, settings.autoGames, settings.gameSuggestions];
  return (
    settings.ignoredGames.includes(key) ||
    lists.some((list) => list.some((g) => normalizeProcessName(g.process) === key)) ||
    KNOWN_GAMES.some((g) => g.processes.some((p) => normalizeProcessName(p) === key))
  );
}

// Hvert sekund: hvilket program er i forgrunden? Bruges til at finde nye spil,
// opdage alt-tab ud af spillet og placere overlayet på spillets skærm.
function trackForeground(now) {
  const fg = windowsNative.foregroundWindow();
  // Vores eget overlay/vindue i forgrunden ændrer ikke på, hvad spillet gør.
  if (!fg || fg.pid === process.pid) return;
  focus.foreground = fg;

  const found = gameFinder.update(fg, now, isKnownProcess);
  if (found?.added) {
    settings = store.saveSettings({ ...settings, autoGames: [...settings.autoGames, found.added] });
    scanProcesses();
  } else if (found?.suggested) {
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
    detected = detectGame(await listProcesses(), allGames());
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

  trackForeground(now);

  // Windows tæller ikke controller-input som aktivitet, så vi bruger det korteste af de to.
  const idleSeconds = Math.min(powerMonitor.getSystemIdleTime(), gamepads.idleSeconds(now));
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
      if (parsed) gsiState = { ...parsed, at: Date.now() };
    },
    onError: (err) => {
      gsiError = err.code === 'EADDRINUSE' ? `Port ${settings.gsiPort} er allerede i brug.` : err.message;
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
  if (!overlayWindow.isVisible()) overlayWindow.showInactive(); // stjæl ikke fokus fra spillet
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
function runCommands(commands) {
  for (const cmd of commands) {
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
  const kind = definition?.custom ? 'tilføjet af dig' : definition?.auto ? 'fundet automatisk' : 'kendt spil';
  signals.push({ label: 'Spil', value: game ? `${game.name} (${kind})` : 'Intet spil kører' });
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
  refreshTray(true);
  setupWindow?.webContents.send('updates:status', updatePayload());
  if (status.state === 'ready' && notifiedUpdateVersion !== status.version && Notification.isSupported()) {
    notifiedUpdateVersion = status.version;
    const notification = new Notification({
      title: `Workoutslop ${status.version} er klar`,
      body: 'Opdateringen installeres, når du lukker appen. Klik her for at genstarte og opdatere nu.',
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
  return FOCUS_AREAS.filter((area) => focus.includes(area.id))
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
  return [
    { label: 'Hele kroppen', type: 'checkbox', checked: focus.length === 0, click: () => setFocus([]) },
    { type: 'separator' },
    ...FOCUS_AREAS.map((area) => ({
      label: area.name,
      type: 'checkbox',
      checked: focus.includes(area.id),
      click: () => setFocus(focus.includes(area.id) ? focus.filter((id) => id !== area.id) : [...focus, area.id]),
    })),
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
      focusAreas: FOCUS_AREAS.map(({ id, name, description }) => ({ id, name, description })),
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
    return {
      total: count(draftValues.focus),
      wholeBody: count([]),
      byFocus: Object.fromEntries(FOCUS_AREAS.map((area) => [area.id, count([area.id])])),
    };
  });

  // Øvelser og sæt pr. muskelgruppe for udkastet (trinnet "Øvelser og sæt").
  ipcMain.handle('setup:plan', (event, draft) => {
    if (!fromSetup(event)) return null;
    const draftValues = draftSettings(draft);
    // Alle øvelser der passer til udstyr, niveau og fokus – også de fravalgte.
    const candidates = engine.availableExercises(EXERCISES, {
      ...draftValues,
      disabledExercises: [],
      setsPerDay: null,
    });
    const groups = Object.keys(MUSCLE_GROUPS)
      .map((group) => ({
        id: group,
        name: MUSCLE_GROUPS[group],
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
            };
          }),
      }))
      .filter((group) => group.exercises.length > 0);
    return { groups, maxSets: MAX_SETS_PER_DAY };
  });

  ipcMain.handle('setup:processes', async (event) => {
    if (!fromSetup(event)) return [];
    return selectableProcesses(await listProcesses());
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

  ipcMain.on('overlay:size', (event, height) => {
    if (!fromOverlay(event) || !Number.isFinite(height)) return;
    overlayHeight = Math.max(80, Math.min(1000, height));
    if (overlayShowPending) revealOverlay();
    else if (overlayWindow?.isVisible()) positionOverlay();
  });
  ipcMain.on('overlay:complete', (event) => fromOverlay(event) && runCommands(coach.complete(Date.now())));
  ipcMain.on('overlay:skip', (event) => fromOverlay(event) && runCommands(coach.skip(Date.now())));
  ipcMain.on('overlay:reroll', (event) => fromOverlay(event) && runCommands(coach.reroll(Date.now())));
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
  coach.lastCompletedAt = engine.lastCompletedAt(store.history);
  updater = createUpdater({ onChange: onUpdateStatus, beforeInstall: markUpdating });
  const justUpdated = readUpdateMarker();

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
