'use strict';

// Afgør om brugeren er "i pause" lige nu. Signalerne bruges i prioriteret rækkefølge:
//
//  1. integration – spillet fortæller selv, om man er i en kamp (CS2, Dota 2).
//  2. process     – spillet har separate processer for lobby og kamp (League).
//  3. focus       – spillet er i baggrunden (man har alt-tabbet ud, fx mens man
//                   venter i kø). Kun Windows.
//  4. idle        – ingen mus, tastatur eller controller i et stykke tid, mens
//                   spillet kører (kø, loadingskærm, mellem matches).
//
// Kun 'integration' og 'process' er "præcise": de ved, hvornår en kamp starter.

const PRECISE_SOURCES = new Set(['integration', 'process']);

function isPrecise(source) {
  return PRECISE_SOURCES.has(source);
}

function evaluate({
  game,
  phase,
  integration,
  idleSeconds,
  useIdle,
  idleThreshold,
  backgroundSeconds = null,
  backgroundThreshold = Infinity,
}) {
  if (!game) return { state: 'noGame', source: 'none', reason: 'Intet spil kører' };
  if (integration) {
    return { state: integration.isBreak ? 'pause' : 'playing', source: 'integration', reason: integration.label };
  }
  if (phase === 'lobby') return { state: 'pause', source: 'process', reason: 'I lobbyen mellem kampe' };
  if (phase === 'match') return { state: 'playing', source: 'process', reason: 'I kamp' };
  if (backgroundSeconds != null && backgroundSeconds >= backgroundThreshold) {
    return { state: 'pause', source: 'focus', reason: 'Spillet er i baggrunden' };
  }
  if (useIdle && idleSeconds >= idleThreshold) {
    return { state: 'pause', source: 'idle', reason: `Ingen aktivitet i ${Math.round(idleSeconds)} sek.` };
  }
  return { state: 'playing', source: useIdle ? 'idle' : 'none', reason: 'Spiller' };
}

class PauseDetector {
  // confirmMs: hvor længe et præcist signal skal være stabilt, før vi tror på det
  // (undgår blinken, hvis spillet sender et enkelt mærkeligt datapunkt).
  constructor({ confirmMs = 2000 } = {}) {
    this.confirmMs = confirmMs;
    this.current = { state: 'noGame', source: 'none', reason: 'Intet spil kører', since: 0 };
    this.candidate = null;
  }

  update(input) {
    const { now } = input;
    const raw = evaluate(input);
    const game = input.game ? { id: input.game.id, name: input.game.name } : null;

    if (raw.state === this.current.state) {
      // Samme tilstand – men årsagen kan have ændret sig (fx flere sekunders idle).
      this.candidate = null;
      this.current = { ...this.current, source: raw.source, reason: raw.reason };
      return { ...this.current, game, changed: false };
    }

    const needsConfirm = isPrecise(raw.source) && this.confirmMs > 0;
    if (needsConfirm) {
      if (!this.candidate || this.candidate.state !== raw.state) {
        this.candidate = { state: raw.state, since: now };
        return { ...this.current, game, changed: false };
      }
      if (now - this.candidate.since < this.confirmMs) {
        return { ...this.current, game, changed: false };
      }
    }

    this.candidate = null;
    this.current = { ...raw, since: now };
    return { ...this.current, game, changed: true };
  }
}

module.exports = { PauseDetector, evaluate, isPrecise };
