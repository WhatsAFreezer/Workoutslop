'use strict';

const { isPrecise } = require('./pause-detector');

// "Træneren" bestemmer, hvornår overlayet vises, skjules eller gøres lille.
// Den kender ikke til Electron – den returnerer bare kommandoer, som main.js
// udfører. Det gør logikken nem at teste.
//
// Kommandoer: { type: 'show', current, fresh } | { type: 'compact' } | { type: 'expand' }
//             | { type: 'hide' } | { type: 'record', entry }

const MINUTE = 60 * 1000;
// Hvis brugeren er aktiv så længe efter en idle-pause uden at reagere, gøres overlayet lille.
const ACTIVE_BEFORE_COMPACT_MS = 45 * 1000;
// Så længe bliver den lille udgave stående, før den forsvinder af sig selv.
const COMPACT_TIMEOUT_MS = 60 * 1000;
// Efter "spring over" går der mindst så længe, før næste forslag.
const DISMISS_COOLDOWN_MS = 5 * MINUTE;
// Under så mange sekunder uden input regnes brugeren for aktiv.
const ACTIVE_IDLE_SECONDS = 3;

class Coach {
  // suggest(now, excludeIds, settingsOverride, { ignoreTargets }) skal returnere et forslag eller null
  // (null fx når dagens sæt er lavet).
  constructor({ suggest }) {
    this.suggest = suggest;
    this.current = null;
    this.snoozedUntil = 0;
    this.lastCompletedAt = -Infinity;
    this.lastDismissedAt = -Infinity;
  }

  nextAllowedAt(settings) {
    const gap = settings.minMinutesBetween * MINUTE;
    return Math.max(
      this.snoozedUntil,
      this.lastCompletedAt + gap,
      this.lastDismissedAt + Math.min(gap, DISMISS_COOLDOWN_MS),
    );
  }

  tick({ now, pause, idleSeconds, settings }) {
    const c = this.current;
    if (!c) {
      if (pause.state === 'pause' && now >= this.nextAllowedAt(settings)) {
        return this.present(now, this.suggest(now, []), 'pause', pause);
      }
      return [];
    }

    // Spillet er lukket: en øvelse fra en pause i spillet forsvinder.
    if (pause.state === 'noGame' && c.trigger === 'pause') return this.finish(now, 'missed');

    if (pause.state === 'pause') {
      c.sawPause = true;
      c.activeSince = null;
      if (c.mode === 'compact') {
        c.mode = 'full';
        c.compactSince = null;
        return [{ type: 'expand' }];
      }
      return [];
    }

    if (c.mode === 'compact') {
      return now - c.compactSince >= COMPACT_TIMEOUT_MS ? this.finish(now, 'missed') : [];
    }

    // Overlayet er vist i fuld størrelse, men pausen er slut. Forslag man selv
    // har bedt om (genvejstast/eksempel) får lov at blive, til man reagerer.
    if (pause.state !== 'playing' || !c.sawPause) return [];
    if (isPrecise(pause.source)) return this.compact(now);
    if (idleSeconds < ACTIVE_IDLE_SECONDS) {
      c.activeSince ??= now;
      if (now - c.activeSince >= ACTIVE_BEFORE_COMPACT_MS) return this.compact(now);
    } else {
      c.activeSince = null;
    }
    return [];
  }

  present(now, suggestion, trigger, pause = null, settingsOverride = null) {
    if (!suggestion) return [];
    this.current = {
      suggestion,
      trigger,
      settingsOverride,
      mode: 'full',
      shownAt: now,
      sawPause: pause?.state === 'pause',
      activeSince: null,
      compactSince: null,
      reason: pause?.reason ?? null,
      gameName: pause?.game?.name ?? null,
    };
    return [{ type: 'show', current: this.current, fresh: true }];
  }

  compact(now) {
    this.current.mode = 'compact';
    this.current.compactSince = now;
    return [{ type: 'compact' }];
  }

  finish(now, status) {
    const c = this.current;
    if (!c) return [];
    this.current = null;
    if (c.trigger === 'preview') return [{ type: 'hide' }];
    if (status === 'done') this.lastCompletedAt = now;
    else this.lastDismissedAt = now;
    const { exercise, amount } = c.suggestion;
    const entry = {
      at: now,
      exerciseId: exercise.id,
      muscleGroup: exercise.muscleGroup,
      amount,
      unit: exercise.unit,
      status,
    };
    return [{ type: 'record', entry }, { type: 'hide' }];
  }

  complete(now) {
    return this.finish(now, 'done');
  }

  skip(now) {
    return this.finish(now, 'skipped');
  }

  snooze(now, minutes) {
    const c = this.current;
    if (!c) return [];
    this.current = null;
    if (c.trigger !== 'preview') this.snoozedUntil = now + minutes * MINUTE;
    return [{ type: 'hide' }];
  }

  reroll(now) {
    const c = this.current;
    if (!c) return [];
    const ignoreTargets = c.trigger !== 'pause';
    const next = this.suggest(now, [c.suggestion.exercise.id], c.settingsOverride, { ignoreTargets });
    if (!next) return [];
    c.suggestion = next;
    c.mode = 'full';
    c.compactSince = null;
    return [{ type: 'show', current: c, fresh: false }];
  }

  // Brugeren klikker på den lille udgave for at se øvelsen igen.
  expand() {
    const c = this.current;
    if (!c || c.mode !== 'compact') return [];
    c.mode = 'full';
    c.compactSince = null;
    c.activeSince = null;
    c.sawPause = false; // ellers bliver den lille igen ved næste tick
    return [{ type: 'expand' }];
  }

  // "Øvelse nu" (genvejstast eller bakkemenu) – ignorerer interval og snooze.
  requestNow(now) {
    if (this.current) {
      return this.current.mode === 'compact' ? this.expand() : [{ type: 'show', current: this.current, fresh: false }];
    }
    // Beder man selv om en øvelse, får man en – også når dagens sæt er lavet.
    return this.present(now, this.suggest(now, [], null, { ignoreTargets: true }), 'manual');
  }

  pauseUntil(timestamp) {
    this.snoozedUntil = timestamp;
    if (!this.current) return [];
    this.current = null;
    return [{ type: 'hide' }];
  }

  resume() {
    this.snoozedUntil = 0;
  }
}

module.exports = { Coach, ACTIVE_BEFORE_COMPACT_MS, COMPACT_TIMEOUT_MS, DISMISS_COOLDOWN_MS };
