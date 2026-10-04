'use strict';

// Valve "Game State Integration": CS2 og Dota 2 kan sende spillets tilstand
// til et lokalt HTTP-endpoint. Så ved vi præcist, hvornår en kamp er slut.

const INTEGRATIONS = {
  cs2: {
    id: 'cs2',
    name: 'Counter-Strike 2',
    appId: 730,
    steamFolder: 'Counter-Strike Global Offensive',
    cfgDir: ['game', 'csgo', 'cfg'],
    data: ['provider', 'map', 'round', 'player_id'],
    note: 'Genstart CS2 efter installationen.',
  },
  dota2: {
    id: 'dota2',
    name: 'Dota 2',
    appId: 570,
    steamFolder: 'dota 2 beta',
    cfgDir: ['game', 'dota', 'cfg', 'gamestate_integration'],
    data: ['provider', 'map'],
    note: 'Tilføj "-gamestateintegration" under Dota 2 › Egenskaber › Startindstillinger i Steam, og genstart spillet.',
  },
};

const CFG_FILE_NAME = 'gamestate_integration_workoutslop.cfg';

function buildCfg(integrationId, { port, token }) {
  const integration = INTEGRATIONS[integrationId];
  const dataLines = integration.data.map((key) => `    "${key}" "1"`).join('\n');
  return [
    '"Workoutslop"',
    '{',
    `  "uri" "http://127.0.0.1:${port}/"`,
    '  "timeout" "5.0"',
    '  "buffer" "0.5"',
    '  "throttle" "1.0"',
    '  "heartbeat" "10.0"',
    '  "auth"',
    '  {',
    `    "token" "${token}"`,
    '  }',
    '  "data"',
    '  {',
    dataLines,
    '  }',
    '}',
    '',
  ].join('\n');
}

const DOTA_BREAK_STATES = new Set(['DOTA_GAMERULES_STATE_POST_GAME', 'DOTA_GAMERULES_STATE_DISCONNECT']);

// Oversætter en GSI-besked til { game, isBreak, label }. Returnerer null,
// hvis beskeden ikke kommer fra et spil vi kender.
function parseGsiPayload(payload) {
  const appId = payload?.provider?.appid;
  if (appId === INTEGRATIONS.cs2.appId) {
    const map = payload.map;
    if (!map) return { game: 'cs2', isBreak: true, label: 'I menuen' };
    switch (map.phase) {
      case 'gameover':
        return { game: 'cs2', isBreak: true, label: 'Kampen er slut' };
      case 'warmup':
        return { game: 'cs2', isBreak: false, label: 'Opvarmning' };
      case 'intermission':
        return { game: 'cs2', isBreak: false, label: 'Halvleg' };
      default:
        return { game: 'cs2', isBreak: false, label: 'I kamp' };
    }
  }
  if (appId === INTEGRATIONS.dota2.appId) {
    const state = payload.map?.game_state;
    if (!payload.map || !state) return { game: 'dota2', isBreak: true, label: 'I menuen' };
    if (DOTA_BREAK_STATES.has(state)) return { game: 'dota2', isBreak: true, label: 'Kampen er slut' };
    return { game: 'dota2', isBreak: false, label: 'I kamp' };
  }
  return null;
}

// Steam gemmer ekstra spilbiblioteker (fx på D:) i libraryfolders.vdf.
function parseLibraryFolders(vdfText) {
  const paths = [];
  const re = /"path"\s+"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = re.exec(String(vdfText)))) {
    paths.push(match[1].replace(/\\\\/g, '\\'));
  }
  return paths;
}

module.exports = { INTEGRATIONS, CFG_FILE_NAME, buildCfg, parseGsiPayload, parseLibraryFolders };
