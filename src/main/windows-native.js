'use strict';

// Windows-funktioner der ikke findes i Electron, kaldt direkte via koffi (FFI):
//
//  - XInputGetState: læser Xbox-kompatible controllere, så controller-input tæller
//    som aktivitet (Windows' egen inaktivitetstimer ignorerer controllere).
//  - SHQueryUserNotificationState: fortæller om et spil kører i eksklusiv
//    fuldskærm, hvor intet vindue kan vises ovenpå.
//
// På andre styresystemer – eller hvis noget fejler – returneres null, og appen
// fortsætter uden funktionen.

const ERROR_SUCCESS = 0;
const QUNS_RUNNING_D3D_FULL_SCREEN = 3;
const XUSER_MAX_COUNT = 4;

let native; // undefined = ikke forsøgt endnu, null = ikke tilgængelig

function load() {
  if (native !== undefined) return native;
  native = null;
  if (process.platform !== 'win32') return native;
  let koffi;
  try {
    koffi = require('koffi');
  } catch {
    return native;
  }

  const result = { getState: null, notificationState: null };

  try {
    const GAMEPAD = koffi.struct('XINPUT_GAMEPAD', {
      wButtons: 'uint16',
      bLeftTrigger: 'uint8',
      bRightTrigger: 'uint8',
      sThumbLX: 'int16',
      sThumbLY: 'int16',
      sThumbRX: 'int16',
      sThumbRY: 'int16',
    });
    koffi.struct('XINPUT_STATE', { dwPacketNumber: 'uint32', Gamepad: GAMEPAD });
    // xinput1_4 findes fra Windows 8; xinput9_1_0 er en ældre fallback.
    for (const dll of ['xinput1_4.dll', 'xinput9_1_0.dll']) {
      try {
        result.getState = koffi
          .load(dll)
          .func('uint32 __stdcall XInputGetState(uint32 dwUserIndex, _Out_ XINPUT_STATE *pState)');
        break;
      } catch {
        // Prøv den næste.
      }
    }
  } catch {
    result.getState = null;
  }

  try {
    result.notificationState = koffi
      .load('shell32.dll')
      .func('long __stdcall SHQueryUserNotificationState(_Out_ int *pquns)');
  } catch {
    result.notificationState = null;
  }

  native = result.getState || result.notificationState ? result : null;
  return native;
}

// Tilstanden for controller nr. `index` (0-3), eller null hvis den ikke er tilsluttet.
function readGamepad(index) {
  const api = load();
  if (!api?.getState) return null;
  const state = {};
  return api.getState(index, state) === ERROR_SUCCESS ? state : null;
}

// true/false – eller null, hvis det ikke kan afgøres (fx ikke Windows).
function isExclusiveFullscreen() {
  const api = load();
  if (!api?.notificationState) return null;
  const out = [0];
  return api.notificationState(out) === 0 ? out[0] === QUNS_RUNNING_D3D_FULL_SCREEN : null;
}

function capabilities() {
  const api = load();
  return { gamepads: Boolean(api?.getState), fullscreenDetection: Boolean(api?.notificationState) };
}

module.exports = { XUSER_MAX_COUNT, readGamepad, isExclusiveFullscreen, capabilities };
