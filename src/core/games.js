'use strict';

// Spil appen genkender automatisk ud fra deres procesnavn.
//
// processes:        hvis én af disse kører, er spillet åbent.
// matchProcesses:   (valgfri) processer der KUN kører under en kamp. Kører
//                   spillet uden dem, er man i lobbyen = pause.
// integration:      (valgfri) spillet kan selv fortælle appen, hvornår en kamp
//                   starter og slutter (Valve Game State Integration).
const KNOWN_GAMES = [
  { id: 'cs2', name: 'Counter-Strike 2', processes: ['cs2.exe'], integration: 'cs2' },
  { id: 'dota2', name: 'Dota 2', processes: ['dota2.exe'], integration: 'dota2' },
  {
    id: 'lol',
    name: 'League of Legends',
    processes: ['League of Legends.exe', 'LeagueClientUx.exe', 'LeagueClient.exe'],
    matchProcesses: ['League of Legends.exe'],
  },
  { id: 'valorant', name: 'Valorant', processes: ['VALORANT-Win64-Shipping.exe'] },
  { id: 'fortnite', name: 'Fortnite', processes: ['FortniteClient-Win64-Shipping.exe'] },
  { id: 'rocketleague', name: 'Rocket League', processes: ['RocketLeague.exe'] },
  { id: 'overwatch', name: 'Overwatch 2', processes: ['Overwatch.exe'] },
  { id: 'apex', name: 'Apex Legends', processes: ['r5apex.exe', 'r5apex_dx12.exe'] },
  { id: 'r6', name: 'Rainbow Six Siege', processes: ['RainbowSix.exe', 'RainbowSix_Vulkan.exe'] },
  { id: 'pubg', name: 'PUBG: Battlegrounds', processes: ['TslGame.exe'] },
  { id: 'cod', name: 'Call of Duty', processes: ['cod.exe', 'ModernWarfare.exe'] },
  { id: 'marvelrivals', name: 'Marvel Rivals', processes: ['Marvel-Win64-Shipping.exe'] },
  { id: 'eafc', name: 'EA Sports FC', processes: ['FC24.exe', 'FC25.exe', 'FC26.exe'] },
  { id: 'thefinals', name: 'The Finals', processes: ['Discovery.exe'] },
  { id: 'rust', name: 'Rust', processes: ['RustClient.exe'] },
  { id: 'helldivers2', name: 'Helldivers 2', processes: ['helldivers2.exe'] },
  { id: 'minecraft', name: 'Minecraft (Bedrock)', processes: ['Minecraft.Windows.exe'] },
  { id: 'roblox', name: 'Roblox', processes: ['RobloxPlayerBeta.exe'] },
  { id: 'gta5', name: 'GTA V', processes: ['GTA5.exe', 'GTA5_Enhanced.exe'] },
  { id: 'eldenring', name: 'Elden Ring', processes: ['eldenring.exe'] },
  { id: 'fallguys', name: 'Fall Guys', processes: ['FallGuys_client_game.exe'] },
  { id: 'hearthstone', name: 'Hearthstone', processes: ['Hearthstone.exe'] },
  { id: 'wow', name: 'World of Warcraft', processes: ['Wow.exe'] },
  { id: 'sc2', name: 'StarCraft II', processes: ['SC2_x64.exe'] },
];

// "C:\Games\CS2.EXE" -> "cs2". Gør navne sammenlignelige på tværs af styresystemer.
function normalizeProcessName(name) {
  const base = String(name).trim().split(/[\\/]/).pop();
  return base.toLowerCase().replace(/\.exe$/, '');
}

// Linux' `ps -o comm` afkorter navne til 15 tegn, så vi tillader præfiks-match dér.
const LINUX_COMM_LIMIT = 15;

function createProcessMatcher(processNames) {
  const running = new Set(processNames.map(normalizeProcessName));
  const truncated = [...running].filter((n) => n.length === LINUX_COMM_LIMIT);
  return (wanted) => {
    const w = normalizeProcessName(wanted);
    return running.has(w) || truncated.some((t) => w.startsWith(t));
  };
}

function customGamesToDefinitions(customGames) {
  return customGames.map((g, i) => ({ id: `custom-${i}`, name: g.name, processes: [g.process], custom: true }));
}

// Spil fundet automatisk (se game-detection.js).
function autoGamesToDefinitions(autoGames) {
  return autoGames.map((g, i) => ({ id: `auto-${i}`, name: g.name, processes: [g.process], auto: true }));
}

// Finder det spil der kører lige nu. Returnerer { game, phase } eller null.
// phase er 'match' / 'lobby' for spil med matchProcesses, ellers null.
function detectGame(processNames, games) {
  const isRunning = createProcessMatcher(processNames);
  for (const game of games) {
    if (!game.processes.some(isRunning)) continue;
    let phase = null;
    if (game.matchProcesses) phase = game.matchProcesses.some(isRunning) ? 'match' : 'lobby';
    return { game, phase };
  }
  return null;
}

