(() => {
  'use strict';

  const api = window.workoutslop.setup;
  const $ = (id) => document.getElementById(id);
  const STEP_COUNT = 5;

  // Små ikoner til redskaberne (24×24).
  const EQUIPMENT_ICONS = {
    dumbbells: '<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
    kettlebell: '<path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/><circle cx="12" cy="14.5" r="6"/>',
    bench: '<rect x="3" y="9" width="18" height="3.5" rx="1"/><path d="M6.5 12.5V18M17.5 12.5V18"/>',
    pullupBar: '<path d="M4 4v16M20 4v16M4 7h16M9.5 7v3.5M14.5 7v3.5"/><circle cx="12" cy="12.5" r="1.8"/>',
    resistanceBand:
      '<path d="M5 12c3-5 4 5 7 0s4 5 7 0"/><circle cx="3.5" cy="12" r="1.5"/><circle cx="20.5" cy="12" r="1.5"/>',
    barbell: '<path d="M1.5 12h21M5.5 6.5v11M18.5 6.5v11M8 8.5v7M16 8.5v7"/>',
  };

  // Lille figur på hvert fokuskort: [animation, nøglepose].
  const FOCUS_FIGURES = {
    all: ['jumpingJack', 1],
    chestShoulders: ['pushup', 0],
    backPosture: ['pullup', 1],
    legsAbs: ['squat', 1],
    arms: ['bicepCurl', 1],
  };
  const CHECK_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';

  let data = null; // alt hovedprocessen sender: katalog, indstillinger, status ...
  let draft = null; // de indstillinger brugeren er ved at redigere
  let step = 0;
  let furthest = 0;
  let counts = null; // antal øvelser der passer, fra hovedprocessen

  // Laver et element. Tekst sættes altid som tekst (ikke HTML), så brugerinput er sikkert.
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of [].concat(children)) if (child) node.append(child);
    return node;
  }

  function setStatus(text) {
    $('status').textContent = text || '';
  }

  // --- Trin 1: niveau -----------------------------------------------------------

  function renderLevels() {
    const { levels, levelExamples } = data.catalog;
    $('levels').replaceChildren(
      ...levels.map((level) => {
        const bars = el(
          'span',
          { class: 'bars', 'aria-hidden': 'true' },
          levels.map((l, i) => {
            const bar = el('span', { class: l.id <= level.id ? 'on' : '' });
            bar.style.height = `${8 + i * 4.5}px`;
            return bar;
          }),
        );
        return el(
          'button',
          {
            type: 'button',
            class: 'choice',
            role: 'radio',
            'aria-checked': String(draft.level === level.id),
            onclick: () => {
              draft.level = level.id;
              renderLevels();
              updateCount();
            },
          },
          [
            bars,
            el('span', { class: 'choice-title', text: level.name }),
            el('span', { class: 'choice-text', text: level.description }),
            el('span', { class: 'choice-example', text: levelExamples[level.id] }),
            el('span', { class: 'choice-mark', html: CHECK_ICON }),
          ],
        );
      }),
    );
  }

  // --- Trin 2: udstyr -------------------------------------------------------------

  function renderEquipment() {
    $('equipment').replaceChildren(
      ...data.catalog.equipment.map((item) => {
        const selected = draft.equipment.includes(item.id);
        return el(
          'button',
          {
            type: 'button',
            class: 'choice',
            'aria-pressed': String(selected),
            onclick: () => {
              draft.equipment = selected
                ? draft.equipment.filter((id) => id !== item.id)
                : [...draft.equipment, item.id];
              renderEquipment();
              updateCount();
            },
          },
          [
            el('span', {
              html: `<svg class="equip-icon" viewBox="0 0 24 24" aria-hidden="true">${EQUIPMENT_ICONS[item.id] || ''}</svg>`,
            }),
            el('span', { class: 'choice-title', text: item.name }),
            el('span', { class: 'choice-text', text: item.description }),
            el('span', { class: 'choice-mark', html: CHECK_ICON }),
          ],
        );
      }),
    );
  }

  async function updateCount() {
    counts = await api.countExercises(draft);
    $('exercise-count').replaceChildren(
      el('b', { text: `${counts.wholeBody} øvelser` }),
      ' passer til dit niveau og dit udstyr.',
    );
    renderFocus();
  }

  // --- Trin 3: fokus --------------------------------------------------------------

  function focusFigure(key) {
    const [name, frame] = FOCUS_FIGURES[key];
    const anim = window.ANIMATIONS[name];
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'focus-figure');
    svg.setAttribute('aria-hidden', 'true');
    window.Figure.renderFrame(svg, anim, window.Figure.keyframeTimes(anim)[frame]);
    return svg;
  }

  function focusCountText(n) {
    if (n == null) return '';
    if (n === 0) return 'Ingen øvelser med dit udstyr';
    return n === 1 ? '1 øvelse med dit udstyr' : `${n} øvelser med dit udstyr`;
  }

  function renderFocus() {
    const wholeBody = draft.focus.length === 0;
    const allCard = el(
      'button',
      {
        type: 'button',
        class: 'choice focus-choice',
        'aria-pressed': String(wholeBody),
        onclick: () => {
          draft.focus = [];
          renderFocus();
          updateCount();
        },
      },
      [
        focusFigure('all'),
        el('span', { class: 'choice-title', text: 'Hele kroppen' }),
        el('span', { class: 'choice-text', text: 'Lidt af det hele – appen skifter selv mellem områderne.' }),
        el('span', { class: 'choice-example', text: focusCountText(counts && counts.wholeBody) }),
        el('span', { class: 'choice-mark', html: CHECK_ICON }),
      ],
    );

    const areaCards = data.catalog.focusAreas.map((area) => {
      const selected = draft.focus.includes(area.id);
      const n = counts && counts.byFocus[area.id];
      return el(
        'button',
        {
          type: 'button',
          class: 'choice focus-choice',
          'aria-pressed': String(selected),
          onclick: () => {
            draft.focus = selected ? draft.focus.filter((id) => id !== area.id) : [...draft.focus, area.id];
            renderFocus();
            updateCount();
          },
        },
        [
          focusFigure(area.id),
          el('span', { class: 'choice-title', text: area.name }),
          el('span', { class: 'choice-text', text: area.description }),
          el('span', { class: n === 0 ? 'choice-example warn' : 'choice-example', text: focusCountText(n) }),
          el('span', { class: 'choice-mark', html: CHECK_ICON }),
        ],
      );
    });
    $('focus').replaceChildren(allCard, ...areaCards);

    if (!counts) return;
    const chosen = data.catalog.focusAreas.filter((area) => draft.focus.includes(area.id)).map((a) => a.name);
    const label = chosen.length ? chosen.join(' + ') : 'hele kroppen';
    $('focus-count').replaceChildren(
      ...(counts.total === 0
        ? [
            el('b', { class: 'warn', text: 'Ingen øvelser passer. ' }),
            'Vælg mere udstyr eller et andet fokus – indtil da får du øvelser til hele kroppen.',
          ]
        : [el('b', { text: `${counts.total} øvelser` }), ` til ${label}.`]),
    );
  }

  // --- Trin 4: pauser -------------------------------------------------------------

  function renderFrequency() {
    $('frequency').replaceChildren(
      ...data.catalog.frequencies.map((f) =>
        el(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(draft.minMinutesBetween === f.minutes),
            title: f.description,
            onclick: () => {
              draft.minMinutesBetween = f.minutes;
              renderFrequency();
            },
          },
          [el('b', { text: f.name }), el('small', { text: `${f.minutes} min.` })],
        ),
      ),
    );
  }

  function renderIdle() {
    $('idle-toggle').checked = draft.useIdleDetection;
    $('idle-seconds').value = draft.idleSeconds;
    $('idle-out').textContent = `${draft.idleSeconds} sek.`;
    $('idle-row').hidden = !draft.useIdleDetection;
  }

  function renderCorners() {
    for (const button of $('corners').querySelectorAll('button')) {
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(button.dataset.corner === draft.overlayPosition));
    }
  }

  function renderToggles() {
    $('sound-toggle').checked = draft.sound;
    $('login-toggle').checked = draft.openAtLogin;
    // Linux understøtter ikke "start ved login" gennem Electron.
    $('login-row').hidden = data.platform !== 'win32' && data.platform !== 'darwin';
  }

  // --- Trin 5: spil -------------------------------------------------------------------

  function integrationText(status) {
    if (status.installed) return { text: 'Installeret – virker næste gang du starter spillet.', ok: true };
    if (status.found) return { text: 'Spillet er fundet. Klar til installation.' };
    return { text: 'Blev ikke fundet automatisk – du kan selv vælge spillets mappe.' };
  }

  function renderIntegrations() {
    $('integrations').replaceChildren(
      ...data.catalog.integrations.map((integration) => {
        const status = data.integrations[integration.id] || { found: false, installed: false };
        const info = integrationText(status);
        const message = el('small', { class: info.ok ? 'ok' : '', text: info.text });
        const button = el('button', {
          type: 'button',
          class: 'btn small',
          text: status.installed ? 'Installér igen' : 'Installér',
          onclick: async () => {
            button.disabled = true;
            button.textContent = 'Installerer…';
            const result = await api.installIntegration(integration.id);
            if (result.ok) {
              data.integrations[integration.id] = result.status;
              renderIntegrations();
              setStatus(`${integration.name}: ${result.note}`);
              return;
            }
            button.disabled = false;
            button.textContent = status.installed ? 'Installér igen' : 'Installér';
            if (result.reason === 'wrong-folder') {
              message.textContent = 'Det ligner ikke spillets mappe. Vælg mappen, der indeholder undermappen "game".';
            } else if (result.reason === 'write-failed') {
              message.textContent = `Kunne ikke skrive filen: ${result.message}`;
            }
          },
        });
        return el('div', { class: 'integration' }, [
          el('div', { class: 'info' }, [el('b', { text: integration.name }), message]),
          button,
        ]);
      }),
    );
    $('gsi-error').hidden = !data.gsiError;
    $('gsi-error').textContent = data.gsiError
      ? `Integrationen kan ikke modtage data: ${data.gsiError} Luk det program, der bruger porten, og genstart Workoutslop.`
      : '';
  }

  function renderKnownGames() {
    $('known-games').replaceChildren(
      ...data.catalog.games.map((game) =>
        el('span', { class: 'chip' }, [game.precise ? el('span', { class: 'chip-dot' }) : null, game.name]),
      ),
    );
  }

  function renderCustomGames() {
    const list = $('custom-games');
    if (draft.customGames.length === 0) {
      list.replaceChildren(el('li', { class: 'empty', text: 'Ingen egne spil tilføjet endnu.' }));
      return;
    }
    list.replaceChildren(
      ...draft.customGames.map((game, index) =>
        el('li', {}, [
          el('span', {}, [game.name, ' ', el('small', { text: game.process })]),
          el('button', {
            type: 'button',
            class: 'btn small ghost',
            text: 'Fjern',
            onclick: () => {
              draft.customGames.splice(index, 1);
              renderCustomGames();
            },
          }),
        ]),
      ),
    );
  }

  function addCustomGame() {
    const input = $('custom-process');
    const processName = input.value.trim();
    if (!processName) {
      input.focus();
      return;
    }
    const exists = draft.customGames.some((g) => g.process.toLowerCase() === processName.toLowerCase());
    if (!exists) {
      const name = processName
        .split(/[\\/]/)
        .pop()
        .replace(/\.exe$/i, '');
      draft.customGames.push({ name, process: processName });
      setStatus(`${name} er tilføjet.`);
    }
    input.value = '';
    renderCustomGames();
  }

  async function findProcesses() {
    const button = $('refresh-processes');
    button.disabled = true;
    const names = await api.listProcesses();
    button.disabled = false;
    $('process-list').replaceChildren(...names.map((name) => el('option', { value: name })));
    setStatus(`Fandt ${names.length} kørende programmer – klik i feltet og vælg dit spil.`);
    $('custom-process').focus();
  }

  function renderHotkeys() {
    $('hotkeys').replaceChildren(
      ...data.hotkeys.flatMap((hotkey) => [
        el('dt', {}, [el('kbd', { text: hotkey.label })]),
        el('dd', {
          class: hotkey.registered ? '' : 'bad',
          text: hotkey.registered ? hotkey.description : `${hotkey.description} (bruges allerede af et andet program)`,
        }),
      ]),
    );
  }

  // --- Navigation ---------------------------------------------------------------------

  function goTo(next) {
    step = Math.max(0, Math.min(STEP_COUNT - 1, next));
    furthest = Math.max(furthest, step);
    for (const section of document.querySelectorAll('.step')) section.hidden = Number(section.dataset.step) !== step;

    for (const button of $('nav').querySelectorAll('button')) {
      const index = Number(button.dataset.step);
      if (index === step) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
      button.classList.toggle('done', index < furthest && index !== step);
      button.disabled = data.firstRun && index > furthest;
    }

    const last = step === STEP_COUNT - 1;
    $('back').hidden = step === 0;
    $('next').hidden = last;
    $('next').classList.toggle('primary', data.firstRun);
    $('save').hidden = data.firstRun && !last;
    $('save').textContent = data.firstRun ? 'Gem og start' : 'Gem';
    document.querySelector('.scroll').scrollTop = 0;
    setStatus('');
  }

  async function save() {
    $('save').disabled = true;
    setStatus('Gemmer…');
    const result = await api.save(draft);
    if (!result || !result.ok) {
      $('save').disabled = false;
      setStatus('Kunne ikke gemme. Prøv igen.');
    }
  }

  async function preview() {
    const result = await api.preview(draft);
    if (result.ok) setStatus('Eksemplet vises nu i hjørnet af skærmen.');
    else if (result.reason === 'busy') setStatus('Der vises allerede en øvelse – gør den færdig først.');
    else setStatus('Kunne ikke vise et eksempel.');
  }

  function bindEvents() {
    for (const button of $('nav').querySelectorAll('button')) {
      button.addEventListener('click', () => goTo(Number(button.dataset.step)));
    }
    $('back').addEventListener('click', () => goTo(step - 1));
    $('next').addEventListener('click', () => goTo(step + 1));
    $('save').addEventListener('click', save);
    $('preview').addEventListener('click', preview);

    $('idle-toggle').addEventListener('change', (e) => {
      draft.useIdleDetection = e.target.checked;
      renderIdle();
    });
    $('idle-seconds').addEventListener('input', (e) => {
      draft.idleSeconds = Number(e.target.value);
      renderIdle();
    });
    for (const button of $('corners').querySelectorAll('button')) {
      button.addEventListener('click', () => {
        draft.overlayPosition = button.dataset.corner;
        renderCorners();
      });
    }
    $('sound-toggle').addEventListener('change', (e) => {
      draft.sound = e.target.checked;
    });
    $('login-toggle').addEventListener('change', (e) => {
      draft.openAtLogin = e.target.checked;
    });

    $('add-game').addEventListener('click', addCustomGame);
    $('custom-process').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addCustomGame();
    });
    $('refresh-processes').addEventListener('click', findProcesses);
  }

  async function init() {
    data = await api.get();
    draft = JSON.parse(JSON.stringify(data.settings));
    furthest = data.firstRun ? 0 : STEP_COUNT - 1;

    renderLevels();
    renderEquipment();
    updateCount();
    renderFrequency();
    renderIdle();
    renderCorners();
    renderToggles();
    renderIntegrations();
    renderKnownGames();
    renderCustomGames();
    renderHotkeys();
    bindEvents();
    goTo(0);
  }

  init();
})();
