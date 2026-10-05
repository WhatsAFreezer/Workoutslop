'use strict';

// Genkender spil, som Workoutslop ikke kender på forhånd, ud fra det program
// der er i forgrunden:
//
//  - Programmer installeret i en spilbutiks bibliotek (Steam, Epic, Riot, Xbox,
//    GOG, Ubisoft, EA, Rockstar) er spil. De tilføjes automatisk.
//  - Andre programmer der kører i fuld skærm i et stykke tid, er måske spil.
//    De bliver foreslået i opsætningen, så brugeren selv kan vælge.

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
  ].map((n) => n.toLowerCase()),
);

const basename = (path) => String(path).split(/[\\/]/).pop();

function prettyName(raw) {
  return raw.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Et spil fra et spilbibliotek: { name, process } – ellers null.
function gameFromPath(path) {
  if (!path) return null;
  const exe = basename(path);
  if (HELPER_PATTERN.test(exe)) return null;
  for (const pattern of LIBRARY_PATTERNS) {
    const match = pattern.exec(path);
    if (match) return { name: prettyName(match[1]), process: exe };
  }
  return null;
}

function isNotGame(path) {
  return NOT_GAMES.has(normalizeProcessName(basename(path)));
}

// Følger programmet i forgrunden over tid. update() kaldes hvert sekund og
// returnerer { added, suggested } når der er fundet noget nyt.
class GameFinder {
  constructor({ fullscreenSeconds = 20 } = {}) {
    this.fullscreenSeconds = fullscreenSeconds;
    this.fullscreenSince = new Map(); // procesnavn -> tidspunkt
  }

  // known(processName) skal returnere true for spil, der allerede er kendt,
  // tilføjet, foreslået eller ignoreret.
  update(foreground, now, known) {
    if (!foreground?.path) return null;
    const exe = basename(foreground.path);
    const key = normalizeProcessName(exe);
    if (known(exe)) {
      this.fullscreenSince.delete(key);
      return null;
    }

    const libraryGame = gameFromPath(foreground.path);
    if (libraryGame) return { added: libraryGame };

    if (!foreground.coversMonitor || isNotGame(foreground.path) || HELPER_PATTERN.test(exe)) {
      this.fullscreenSince.delete(key);
      return null;
    }
    if (!this.fullscreenSince.has(key)) this.fullscreenSince.set(key, now);
    if (now - this.fullscreenSince.get(key) >= this.fullscreenSeconds * 1000) {
      this.fullscreenSince.delete(key);
      return { suggested: { name: prettyName(exe.replace(/\.exe$/i, '')), process: exe } };
    }
    return null;
  }
}

// Er spillet i forgrunden? true/false – eller null, hvis det ikke kan afgøres.
function isGameFocused(game, foreground) {
  if (!game || !foreground?.path) return null;
  const exe = normalizeProcessName(basename(foreground.path));
  return game.processes.some((p) => normalizeProcessName(p) === exe);
}

module.exports = { LIBRARY_PATTERNS, gameFromPath, isNotGame, GameFinder, isGameFocused };