const gameKey = (game) => game.processes.map(normalizeProcessName).join('|');

// Holder styr på, hvilket spil der kører, på tværs af scanningerne:
//
//  - Mange spil lukker vinduet, før processen er helt lukket – og nogle bliver
//    liggende i baggrunden. Har vi set spillet med et synligt vindue, tæller det
//    derfor kun som åbent, så længe det stadig har et.
//  - Et spil regnes først som lukket, når det mangler i to scanninger i træk, så
//    et enkelt mislykket opslag eller et vindue der genskabes, ikke afbryder.
class GameDetector {
  constructor({ missesBeforeClosed = 2 } = {}) {
    this.missesBeforeClosed = missesBeforeClosed;
    this.hadWindow = new Set();
    this.last = null;
    this.misses = 0;
  }

  // windowed: navnene på processer med et synligt vindue – eller null, hvis det
  // ikke kan afgøres (så bruges kun proceslisten). Returnerer { game, phase } eller null.
  update(processNames, games, windowed = null) {
    const isRunning = createProcessMatcher(processNames);
    const hasWindow = windowed ? createProcessMatcher([...windowed]) : null;
    const open = games.filter((game) => {
      const key = gameKey(game);
      if (!game.processes.some(isRunning)) {
        this.hadWindow.delete(key);
        return false;
      }
      if (!hasWindow) return true;
      if (game.processes.some(hasWindow)) {
        this.hadWindow.add(key);
        return true;
      }
      return !this.hadWindow.has(key); // vinduet er lukket – spillet er ved at lukke ned
    });

    const found = detectGame(processNames, open);
    if (found) {
      this.last = found;
      this.misses = 0;
      return found;
    }
    // Et spil der er fjernet fra listen (fx "Ikke et spil"), forsvinder med det samme.
    const stillListed = this.last && games.some((g) => gameKey(g) === gameKey(this.last.game));
    if (stillListed && ++this.misses < this.missesBeforeClosed) return this.last;
    this.last = null;
    this.misses = 0;
    return null;
  }
}

// Windows: `tasklist /fo csv /nh` giver linjer som "cs2.exe","1234","Console",...
// Returnerer [{ name, pid }].
function parseTasklistEntries(output) {
  const entries = [];
  for (const line of String(output).split(/\r?\n/)) {
    const match = /^"([^"]+)","(\d+)"/.exec(line.trim()) || /^"([^"]+)"/.exec(line.trim());
    if (match) entries.push({ name: match[1], pid: match[2] ? Number(match[2]) : null });
  }
  return entries;
}

function parseTasklistCsv(output) {
  return parseTasklistEntries(output).map((e) => e.name);
}

// macOS/Linux: `ps -A -o comm=` giver ét navn (eller en sti) pr. linje.
function parsePsOutput(output) {
  return String(output)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split('/').pop());
}

// Til "tilføj eget spil"-listen: fjern dubletter og typiske systemprocesser.
const SYSTEM_PROCESSES = new Set([
  'system',
  'system idle process',
  'svchost',
  'csrss',
  'wininit',
  'winlogon',
  'services',
  'lsass',
  'smss',
  'dwm',
  'explorer',
  'conhost',
  'fontdrvhost',
  'registry',
  'memory compression',
  'runtimebroker',
  'searchhost',
  'startmenuexperiencehost',
  'shellexperiencehost',
  'sihost',
  'taskhostw',
  'ctfmon',
  'dllhost',
  'audiodg',
  'spoolsv',
  'wmiprvse',
  'tasklist',
  'textinputhost',
  'securityhealthservice',
  'searchindexer',
  'smartscreen',
  'applicationframehost',
  'systemsettings',
  'lockapp',
  'msmpeng',
  'nissrv',
  'wudfhost',
  'dashost',
  'backgroundtaskhost',
  'useroobebroker',
  'ps',
  'bash',
  'zsh',
  'sh',
]);

function selectableProcesses(processNames) {
  const seen = new Map();
  for (const name of processNames) {
    const key = normalizeProcessName(name);
    if (!key || SYSTEM_PROCESSES.has(key) || seen.has(key)) continue;
    seen.set(key, name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'da', { sensitivity: 'base' }));
}

module.exports = {
  KNOWN_GAMES,
  normalizeProcessName,
  createProcessMatcher,
  customGamesToDefinitions,
  autoGamesToDefinitions,
  detectGame,
  GameDetector,
  parseTasklistEntries,
  parseTasklistCsv,
  parsePsOutput,
  selectableProcesses,
};
