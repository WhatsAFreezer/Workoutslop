'use strict';

// Automatiske opdateringer: appen tjekker GitHub Releases for en nyere version,
// henter den i baggrunden og installerer den, når appen lukkes – eller med det
// samme, hvis brugeren vælger "Genstart og opdatér".

const { app } = require('electron');

const FIRST_CHECK_DELAY_MS = 15 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function friendlyError(err) {
  const message = String(err?.message || err || '');
  if (/\b404\b|Not Found|No published versions|Cannot find latest/i.test(message)) {
    return 'Der er ikke udgivet nogen version endnu (eller GitHub-repoet er privat).';
  }
  if (
    /ENOTFOUND|ENETUNREACH|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION/i.test(
      message,
    )
  ) {
    return 'Ingen forbindelse til internettet.';
  }
  if (/ERR_CERT|certificate/i.test(message)) return 'Kunne ikke oprette en sikker forbindelse til GitHub.';
  return message.split('\n')[0].slice(0, 160) || 'Ukendt fejl.';
}

// status.state: 'dev' | 'idle' | 'checking' | 'latest' | 'downloading' | 'ready' | 'error'
function createUpdater({ onChange }) {
  let status = { state: app.isPackaged ? 'idle' : 'dev', currentVersion: app.getVersion() };
  const set = (patch) => {
    status = { ...status, ...patch };
    onChange(status);
  };

  // Under udvikling (npm start) er der intet installeret program at opdatere.
  if (!app.isPackaged) {
    return { status: () => status, start() {}, check() {}, install() {} };
  }

  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  // Til test: hent opdateringer fra en lokal server i stedet for GitHub.
  if (process.env.WORKOUTSLOP_UPDATE_URL) {
    autoUpdater.setFeedURL({ provider: 'generic', url: process.env.WORKOUTSLOP_UPDATE_URL });
  }

  autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => set({ state: 'latest', checkedAt: Date.now() }));
  autoUpdater.on('download-progress', (progress) =>
    set({ state: 'downloading', percent: Math.round(progress.percent) }),
  );
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => {
    // En hentet opdatering er stadig klar, selv om et senere tjek fejler.
    if (status.state !== 'ready') set({ state: 'error', error: friendlyError(err), checkedAt: Date.now() });
  });

  function check() {
    if (['checking', 'downloading', 'ready'].includes(status.state)) return;
    // Fejl kommer også som 'error'-event, så promise-fejlen kan ignoreres her.
    autoUpdater.checkForUpdates().catch(() => {});
  }

  return {
    status: () => status,
    start() {
      setTimeout(check, FIRST_CHECK_DELAY_MS);
      setInterval(check, CHECK_INTERVAL_MS);
    },
    check,
    install() {
      // Stille installation, og appen starter selv igen bagefter.
      if (status.state === 'ready') autoUpdater.quitAndInstall(true, true);
    },
  };
}

// Kort tekst til bakkemenu og opsætning.
function describeUpdate(status) {
  switch (status.state) {
    case 'dev':
      return 'Opdateringer virker kun i den installerede app';
    case 'checking':
      return 'Søger efter opdateringer…';
    case 'latest':
      return 'Du har den nyeste version';
    case 'downloading':
      return `Henter version ${status.version}… ${status.percent ?? 0} %`;
    case 'ready':
      return `Version ${status.version} er klar til at blive installeret`;
    case 'error':
      return `Kunne ikke søge efter opdateringer: ${status.error}`;
    default:
      return '';
  }
}

module.exports = { createUpdater, describeUpdate, friendlyError };
