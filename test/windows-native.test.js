'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const native = require('../src/main/windows-native');

test('uden for Windows slås funktionerne stille fra', { skip: process.platform === 'win32' }, () => {
  assert.deepEqual(native.capabilities(), { gamepads: false, fullscreenDetection: false, foregroundWindow: false });
  assert.equal(native.readGamepad(0), null);
  assert.equal(native.isExclusiveFullscreen(), null);
  assert.equal(native.notificationState(), null);
  assert.equal(native.foregroundWindow(), null);
  assert.equal(native.bringToTop(Buffer.alloc(8)), false);
});

// Kører på GitHubs Windows-maskine og tjekker, at kaldene til Windows virker.
test('Windows: controller, fuldskærm og forgrundsvindue kan aflæses', { skip: process.platform !== 'win32' }, () => {
  assert.deepEqual(native.capabilities(), { gamepads: true, fullscreenDetection: true, foregroundWindow: true });
  for (let i = 0; i < native.XUSER_MAX_COUNT; i++) {
    const state = native.readGamepad(i);
    // Ingen controller på en build-server, men kaldet må ikke fejle.
    assert.ok(state === null || typeof state.dwPacketNumber === 'number');
  }
  assert.ok(['exclusive', 'fullscreen', 'normal'].includes(native.notificationState()));
  assert.equal(typeof native.isExclusiveFullscreen(), 'boolean');

  // En build-server har ikke nødvendigvis et vindue i forgrunden – men hvis den har, skal oplysningerne give mening.
  const fg = native.foregroundWindow();
  if (fg) {
    assert.ok(fg.pid > 0);
    assert.ok(fg.path === null || /\.exe$/i.test(fg.path), `sti: ${fg.path}`);
    assert.equal(typeof fg.coversMonitor, 'boolean');
    assert.ok(fg.rect.right >= fg.rect.left);
  }
  // Et ugyldigt vindueshåndtag må ikke få appen til at crashe.
  assert.equal(native.bringToTop(Buffer.alloc(8)), false);
});
