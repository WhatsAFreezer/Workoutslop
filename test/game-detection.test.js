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

// Kalder finder.update hvert sekund fra `from` til `to` (ms) og returnerer det sidste svar.
function run(finder, fg, from, to, options = {}) {
  let result = null;
  for (let t = from; t <= to; t += 1000) {
    const r = finder.update(fg, t, () => false, typeof options === 'function' ? options(t) : options);
    if (r) result = r;
  }
  return result;
}

test('GameFinder tilføjer biblioteksspil med det samme', () => {
  const finder = new GameFinder({ fullscreenSeconds: 20 });
  const steam = { path: 'D:\\steamapps\\common\\Celeste\\Celeste.exe', coversMonitor: false };
  assert.deepEqual(
    finder.update(steam, 0, () => false),
    { added: { name: 'Celeste', process: 'Celeste.exe' } },
  );
  // Kendte eller afviste programmer ignoreres.
  assert.equal(
    finder.update(steam, 0, () => true),
    null,
  );
});

test('et program i fuld skærm, hvor man hele tiden er aktiv, er et spil', () => {
  const fullscreen = { path: 'C:\\Games\\Indie\\IndieGame.exe', coversMonitor: true };
  const game = { name: 'IndieGame', process: 'IndieGame.exe' };
  // Aktiv næsten hele tiden (input inden for det sidste sekund).
  const finder = new GameFinder({ fullscreenSeconds: 20 });
  assert.equal(run(finder, fullscreen, 0, 19000, { idleSeconds: 0 }), null);
  assert.deepEqual(
    finder.update(fullscreen, 20000, () => false, { idleSeconds: 1 }),
    { added: game },
  );

  // En film i fuld skærm: ingen input. Den bliver kun foreslået.
  const movie = new GameFinder({ fullscreenSeconds: 20 });
  assert.deepEqual(run(movie, fullscreen, 0, 20000, { idleSeconds: 60 }), { suggested: game });

  // Lidt aktivitet en gang imellem (fx en præsentation) er heller ikke nok.
  const slides = new GameFinder({ fullscreenSeconds: 20 });
  const sometimes = (t) => ({ idleSeconds: t % 10000 === 0 ? 0 : 8 });
  assert.deepEqual(run(slides, fullscreen, 0, 20000, sometimes), { suggested: game });
});

test('et program i eksklusiv fuldskærm er et spil efter få sekunder', () => {
  const finder = new GameFinder({ fullscreenSeconds: 20 });
  const fg = { path: 'C:\\Games\\Old\\OldGame.exe', coversMonitor: true };
  assert.equal(
    finder.update(fg, 0, () => false, { exclusive: true, idleSeconds: 99 }),
    null,
  );
  assert.equal(
    finder.update(fg, 1000, () => false, { exclusive: true, idleSeconds: 99 }),
    null,
  );
  assert.deepEqual(
    finder.update(fg, 2000, () => false, { exclusive: true, idleSeconds: 99 }),
    {
      added: { name: 'OldGame', process: 'OldGame.exe' },
    },
  );
});

test('fuld skærm skal vare ved, og nogle programmer er aldrig spil', () => {
  const unknown = () => false;
  const fullscreen = { path: 'C:\\Games\\Indie\\IndieGame.exe', coversMonitor: true };
  // Ikke i fuld skærm hele tiden = starter forfra.
  const finder = new GameFinder({ fullscreenSeconds: 20 });
  finder.update(fullscreen, 0, unknown, { idleSeconds: 0 });
  finder.update({ ...fullscreen, coversMonitor: false }, 10000, unknown, { idleSeconds: 0 });
  assert.equal(finder.update(fullscreen, 20000, unknown, { idleSeconds: 0 }), null);

  // Browsere, terminaler, fjernskrivebord og launchere tæller aldrig – heller ikke i eksklusiv fuldskærm.
  for (const path of [
    'C:\\x\\chrome.exe',
    'C:\\x\\WindowsTerminal.exe',
    'C:\\Windows\\System32\\mstsc.exe',
    'C:\\x\\XboxPcApp.exe',
    'C:\\x\\Playnite.FullscreenApp.exe',
  ]) {
    const f = new GameFinder({ fullscreenSeconds: 20 });
    assert.equal(run(f, { path, coversMonitor: true }, 0, 60000, { idleSeconds: 0, exclusive: true }), null, path);
  }
});

test('er spillet i forgrunden?', () => {
  const game = { processes: ['cs2.exe'] };
  assert.equal(isGameFocused(game, { path: 'C:\\x\\cs2.exe' }), true);
  assert.equal(isGameFocused(game, { path: 'C:\\x\\Discord.exe' }), false);
  assert.equal(isGameFocused(null, { path: 'C:\\x\\cs2.exe' }), null);
  assert.equal(isGameFocused(game, null), null);
});
