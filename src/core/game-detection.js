'use strict';

// Genkender spil, som Workoutslop ikke kender på forhånd, ud fra det program
// der er i forgrunden:
//
//  - Programmer installeret i en spilbutiks bibliotek (Steam, Epic, Riot, Xbox,
//    GOG, Ubisoft, EA, Rockstar) er spil. De tilføjes automatisk.
//  - Programmer i eksklusiv fuldskærm er spil (det bruger næsten kun spil).
//  - Programmer der fylder skærmen i et stykke tid, mens man hele tiden bruger
//    mus, tastatur eller controller, er spil. Fylder et program skærmen, uden at
//    man rører noget (fx en film), bliver det kun foreslået i opsætningen.

const { normalizeProcessName } = require('./games');

// [regulært udtryk for mappen, hvor spillets navn er første gruppe]
const LIBRARY_PATTERNS = [
  /[\\/]steamapps[\\/]common[\\/]([^\\/]+)[\\/]/i,
  /[\\/]Epic Games[\\/](?!Launcher[\\/])([^\\/]+)[\\/]/i,
  /[\\/]Riot Games[\\/](?!Riot Client[\\/])([^\\/]+)[\\/]/i,
  /[\\/]XboxGames[\\/]([^\\/]+)[\\/]/i,
  /[\\/]GOG Games[\\/]([^\\/]+)[\\/]/i,
  /[\\/]GOG Galaxy[\\/]Games[\\/]([^\\/]+)[\\/]/i,
  /[\\/]Ubisoft Game Launcher[\\/]games[\\/]([^\\/]+)[\\/]/i,
  /[\\/]EA Games[\\/]([^\\/]+)[\\/]/i,
  /[\\/]Rockstar Games[\\/](?!Launcher[\\/])([^\\/]+)[\\/]/i,
];

// Hjælpeprogrammer der ligger sammen med spil, men ikke er selve spillet.
const HELPER_PATTERN =
  /crash|report|anticheat|anti-cheat|easyanticheat|battleye|beservice|setup|unins|redist|helper|updater|launcher|vc_redist|dxsetup|overlay/i;

// Programmer der ofte kører i fuld skærm uden at være spil.
const NOT_GAMES = new Set(
  [
    'chrome',
    'msedge',
    'firefox',
    'opera',
    'opera_gx',
    'brave',
    'vivaldi',
    'iexplore',
    'arc',
    'vlc',
    'mpc-hc',
    'mpc-hc64',
    'mpc-be64',
    'potplayermini64',
    'wmplayer',
    'video.ui',
    'microsoft.media.player',
    'spotify',
    'netflix',
    'discord',
    'teams',
    'ms-teams',
    'zoom',
    'slack',
    'obs64',
    'obs32',
    'powerpnt',
    'winword',
    'excel',
    'onenote',
    'outlook',
    'acrord32',
    'acrobat',
    'explorer',
    'applicationframehost',
    'searchhost',
    'startmenuexperiencehost',
    'shellexperiencehost',
    'lockapp',
    'textinputhost',
    'gamebar',
    'steam',
    'steamwebhelper',
    'epicgameslauncher',
    'riotclientux',
    'battle.net',
    'electron',
    'code',
    'devenv',
    'workoutslop',
    // Flere programmer, der kan køre i fuld skærm, mens man bruger tastatur og mus.
    'chromium',
    'zen',
    'floorp',
    'librewolf',
    'waterfox',
    'thorium',
    'msedgewebview2',
    'mpv',
    'kodi',
    'plex',
    'plex htpc',
    'stremio',
    'photos',
    'microsoft.photos',
    'windowsterminal',
    'wt',
    'cmd',
    'powershell',
    'pwsh',
    'mstsc',
    'msrdc',
    'vmware',
    'vmware-vmx',
    'virtualboxvm',
    'vmconnect',
    'anydesk',
    'teamviewer',
    'rustdesk',
    'idea64',
    'pycharm64',
    'webstorm64',
    'rider64',
    'clion64',
    'goland64',
    'phpstorm64',
    'studio64',
    'cursor',
    'windsurf',
    'zed',
    'sublime_text',
    'notepad',
    'notepad++',
    'obsidian',
    'notion',
    'figma',
    'photoshop',
    'illustrator',
    'afterfx',
    'adobe premiere pro',
    'resolve',
    'unity',
    'unrealeditor',
    'whatsapp',
    'telegram',
    'signal',
    'thunderbird',
    'chatgpt',
    'claude',
    'taskmgr',
    'snippingtool',
    'screenclippinghost',
    // Spilbutikker og launchere er ikke selv spil.
    'xboxpcapp',
    'xboxapp',
    'overwolf',
    'playnite.fullscreenapp',
    'playnite.desktopapp',
    'eadesktop',
    'upc',
    'ubisoftconnect',
    'galaxyclient',
    'riotclientservices',
    'amazon games ui',
    // Programmer fra Steam, der ikke er spil – og ofte kører i baggrunden hele tiden.
    'wallpaper32',
    'wallpaper64',
    'webwallpaper32',
    'losslessscaling',
    'vrserver',
    'vrmonitor',
    'vrcompositor',
    'vrdashboard',
    'vrwebhelper',
    'vrstartup',
    'soundpad',
    'bongocat',
    'vtube studio',
    'blender',
    'aseprite',
    'krita',
  ].map((n) => n.toLowerCase()),
);

