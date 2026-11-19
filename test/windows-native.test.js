'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const native = require('../src/main/windows-native');

test('uden for Windows slås funktionerne stille fra', { skip: process.platform === 'win32' }, () => {
  assert.deepEqual(native.capabilities(), {
    gamepads: false,
    fullscreenDetection: false,
    foregroundWindow: false,
    windowList: false,
    processList: false,
  });
  assert.equal(native.processList(), null);
  assert.equal(native.taskbarWindows(), null);
  assert.equal(native.readGamepad(0), null);
  assert.equal(native.notificationState(), null);
  assert.equal(native.foregroundWindow(), null);
  assert.equal(native.visibleWindowPids(), null);
  assert.equal(native.bringToTop(Buffer.alloc(8)), false);
});

// Kører på GitHubs Windows-maskine og tjekker, at kaldene til Windows virker.
test('Windows: controller, fuldskærm og forgrundsvindue kan aflæses', { skip: process.platform !== 'win32' }, () => {
  assert.deepEqual(native.capabilities(), {
    gamepads: true,
    fullscreenDetection: true,
    foregroundWindow: true,
    windowList: true,
    processList: true,
  });
  for (let i = 0; i < native.XUSER_MAX_COUNT; i++) {
    const state = native.readGamepad(i);
    // Ingen controller på en build-server, men kaldet må ikke fejle.
    assert.ok(state === null || typeof state.dwPacketNumber === 'number');
  }
  assert.ok(['exclusive', 'fullscreen', 'normal'].includes(native.notificationState()));

  // En build-server har ikke nødvendigvis et vindue i forgrunden – men hvis den har, skal oplysningerne give mening.
  const fg = native.foregroundWindow();
  if (fg) {
    assert.ok(fg.pid > 0);
    assert.ok(fg.path === null || /\.exe$/i.test(fg.path), `sti: ${fg.path}`);
    assert.equal(typeof fg.coversMonitor, 'boolean');
    assert.ok(fg.rect.right >= fg.rect.left);
  }
  // Listen over synlige vinduer kan læses (den kan være tom på en build-server).
  const pids = native.visibleWindowPids();
  assert.ok(pids instanceof Set, 'visibleWindowPids skal give et Set');
  for (const pid of pids) assert.ok(Number.isInteger(pid) && pid > 0);

  // Et ugyldigt vindueshåndtag må ikke få appen til at crashe.
  assert.equal(native.bringToTop(Buffer.alloc(8)), false);
});

test('Windows: listen over kørende programmer læses direkte', { skip: process.platform !== 'win32' }, () => {
  const list = native.processList();
  assert.ok(Array.isArray(list) && list.length > 10, `fandt ${list?.length} programmer`);
  // Testen selv kører i node.exe – den skal være på listen med sit eget proces-id.
  const self = list.find((p) => p.pid === process.pid);
  assert.ok(self, 'egen proces mangler');
  assert.match(self.name, /^node(\.exe)?$/i);
  assert.ok(list.every((p) => typeof p.name === 'string' && p.name.length > 0 && Number.isInteger(p.pid)));
});

test('Windows: programmer med vindue kan listes med titel', { skip: process.platform !== 'win32' }, () => {
  const list = native.taskbarWindows();
  // En build-server har måske ingen vinduer – men kaldet skal virke og give gyldige rækker.
  assert.ok(Array.isArray(list));
  for (const w of list) {
    assert.ok(w.pid > 0 && typeof w.title === 'string' && w.title.length > 0);
    assert.ok(w.path === null || /\.exe$/i.test(w.path), `sti: ${w.path}`);
  }
});
