'use strict';

// Holder styr på, hvornår der sidst var input fra en controller. Controllerens
// tilstand aflæses flere gange i sekundet; her afgøres, om det var "rigtigt" input.
//
// Analoge pinde svinger lidt, selv når ingen rører dem (drift), så små udsving
// under en dødzone tæller ikke.

const STICK_DEADZONE = 8000; // af 32767
const STICK_CHANGE = 3000; // så meget skal en pind flytte sig mellem to aflæsninger
const TRIGGER_THRESHOLD = 30; // af 255

const STICKS = ['sThumbLX', 'sThumbLY', 'sThumbRX', 'sThumbRY'];
const TRIGGERS = ['bLeftTrigger', 'bRightTrigger'];

function isPressed(gamepad) {
  return (
    gamepad.wButtons !== 0 ||
    TRIGGERS.some((t) => gamepad[t] > TRIGGER_THRESHOLD) ||
    STICKS.some((s) => Math.abs(gamepad[s]) > STICK_DEADZONE)
  );
}

function changedMeaningfully(prev, next) {
  if (prev.wButtons !== next.wButtons) return true;
  if (TRIGGERS.some((t) => Math.abs(prev[t] - next[t]) > TRIGGER_THRESHOLD)) return true;
  return STICKS.some((s) => Math.abs(prev[s] - next[s]) > STICK_CHANGE);
}

class GamepadActivity {
  constructor() {
    this.previous = new Map(); // controller-nummer -> seneste tilstand
    this.lastInputAt = -Infinity;
  }

  // state: XINPUT_STATE ({ dwPacketNumber, Gamepad }) eller null, hvis ikke tilsluttet.
  // Returnerer true, hvis aflæsningen tæller som aktivitet.
  update(index, state, now) {
    const prev = this.previous.get(index);
    if (!state) {
      this.previous.delete(index);
      return false;
    }
    this.previous.set(index, state);
    const active =
      isPressed(state.Gamepad) ||
      (prev != null &&
        prev.dwPacketNumber !== state.dwPacketNumber &&
        changedMeaningfully(prev.Gamepad, state.Gamepad));
    if (active) this.lastInputAt = now;
    return active;
  }

  get connected() {
    return this.previous.size;
  }

  idleSeconds(now) {
    return Number.isFinite(this.lastInputAt) ? Math.max(0, (now - this.lastInputAt) / 1000) : Infinity;
  }
}

module.exports = { GamepadActivity };
