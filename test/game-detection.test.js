'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { gameFromPath, isNotGame, isKnownNonGame, GameFinder, isGameFocused } = require('../src/core/game-detection');

test('spil i spilbiblioteker genkendes og får et pænt navn', () => {
  assert.deepEqual(gameFromPath('D:\\SteamLibrary\\steamapps\\common\\Hades II\\Ship\\Hades2.exe'), {
    name: 'Hades II',
    process: 'Hades2.exe',
  });
  assert.equal(
    gameFromPath('C:\\Program Files\\Epic Games\\Fortnite\\FortniteGame\\Binaries\\Win64\\x.exe').name,
    'Fortnite',
  );
  assert.equal(gameFromPath('C:\\XboxGames\\Forza Horizon 5\\Content\\ForzaHorizon5.exe').name, 'Forza Horizon 5');
  assert.equal(gameFromPath('/home/me/.steam/steam/steamapps/common/Celeste/Celeste').name, 'Celeste');
  // Launchere og hjælpeprogrammer er ikke spil.
  assert.equal(gameFromPath('C:\\Program Files\\Epic Games\\Launcher\\Portal\\EpicGamesLauncher.exe'), null);
  assert.equal(gameFromPath('C:\\Riot Games\\Riot Client\\RiotClientServices.exe'), null);
  assert.equal(gameFromPath('D:\\steamapps\\common\\Some Game\\UnityCrashHandler64.exe'), null);
  assert.equal(gameFromPath('C:\\Windows\\explorer.exe'), null);
  assert.equal(gameFromPath(null), null);
});

test('browsere og videoafspillere er ikke spil, selv i fuld skærm', () => {
  assert.ok(isNotGame('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'));
  assert.ok(isNotGame('C:\\Program Files\\VideoLAN\\VLC\\vlc.exe'));
  assert.ok(!isNotGame('C:\\Games\\MyGame\\MyGame.exe'));
});

test('værktøjer fra Steam (fx Wallpaper Engine) er ikke spil', () => {
  assert.equal(gameFromPath('C:\\Steam\\steamapps\\common\\wallpaper_engine\\wallpaper32.exe'), null);
  assert.equal(gameFromPath('C:\\Steam\\steamapps\\common\\wallpaper_engine\\ui32.exe'), null);
  assert.equal(gameFromPath('D:\\steamapps\\common\\Lossless Scaling\\LosslessScaling.exe'), null);
  assert.equal(gameFromPath('D:\\steamapps\\common\\SteamVR\\bin\\win64\\vrmonitor.exe'), null);
  assert.equal(gameFromPath('D:\\steamapps\\common\\OBS Studio\\bin\\64bit\\obs64.exe'), null);
  assert.ok(isKnownNonGame({ name: 'wallpaper engine', process: 'wallpaper32.exe' }));
  assert.ok(isKnownNonGame({ name: 'Bongo Cat', process: 'BongoCat.exe' }));
  assert.ok(!isKnownNonGame({ name: 'Hades II', process: 'Hades2.exe' }));

  // Heller ikke som forslag, selv når de fylder skærmen.
  const finder = new GameFinder({ fullscreenSeconds: 1 });
  const tool = { path: 'C:\\Steam\\steamapps\\common\\wallpaper_engine\\ui32.exe', coversMonitor: true };
  assert.equal(
    finder.update(tool, 0, () => false),
    null,
  );
  assert.equal(
    finder.update(tool, 5000, () => false),
    null,
  );
});

test('GameFinder tilføjer biblioteksspil med det samme og foreslår fuldskærmsprogrammer efter et stykke tid', () => {
  const finder = new GameFinder({ fullscreenSeconds: 20 });
  const unknown = () => false;
  const steam = { path: 'D:\\steamapps\\common\\Celeste\\Celeste.exe', coversMonitor: false };
  assert.deepEqual(finder.update(steam, 0, unknown), { added: { name: 'Celeste', process: 'Celeste.exe' } });

  const fullscreen = { path: 'C:\\Games\\Indie\\IndieGame.exe', coversMonitor: true };
  assert.equal(finder.update(fullscreen, 0, unknown), null);
  assert.equal(finder.update(fullscreen, 10000, unknown), null);
  assert.deepEqual(finder.update(fullscreen, 20000, unknown), {
    suggested: { name: 'IndieGame', process: 'IndieGame.exe' },
  });

  // Ikke i fuld skærm hele tiden = starter forfra.
  const finder2 = new GameFinder({ fullscreenSeconds: 20 });
  finder2.update(fullscreen, 0, unknown);
  finder2.update({ ...fullscreen, coversMonitor: false }, 10000, unknown);
  assert.equal(finder2.update(fullscreen, 20000, unknown), null);

  // Kendte eller afviste programmer ignoreres.
  assert.equal(
    finder.update(steam, 0, () => true),
    null,
  );
  // Browser i fuld skærm foreslås aldrig.
  const browser = { path: 'C:\\x\\chrome.exe', coversMonitor: true };
  finder.update(browser, 0, unknown);
  assert.equal(finder.update(browser, 60000, unknown), null);
});

test('er spillet i forgrunden?', () => {
  const game = { processes: ['cs2.exe'] };
  assert.equal(isGameFocused(game, { path: 'C:\\x\\cs2.exe' }), true);
  assert.equal(isGameFocused(game, { path: 'C:\\x\\Discord.exe' }), false);
  assert.equal(isGameFocused(null, { path: 'C:\\x\\cs2.exe' }), null);
  assert.equal(isGameFocused(game, null), null);
});
