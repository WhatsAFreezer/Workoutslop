'use strict';

// Windows-funktioner der ikke findes i Electron, kaldt direkte via koffi (FFI):
//
//  - XInputGetState: læser Xbox-kompatible controllere, så controller-input tæller
//    som aktivitet (Windows' egen inaktivitetstimer ignorerer controllere).
//  - SHQueryUserNotificationState: fortæller om et spil kører i eksklusiv
//    fuldskærm, hvor intet vindue kan vises ovenpå.
//  - Forgrundsvinduet (GetForegroundWindow m.fl.): hvilket program der er aktivt,
//    hvor dets vindue er, og om det fylder hele skærmen.
//  - SetWindowPos: lægger overlayet øverst igen, hvis et spil har lagt sig ovenpå.
//
// På andre styresystemer – eller hvis noget fejler – returneres null, og appen
// fortsætter uden funktionen.

const ERROR_SUCCESS = 0;
const QUNS_BUSY = 2; // et program kører i fuldskærm (fx kantløst vindue)
const QUNS_RUNNING_D3D_FULL_SCREEN = 3; // eksklusiv fuldskærm
const XUSER_MAX_COUNT = 4;
const MONITOR_DEFAULTTONEAREST = 2;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const HWND_TOPMOST = -1;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;

let native; // undefined = ikke forsøgt endnu, null = ikke tilgængelig

function tryLoad(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

function load() {
  if (native !== undefined) return native;
  native = null;
  if (process.platform !== 'win32') return native;
  const koffi = tryLoad(() => require('koffi'));
  if (!koffi) return native;

  const result = {};

  result.getState = tryLoad(() => {
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
      const fn = tryLoad(() =>
        koffi.load(dll).func('uint32 __stdcall XInputGetState(uint32 dwUserIndex, _Out_ XINPUT_STATE *pState)'),
      );
      if (fn) return fn;
    }
    return null;
  });

  result.notificationState = tryLoad(() =>
    koffi.load('shell32.dll').func('long __stdcall SHQueryUserNotificationState(_Out_ int *pquns)'),
  );

  // Vindueshåndtag (HWND) behandles som tal (intptr_t).
  result.window = tryLoad(() => {
    const RECT = koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
    koffi.struct('MONITORINFO', { cbSize: 'uint32', rcMonitor: RECT, rcWork: RECT, dwFlags: 'uint32' });
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    return {
      GetForegroundWindow: user32.func('intptr_t __stdcall GetForegroundWindow()'),
      GetWindowThreadProcessId: user32.func(
        'uint32 __stdcall GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32 *lpdwProcessId)',
      ),
      GetWindowRect: user32.func('int __stdcall GetWindowRect(intptr_t hWnd, _Out_ RECT *lpRect)'),
      IsIconic: user32.func('int __stdcall IsIconic(intptr_t hWnd)'),
      MonitorFromWindow: user32.func('intptr_t __stdcall MonitorFromWindow(intptr_t hwnd, uint32 dwFlags)'),
      GetMonitorInfoW: user32.func('int __stdcall GetMonitorInfoW(intptr_t hMonitor, _Inout_ MONITORINFO *lpmi)'),
      SetWindowPos: user32.func(
        'int __stdcall SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int X, int Y, int cx, int cy, uint32 uFlags)',
      ),
      OpenProcess: kernel32.func(
        'intptr_t __stdcall OpenProcess(uint32 dwDesiredAccess, int bInheritHandle, uint32 dwProcessId)',
      ),
      QueryFullProcessImageNameW: kernel32.func(
        'int __stdcall QueryFullProcessImageNameW(intptr_t hProcess, uint32 dwFlags, _Out_ uint8 *lpExeName, _Inout_ uint32 *lpdwSize)',
      ),
      CloseHandle: kernel32.func('int __stdcall CloseHandle(intptr_t hObject)'),
    };
  });

  native = result.getState || result.notificationState || result.window ? result : null;
  return native;
}

// Tilstanden for controller nr. `index` (0-3), eller null hvis den ikke er tilsluttet.
function readGamepad(index) {
  const api = load();
  if (!api?.getState) return null;
  const state = {};
  return api.getState(index, state) === ERROR_SUCCESS ? state : null;
}

// 'exclusive' | 'fullscreen' | 'normal' – eller null, hvis det ikke kan afgøres.
function notificationState() {
  const api = load();
  if (!api?.notificationState) return null;
  const out = [0];
  if (api.notificationState(out) !== 0) return null;
  if (out[0] === QUNS_RUNNING_D3D_FULL_SCREEN) return 'exclusive';
  if (out[0] === QUNS_BUSY) return 'fullscreen';
  return 'normal';
}

// true/false – eller null, hvis det ikke kan afgøres (fx ikke Windows).
function isExclusiveFullscreen() {
  const state = notificationState();
  return state == null ? null : state === 'exclusive';
}

function processPath(win, pid) {
  const handle = Number(win.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid));
  if (!handle) return null;
  try {
    const buffer = Buffer.alloc(2 * 1024);
    const size = [1024];
    if (!win.QueryFullProcessImageNameW(handle, 0, buffer, size)) return null;
    return buffer.toString('utf16le', 0, size[0] * 2);
  } finally {
    win.CloseHandle(handle);
  }
}

// Oplysninger om vinduet i forgrunden:
// { pid, path, rect, monitor, minimized, coversMonitor } – eller null.
// Rektangler er i fysiske pixels: { left, top, right, bottom }.
function foregroundWindow() {
  const win = load()?.window;
  if (!win) return null;
  const hwnd = Number(win.GetForegroundWindow());
  if (!hwnd) return null;
  const pid = [0];
  win.GetWindowThreadProcessId(hwnd, pid);
  if (!pid[0]) return null;

  const rect = {};
  if (!win.GetWindowRect(hwnd, rect)) return null;
  const info = { cbSize: 40 };
  const monitorHandle = Number(win.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST));
  const monitor = monitorHandle && win.GetMonitorInfoW(monitorHandle, info) ? info.rcMonitor : null;
  const minimized = Boolean(win.IsIconic(hwnd));
  const coversMonitor =
    !minimized &&
    monitor != null &&
    rect.left <= monitor.left &&
    rect.top <= monitor.top &&
    rect.right >= monitor.right &&
    rect.bottom >= monitor.bottom;

  return { pid: pid[0], path: processPath(win, pid[0]), rect, monitor, minimized, coversMonitor };
}

// Lægger et vindue øverst blandt "altid øverst"-vinduer uden at give det fokus.
// `handle` er Buffer'en fra BrowserWindow.getNativeWindowHandle().
function bringToTop(handle) {
  const win = load()?.window;
  if (!win || !handle) return false;
  const hwnd = handle.length >= 8 ? Number(handle.readBigUInt64LE(0)) : handle.readUInt32LE(0);
  return Boolean(win.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE));
}

function capabilities() {
  const api = load();
  return {
    gamepads: Boolean(api?.getState),
    fullscreenDetection: Boolean(api?.notificationState),
    foregroundWindow: Boolean(api?.window),
  };
}

module.exports = {
  XUSER_MAX_COUNT,
  readGamepad,
  notificationState,
  isExclusiveFullscreen,
  foregroundWindow,
  bringToTop,
  capabilities,
};
