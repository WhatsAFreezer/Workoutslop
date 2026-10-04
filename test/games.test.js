'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const games = require('../src/core/games');
const gsi = require('../src/core/gsi');
const { normalizeSettings } = require('../src/core/settings');

test('procesnavne normaliseres', () => {
  assert.equal(games.normalizeProcessName('C:\\Games\\CS2.EXE'), 'cs2');
  assert.equal(games.normalizeProcessName('/usr/bin/dota2'), 'dota2');
  assert.equal(games.normalizeProcessName('League of Legends.exe'), 'league of legends');
});

test('finder kendte spil og skelner mellem lobby og kamp', () => {
  const g = games.KNOWN_GAMES;
  assert.equal(games.detectGame(['explorer.exe', 'chrome.exe'], g), null);
  assert.equal(games.detectGame(['cs2.exe'], g).game.id, 'cs2');

  const lobby = games.detectGame(['LeagueClientUx.exe', 'LeagueClient.exe'], g);
  assert.equal(lobby.game.id, 'lol');
  assert.equal(lobby.phase, 'lobby');
  assert.equal(games.detectGame(['LeagueClientUx.exe', 'League of Legends.exe'], g).phase, 'match');
});

test('egne spil og afkortede Linux-navne', () => {
  const list = [...games.customGamesToDefinitions([{ name: 'Minecraft', process: 'javaw.exe' }]), ...games.KNOWN_GAMES];
  assert.equal(games.detectGame(['javaw.exe'], list).game.name, 'Minecraft');
  // `ps -o comm` på Linux afkorter til 15 tegn.
  assert.equal(games.detectGame(['FortniteClient-'], games.KNOWN_GAMES).game.id, 'fortnite');
});

test('parser tasklist og ps', () => {
  const csv = '"System Idle Process","0","Services","0","8 K"\r\n"cs2.exe","4242","Console","1","1.234.567 K"\r\n';
  assert.deepEqual(games.parseTasklistCsv(csv), ['System Idle Process', 'cs2.exe']);
  assert.deepEqual(games.parsePsOutput('  bash\n/Applications/Steam.app/Contents/MacOS/steam_osx\ncs2\n'), [
    'bash',
    'steam_osx',
    'cs2',
  ]);
});

test('listen over programmer at vælge imellem er ryddet op', () => {
  const list = games.selectableProcesses(['svchost.exe', 'svchost.exe', 'MyGame.exe', 'chrome.exe', 'Chrome.exe']);
  assert.deepEqual(list, ['chrome.exe', 'MyGame.exe']);
});

test('GSI fra Counter-Strike 2', () => {
  const menu = gsi.parseGsiPayload({ provider: { appid: 730 }, player: { activity: 'menu' } });
  assert.deepEqual(menu, { game: 'cs2', isBreak: true, label: 'I menuen' });
  assert.equal(gsi.parseGsiPayload({ provider: { appid: 730 }, map: { phase: 'live' } }).isBreak, false);
  assert.equal(gsi.parseGsiPayload({ provider: { appid: 730 }, map: { phase: 'warmup' } }).isBreak, false);
  assert.equal(gsi.parseGsiPayload({ provider: { appid: 730 }, map: { phase: 'gameover' } }).isBreak, true);
  assert.equal(gsi.parseGsiPayload({ provider: { appid: 1 } }), null);
  assert.equal(gsi.parseGsiPayload(null), null);
});

test('GSI fra Dota 2', () => {
  const ingame = { provider: { appid: 570 }, map: { game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS' } };
  assert.equal(gsi.parseGsiPayload(ingame).isBreak, false);
  const post = { provider: { appid: 570 }, map: { game_state: 'DOTA_GAMERULES_STATE_POST_GAME' } };
  assert.equal(gsi.parseGsiPayload(post).isBreak, true);
  assert.equal(gsi.parseGsiPayload({ provider: { appid: 570 } }).isBreak, true);
});

test('cfg-fil og Steam-biblioteker', () => {
  const cfg = gsi.buildCfg('cs2', { port: 3417, token: 'abc123' });
  assert.match(cfg, /"uri" "http:\/\/127\.0\.0\.1:3417\/"/);
  assert.match(cfg, /"token" "abc123"/);
  assert.match(cfg, /"map" "1"/);

  const vdf =
    '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}';
  assert.deepEqual(gsi.parseLibraryFolders(vdf), ['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary']);
});

test('indstillinger gøres gyldige', () => {
  const s = normalizeSettings({
    level: 9,
    equipment: ['dumbbells', 'laser', 'dumbbells'],
    idleSeconds: 2,
    minMinutesBetween: 'abc',
    overlayPosition: 'middle',
    customGames: [{ process: ' MyGame.exe ' }, { process: 'mygame.exe' }, { process: '' }],
    gsiToken: 'not-hex',
    integrationFiles: { cs2: 'C:\\cfg', evil: 'x' },
    focus: ['arms', 'legs', 'arms', 'backPosture'],
  });
  assert.equal(s.level, 2);
  assert.deepEqual(s.equipment, ['dumbbells']);
  assert.equal(s.idleSeconds, 10);
  assert.equal(s.minMinutesBetween, 10);
  assert.equal(s.overlayPosition, 'top-right');
  assert.deepEqual(s.customGames, [{ name: 'MyGame', process: 'MyGame.exe' }]);
  assert.equal(s.gsiToken, '');
  assert.deepEqual(s.integrationFiles, { cs2: 'C:\\cfg' });
  assert.deepEqual(s.focus, ['arms', 'backPosture']);
  assert.equal(s.setupComplete, false);
});
