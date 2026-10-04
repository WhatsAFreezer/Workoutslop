(() => {
  'use strict';

  const api = window.workoutslop.overlay;
  const $ = (id) => document.getElementById(id);

  let payload = null;
  let player = null;
  let timer = null;
  let finishing = false;

  function reportSize() {
    requestAnimationFrame(() => api.reportSize(Math.ceil($('root').getBoundingClientRect().height)));
  }

  function startAnimation() {
    stopAnimation();
    const anim = payload && window.ANIMATIONS[payload.exercise.animation];
    if (anim) player = window.Figure.play($('figure'), anim);
  }

  function stopAnimation() {
    if (player) player.stop();
    player = null;
  }

  function setMode(mode) {
    $('card').hidden = mode !== 'full';
    $('compact').hidden = mode !== 'compact';
    $('celebrate').hidden = mode !== 'celebrate';
    if (mode === 'full') startAnimation();
    else stopAnimation();
    reportSize();
  }

  function render(next) {
    payload = next;
    finishing = false;
    const ex = next.exercise;

    $('context').textContent = next.context;
    $('muscle').textContent = [ex.muscleGroup, ...ex.equipment].join(' · ');
    $('name').textContent = ex.name;
    $('amount').textContent = next.amount;
    $('unit').textContent = next.unitLabel;

    const steps = $('steps');
    steps.replaceChildren(
      ...ex.steps.map((text) => {
        const li = document.createElement('li');
        li.textContent = text;
        return li;
      }),
    );
    $('tip').textContent = ex.tip || '';
    $('tip').hidden = !ex.tip;

    $('since').textContent = next.sinceText;
    $('hint').textContent = `${next.hotkeys.done} = færdig`;
    $('done').title = `Færdig (${next.hotkeys.done})`;
    $('close').title = `Spring over (${next.hotkeys.hide})`;
    $('snooze').textContent = `Om ${next.snoozeMinutes} min`;
    $('snooze').title = `Mind mig om det igen om ${next.snoozeMinutes} minutter`;
    $('compact-text').textContent = `${ex.name} · ${next.amount} ${next.unitLabel}`;

    resetTimer();
    $('done').classList.remove('ready');
    setMode(next.mode);
    if (next.fresh && next.sound) chime();
  }

  // --- Timer til øvelser der måles i sekunder (planke, vægsid ...) -----------

  function resetTimer() {
    clearInterval(timer);
    timer = null;
    const timed = payload && payload.exercise.unit === 'seconds';
    $('timer').hidden = !timed;
    $('timer-fill').style.width = '0%';
    $('timer-btn').textContent = 'Start timer';
  }

  function startTimer() {
    if (!payload) return;
    if (timer) {
      resetTimer();
      return;
    }
    const total = payload.amount;
    const startedAt = Date.now();
    const update = () => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const left = Math.max(0, Math.ceil(total - elapsed));
      $('timer-fill').style.width = `${Math.min(100, (elapsed / total) * 100)}%`;
      $('timer-btn').textContent = left > 0 ? `${left} sek. – stop` : 'Tiden er gået!';
      if (left === 0) {
        clearInterval(timer);
        timer = null;
        $('done').classList.add('ready');
        if (payload.sound) chime();
      }
    };
    update();
    timer = setInterval(update, 200);
  }

  // --- Handlinger ----------------------------------------------------------------

  function finish() {
    if (!payload || finishing) return;
    finishing = true;
    clearInterval(timer);
    $('celebrate-text').textContent = `${payload.exercise.name}: ${payload.amount} ${payload.unitLabel}`;
    setMode('celebrate');
    setTimeout(() => api.complete(), 1300);
  }

  function clear() {
    payload = null;
    finishing = false;
    resetTimer();
    stopAnimation();
    $('card').hidden = true;
    $('compact').hidden = true;
    $('celebrate').hidden = true;
  }

  // En blød "ding" når en øvelse dukker op.
  function chime() {
    try {
      const ctx = new AudioContext();
      const start = ctx.currentTime;
      [659.25, 987.77].forEach((freq, i) => {
        const t = start + i * 0.13;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.65);
      });
      setTimeout(() => ctx.close(), 1200);
    } catch {
      // Lyd er ikke vigtig nok til at fejle over.
    }
  }

  $('done').addEventListener('click', finish);
  $('compact-done').addEventListener('click', finish);
  $('close').addEventListener('click', () => api.skip());
  $('compact-close').addEventListener('click', () => api.skip());
  $('reroll').addEventListener('click', () => api.reroll());
  $('snooze').addEventListener('click', () => api.snooze());
  $('compact-open').addEventListener('click', () => api.expand());
  $('timer-btn').addEventListener('click', startTimer);

  api.onShow(render);
  api.onMode((mode) => {
    if (payload && !finishing) setMode(mode);
  });
  api.onAction((action) => {
    if (action === 'done') finish();
  });
  api.onClear(clear);
})();