// Mapper i et spilbibliotek, der indeholder værktøjer i stedet for spil
// (sammenlignet uden mellemrum, bindestreger og understreger).
const NOT_GAME_FOLDERS = new Set([
  'wallpaperengine',
  'losslessscaling',
  'steamvr',
  'soundpad',
  'vtubestudio',
  'obsstudio',
  'steamworksshared',
  'blender',
  'aseprite',
  'krita',
  'bongocat',
  'banana',
  'desktopmate',
  'fpsvr',
  'ovrtoolkit',
  'ovradvancedsettings',
  'xsoverlay',
  'voicemod',
]);

const folderKey = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

const basename = (path) => String(path).split(/[\\/]/).pop();

function prettyName(raw) {
  return raw.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function isNotGame(path) {
  return NOT_GAMES.has(normalizeProcessName(basename(path)));
}

// Et automatisk fundet spil ({ name, process }), som vi ved ikke er et spil –
// fx Wallpaper Engine, der også ligger i Steam-biblioteket.
function isKnownNonGame(game) {
  return isNotGame(game.process) || NOT_GAME_FOLDERS.has(folderKey(game.name));
}

// Et spil fra et spilbibliotek: { name, process } – ellers null.
function gameFromPath(path) {
  if (!path) return null;
  const exe = basename(path);
  if (HELPER_PATTERN.test(exe)) return null;
  for (const pattern of LIBRARY_PATTERNS) {
    const match = pattern.exec(path);
    if (!match) continue;
    const game = { name: prettyName(match[1]), process: exe };
    return isKnownNonGame(game) ? null : game;
  }
  return null;
}

// Under så mange sekunder siden sidste input (mus, tastatur, controller) er brugeren aktiv.
const ACTIVE_IDLE_SECONDS = 2;
// Så mange sekunder i træk i eksklusiv fuldskærm, før programmet regnes som et spil.
const EXCLUSIVE_SECONDS = 3;

// Følger programmet i forgrunden over tid. update() kaldes hvert sekund og
// returnerer { added } eller { suggested }, når der er fundet noget nyt.
class GameFinder {
  // fullscreenSeconds: så længe skal et program fylde skærmen, før det vurderes.
  // activeShare: så stor en del af tiden skal brugeren have været aktiv, for at
  // det regnes som et spil. En film ser man uden at røre mus og tastatur.
  constructor({ fullscreenSeconds = 20, activeShare = 0.6 } = {}) {
    this.fullscreenSeconds = fullscreenSeconds;
    this.activeShare = activeShare;
    this.watching = new Map(); // procesnavn -> { since, samples, active, exclusive }
  }

  // known(processName) skal returnere true for spil, der allerede er kendt,
  // tilføjet eller afvist. idleSeconds: sekunder siden sidste input.
  // exclusive: kører forgrundsprogrammet i eksklusiv fuldskærm?
  update(foreground, now, known, { idleSeconds = Infinity, exclusive = false } = {}) {
    if (!foreground?.path) return null;
    const exe = basename(foreground.path);
    const key = normalizeProcessName(exe);
    if (known(exe)) {
      this.watching.delete(key);
      return null;
    }

    const libraryGame = gameFromPath(foreground.path);
    if (libraryGame) return { added: libraryGame };

    // Værktøjer fra et spilbibliotek (fx Wallpaper Engine) tæller heller ikke.
    const inLibrary = LIBRARY_PATTERNS.some((pattern) => pattern.test(foreground.path));
    if (inLibrary || !foreground.coversMonitor || isNotGame(foreground.path) || HELPER_PATTERN.test(exe)) {
      this.watching.delete(key);
      return null;
    }

    let w = this.watching.get(key);
    if (!w) {
      w = { since: now, samples: 0, active: 0, exclusive: 0 };
      this.watching.set(key, w);
    }
    w.samples++;
    if (idleSeconds < ACTIVE_IDLE_SECONDS) w.active++;
    w.exclusive = exclusive ? w.exclusive + 1 : 0;

    const game = { name: prettyName(exe.replace(/\.exe$/i, '')), process: exe };
    if (w.exclusive >= EXCLUSIVE_SECONDS) {
      this.watching.delete(key);
      return { added: game };
    }
    if (now - w.since < this.fullscreenSeconds * 1000) return null;
    this.watching.delete(key);
    return w.active / w.samples >= this.activeShare ? { added: game } : { suggested: game };
  }
}

// --- Navne, når man selv vælger et program -------------------------------------------

// Mapper, der ikke siger noget om, hvilket spil det er (fx "...\Overwatch\_retail_\Overwatch.exe").
const GENERIC_FOLDERS = new Set(
  [
    'bin',
    'bin32',
    'bin64',
    'binaries',
    'win32',
    'win64',
    'windows',
    'x64',
    'x86',
    'game',
    'games',
    'retail',
    '_retail_',
    '_classic_',
    'ship',
    'shipping',
    'release',
    'client',
    'app',
    'current',
    'runtime',
    'jre',
    'java',
    'data',
    'common',
    'steamapps',
    'program files',
    'program files (x86)',
    'programdata',
    'appdata',
    'local',
    'roaming',
    'users',
  ].map(folderKey),
);

const tidy = (text) => String(text).replace(/\s+/g, ' ').trim();

// Vinduets titel uden versionsnummer og undertitel: "Minecraft 1.21.1 - Multiplayer" -> "Minecraft".
function cleanTitle(title) {
  let t = tidy(title || '');
  t = t.split(/\s[-–—|]\s/)[0];
  t = t.replace(/\s+v?\d+(\.\d+)+\S*$/i, '').replace(/\s+\((?:64|32)-bit\)$/i, '');
  return tidy(t).slice(0, 60);
}

// Første mappe over programmet, der ikke er en generisk mappe som "bin" eller "Win64".
function folderName(path) {
  const parts = String(path || '')
    .split(/[\\/]/)
    .filter(Boolean);
  parts.pop(); // selve .exe-filen
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (/^[a-z]:$/i.test(part) || GENERIC_FOLDERS.has(folderKey(part))) continue;
    return prettyName(part);
  }
  return null;
}

// Det navn, man kan genkende et program på: vinduets titel, ellers mappens navn, ellers filnavnet.
function programDisplayName({ process: exe, path, title }) {
  const fileName = basename(exe || path || '');
  const plain = prettyName(fileName.replace(/\.exe$/i, ''));
  const fromTitle = cleanTitle(title);
  if (fromTitle && fromTitle.length >= 2 && fromTitle.toLowerCase() !== fileName.toLowerCase()) return fromTitle;
  return folderName(path) || plain;
}

// Er programmet sandsynligvis et spil? Bruges til at sortere listen, når man selv vælger.
function looksLikeGame(path) {
  if (!path) return false;
  return Boolean(gameFromPath(path)) || /[\\/](games?|spil)[\\/]/i.test(path);
}

// Er spillet i forgrunden? true/false – eller null, hvis det ikke kan afgøres.
function isGameFocused(game, foreground) {
  if (!game || !foreground?.path) return null;
  const exe = normalizeProcessName(basename(foreground.path));
  return game.processes.some((p) => normalizeProcessName(p) === exe);
}

module.exports = {
  gameFromPath,
  isNotGame,
  isKnownNonGame,
  GameFinder,
  isGameFocused,
  programDisplayName,
  looksLikeGame,
};
