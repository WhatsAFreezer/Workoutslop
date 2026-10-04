'use strict';

// Hovedprocessen: holder styr på vinduer, bakkeikon, genvejstaster og
// "løkken" der hvert sekund tjekker, om brugeren holder pause i et spil.

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
const { KNOWN_GAMES, customGamesToDefinitions, detectGame, selectableProcesses } = require('../core/games');
const { INTEGRATIONS, parseGsiPayload } = require('../core/gsi');
const { normalizeSettings } = require('../core/settings');
const { PauseDetector } = require('../core/pause-detector');
const { Coach } = require('../core/coach');
const { todaySummary, describeToday } = require('../core/stats');
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
let hotkeyStatus = {};
let trayKey = '';
let updater = null;
let notifiedUpdateVersion = null;

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
  return [...customGamesToDefinitions(settings.customGames), ...KNOWN_GAMES];
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

  // Windows tæller ikke controller-input som aktivitet, så vi bruger det korteste af de to.
  const idleSeconds = Math.min(powerMonitor.getSystemIdleTime(), gamepads.idleSeconds(now));
  const game = detected?.game ?? null;
  lastPause = pauseDetector.update({
    now,
    game,
    phase: detected?.phase ?? null,
    integration: currentIntegration(game, now),
    idleSeconds,
    useIdle: settings.useIdleDetection,
    idleThreshold: settings.idleSeconds,
  });

  runCommands(coach.tick({ now, pause: lastPause, idleSeconds, settings }));
  refreshTray();
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

function positionOverlay() {
  if (!overlayWindow) return;
  const area = screen.getPrimaryDisplay().workArea;
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
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
}

function hideOverlay() {
  overlayShowPending = false;
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

// Læs øvelsen højt, hvis brugeren vil – eller hvis spillet kører i eksklusiv fuldskærm,
// hvor overlayet ikke kan ses.
function shouldSpeak(current) {
  const mode = (current.settingsOverride || settings).speak;
  if (mode === 'always') return true;
  if (mode === 'never' || current.trigger === 'preview') return false;
  return windowsNative.isExclusiveFullscreen() === true;
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
    setupWindow?.close();
    return { ok: true };
  });

  ipcMain.on('setup:close', (event) => fromSetup(event) && setupWindow?.close());
  ipcMain.on('updates:check', (event) => fromSetup(event) && updater.check());
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

function start() {
  if (process.platform === 'win32') app.setAppUserModelId('dk.workoutslop.app');

  store = createStore(app.getPath('userData'));
  settings = store.settings;
  if (!settings.gsiToken)
    settings = store.saveSettings({ ...settings, gsiToken: crypto.randomBytes(16).toString('hex') });
  coach.lastCompletedAt = engine.lastCompletedAt(store.history);
  updater = createUpdater({ onChange: onUpdateStatus });

  registerIpc();
  createOverlayWindow();
  createTray();
  registerHotkeys();
  startGsi();
  applyLoginItem();
  updater.start();
  scanProcesses();
  startGamepadPolling();
  setInterval(tick, TICK_MS);

  // Starter man selv appen (fx fra startmenuen), vises vinduet, så man kan se, at den kører.
  // Ved automatisk start sammen med computeren kører den bare stille i baggrunden.
  const startedAtLogin = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin;
  if (!settings.setupComplete || !startedAtLogin) openSetup();
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
