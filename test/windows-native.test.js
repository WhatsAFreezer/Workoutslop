'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const native = require('../src/main/windows-native');

test('uden for Windows slås funktionerne stille fra', { skip: process.platform === 'win32' }, () => {
  assert.deepEqual(native.capabilities(), { gamepads: false, fullscreenDetection: false });
  assert.equal(native.readGamepad(0), null);
  assert.equal(native.isExclusiveFullscreen(), null);
});

// Kører på GitHubs Windows-maskine og tjekker, at kaldene til Windows virker.
test('Windows: XInput og fuldskærmsdetektion kan kaldes', { skip: process.platform !== 'win32' }, () => {
  assert.deepEqual(native.capabilities(), { gamepads: true, fullscreenDetection: true });
  for (let i = 0; i < native.XUSER_MAX_COUNT; i++) {
    const state = native.readGamepad(i);
    // Ingen controller på en build-server, men kaldet må ikke fejle.
    assert.ok(state === null || typeof state.dwPacketNumber === 'number');
  }
  assert.equal(typeof native.isExclusiveFullscreen(), 'boolean');
});
