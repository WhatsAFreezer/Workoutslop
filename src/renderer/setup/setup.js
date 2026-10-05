(() => {
  'use strict';

  const api = window.workoutslop.setup;
  const $ = (id) => document.getElementById(id);
  const STEP_COUNT = 6;

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
  let view = 'step'; // 'overview' eller 'step'

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
    renderPlan();
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

  // --- Trin 4: øvelser og sæt -----------------------------------------------------

  const setsLabel = (n) => (n === 0 ? 'Trænes ikke' : n === 1 ? '1 sæt/dag' : `${n} sæt/dag`);

  async function renderPlan() {
    const plan = await api.plan(draft);
    if (!plan) return;

    let totalSets = 0;
    let totalExercises = 0;
    const cards = plan.groups.map((group) => {
      const enabled = group.exercises.filter((ex) => ex.enabled);
      const active = group.sets > 0 && enabled.length > 0;
      if (active) {
        totalSets += group.sets;
        totalExercises += enabled.length;
      }

      const setSets = (n) => {
        draft.setsPerDay[group.id] = n;
        updateCount();
      };
      const stepper = el('div', { class: 'stepper' }, [
        el('button', {
          type: 'button',
          text: '−',
          'aria-label': `Færre sæt for ${group.name}`,
          ...(group.sets <= 0 ? { disabled: '' } : {}),
          onclick: () => setSets(group.sets - 1),
        }),
        el('output', { text: setsLabel(group.sets) }),
        el('button', {
          type: 'button',
          text: '+',
          'aria-label': `Flere sæt for ${group.name}`,
          ...(group.sets >= plan.maxSets ? { disabled: '' } : {}),
          onclick: () => setSets(group.sets + 1),
        }),
      ]);

      let note = `${enabled.length} af ${group.exercises.length} øvelser valgt`;
      let noteClass = '';
      if (group.sets > 0 && enabled.length === 0) {
        note = 'Vælg mindst én øvelse – ellers trænes muskelgruppen ikke.';
        noteClass = 'warn';
      }

      const chips = group.exercises.map((ex) =>
        el(
          'button',
          {
            type: 'button',
            class: 'exercise-chip',
            'aria-pressed': String(ex.enabled),
            title: ex.enabled ? 'Klik for at fravælge' : 'Klik for at vælge',
            onclick: () => {
              draft.disabledExercises = ex.enabled
                ? [...draft.disabledExercises, ex.id]
                : draft.disabledExercises.filter((id) => id !== ex.id);
              updateCount();
            },
          },
          [el('span', { class: 'tick', html: CHECK_ICON }), ex.name, el('small', { text: ex.amount })],
        ),
      );

      return el('section', { class: group.sets > 0 ? 'muscle' : 'muscle off' }, [
        el('div', { class: 'muscle-head' }, [
          el('div', {}, [el('h2', { text: group.name }), el('small', { class: noteClass, text: note })]),
          stepper,
        ]),
        group.sets > 0 ? el('div', { class: 'exercise-chips' }, chips) : null,
      ]);
    });

    $('muscles').replaceChildren(...cards);
    $('plan-summary').replaceChildren(
      ...(totalSets === 0
        ? [el('b', { class: 'warn', text: 'Ingen sæt valgt. ' }), 'Giv mindst én muskelgruppe nogle sæt.']
        : [el('b', { text: `${totalSets} sæt om dagen` }), ` fordelt på ${totalExercises} øvelser.`]),
    );
  }

  // --- Trin 5: pauser -------------------------------------------------------------

  const SPEAK_OPTIONS = [
    { id: 'never', name: 'Aldrig' },
    { id: 'fullscreen', name: 'I fuldskærm', small: 'når overlayet ikke ses' },
    { id: 'always', name: 'Altid' },
  ];

  function renderSpeak() {
    $('speak').replaceChildren(
      ...SPEAK_OPTIONS.map((option) =>
        el(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(draft.speak === option.id),
            onclick: () => {
              draft.speak = option.id;
              renderSpeak();
            },
          },
          [el('b', { text: option.name }), option.small ? el('small', { text: option.small }) : null],
        ),
      ),
    );
    const doneHotkey = data.hotkeys.find((h) => h.id === 'done');
    $('speak-hotkey').textContent = doneHotkey ? doneHotkey.label : '';
    $('controller-hint').textContent = data.native.gamepads
      ? 'Xbox-kompatible controllere tæller også som aktivitet.'
      : 'Controller-input kan kun aflæses på Windows. Spiller du med controller her, så slå inaktivitet fra.';
  }

  async function testSpeech() {
    if (!window.Speech.supported) {
      $('speak-status').textContent = 'Oplæsning understøttes ikke på denne computer.';
      return;
    }
    const voice = await window.Speech.speak('Armbøjninger. 12 gentagelser. Tryk kontrol, alt, D, når du er færdig.');
    $('speak-status').textContent = voice
      ? `Stemme: ${voice}`
      : 'Ingen dansk stemme fundet. Installér dansk tale under Windows-indstillinger › Tid og sprog › Tale.';
  }

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
    $('focus-toggle').checked = draft.useFocusDetection;
    // Kun på Windows kan Workoutslop se, om spillet er i forgrunden.
    $('focus-row').hidden = !data.native.foregroundWindow;
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

  // --- Trin 6: spil -------------------------------------------------------------------

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

  // --- Opdateringer ------------------------------------------------------------------

  function renderUpdate(update) {
    $('app-version').textContent = `Workoutslop ${data.version}`;
    $('update-text').textContent = update.text;
    const button = $('update-btn');
    button.hidden = update.state === 'dev';
    button.disabled = update.state === 'checking' || update.state === 'downloading';
    button.textContent = update.state === 'ready' ? 'Genstart og opdatér' : 'Søg efter opdateringer';
    button.classList.toggle('primary', update.state === 'ready');
    button.onclick = () => (update.state === 'ready' ? api.installUpdate() : api.checkUpdates());
  }

  // --- Fundne spil (trin 6) ---------------------------------------------------------

  function gameRow(game, buttons) {
    return el('li', {}, [el('span', {}, [game.name, ' ', el('small', { text: game.process })]), ...buttons]);
  }

  function renderFoundGames() {
    $('found-field').hidden = !data.native.foregroundWindow;
    const { autoGames, gameSuggestions } = data.games;
    const act = async (action, game) => {
      data.games = await api.updateGames(action, game.process);
      renderFoundGames();
    };
    $('auto-games').replaceChildren(
      ...(autoGames.length === 0
        ? [el('li', { class: 'empty', text: 'Ingen endnu – start et spil, så dukker det op her.' })]
        : autoGames.map((game) =>
            gameRow(game, [
              el('button', {
                type: 'button',
                class: 'btn small ghost',
                text: 'Ikke et spil',
                onclick: () => act('remove', game),
              }),
            ]),
          )),
    );
    $('suggestions-wrap').hidden = gameSuggestions.length === 0;
    $('game-suggestions').replaceChildren(
      ...gameSuggestions.map((game) =>
        gameRow(game, [
          el('button', { type: 'button', class: 'btn small', text: 'Ja, tilføj', onclick: () => act('accept', game) }),
          el('button', { type: 'button', class: 'btn small ghost', text: 'Nej', onclick: () => act('ignore', game) }),
        ]),
      ),
    );
  }

  // --- Oversigt ------------------------------------------------------------------------

  function showOverview() {
    view = 'overview';
    for (const section of document.querySelectorAll('.step')) section.hidden = section.dataset.step !== 'overview';
    for (const button of $('nav').querySelectorAll('button')) {
      button.removeAttribute('aria-current');
      button.disabled = false;
      button.classList.remove('done');
    }
    $('nav-overview').hidden = false;
    $('nav-heading').hidden = false;
    $('nav-overview').setAttribute('aria-current', 'page');
    document.querySelector('.footer').hidden = true;
    document.querySelector('.scroll').scrollTop = 0;
    refreshOverview();
  }

  async function refreshOverview() {
    const status = await api.status();
    if (!status) return;
    $('ov-tone').dataset.tone = status.tone;
    $('ov-title').textContent = status.title;
    $('ov-subtitle').textContent = status.subtitle;
    $('ov-now').textContent = `Vis en øvelse nu (${status.hotkeyNow})`;
    $('ov-pause').textContent = status.snoozed ? 'Genoptag motion' : 'Sæt motion på pause i 1 time';
    $('ov-warning').hidden = !status.warning;
    $('ov-warning').textContent = status.warning || '';

    $('ov-signals').replaceChildren(
      ...status.signals.flatMap((signal) => [
        el('dt', { text: signal.label }),
        el('dd', { class: signal.warn ? 'warn' : '' }, [
          signal.value,
          signal.action &&
            el('button', {
              type: 'button',
              class: 'btn small ghost signal-action',
              text: signal.action.label,
              onclick: async () => {
                data.games = await api.updateGames('remove', signal.action.process);
                renderFoundGames();
                refreshOverview();
              },
            }),
        ]),
      ]),
    );

    const { today } = status;
    $('ov-done').textContent = today.done;
    $('ov-target').textContent = today.target ? `af ${today.target} sæt` : 'sæt';
    $('ov-meters').replaceChildren(
      ...(today.groups.length === 0
        ? [el('p', { class: 'empty-note', text: 'Ingen muskelgrupper har sæt i dag – vælg dem under Øvelser.' })]
        : today.groups.map((group) => {
            const fill = el('div', { class: 'meter-fill' });
            fill.style.width = `${group.target ? (group.done / group.target) * 100 : 0}%`;
            const done = group.done >= group.target;
            return el('div', { class: 'meter' }, [
              el('span', { text: group.name }),
              el('span', { class: 'meter-value', text: `${group.done}/${group.target}${done ? ' ✓' : ''}` }),
              el('div', { class: 'meter-track' }, [fill]),
            ]);
          })),
    );

    $('ov-streak').replaceChildren(
      ...(status.streak > 0
        ? [el('b', { text: status.streak === 1 ? '1 dag' : `${status.streak} dage` }), ' i træk med motion']
        : ['Ingen dage i træk endnu']),
    );
    renderWeekChart(status.week);
  }

  // Søjlediagram over sæt pr. dag. Én serie, så ingen forklaring – titlen siger det.
  function renderWeekChart(week) {
    const box = $('ov-chart');
    const width = box.clientWidth || 600;
    const height = box.clientHeight || 190;
    const pad = { top: 22, right: 8, bottom: 26, left: 28 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const maxSets = Math.max(...week.map((d) => d.sets), 1);
    const stepSize = [1, 2, 5, 10, 20, 50].find((s) => maxSets / s <= 4) || 100;
    const top = Math.ceil(maxSets / stepSize) * stepSize;
    const y = (v) => pad.top + plotH - (v / top) * plotH;
    const slot = plotW / week.length;
    const barW = Math.min(24, slot * 0.5);

    const NS = 'http://www.w3.org/2000/svg';
    const node = (tag, attrs, text) => {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      if (text != null) n.textContent = text;
      return n;
    };
    const svg = node('svg', {
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': 'Sæt pr. dag de sidste 7 dage',
    });

    for (let v = 0; v <= top; v += stepSize) {
      svg.append(node('line', { class: 'grid', x1: pad.left, x2: width - pad.right, y1: y(v), y2: y(v) }));
      svg.append(node('text', { class: 'tick', x: pad.left - 8, y: y(v) + 4, 'text-anchor': 'end' }, String(v)));
    }

    const tip = el('div', { class: 'chart-tip', hidden: '' });
    const base = y(0);
    week.forEach((day, i) => {
      const cx = pad.left + slot * i + slot / 2;
      const x = cx - barW / 2;
      const h = base - y(day.sets);
      const isToday = i === week.length - 1;
      let col = null;
      if (day.sets > 0) {
        // Afrundet top (4 px), firkantet ved bunden.
        const r = Math.min(4, h, barW / 2);
        const t = base - h;
        const d = `M${x},${base} V${t + r} A${r},${r} 0 0 1 ${x + r},${t} H${x + barW - r} A${r},${r} 0 0 1 ${x + barW},${t + r} V${base} Z`;
        col = node('path', { class: 'col', d });
        svg.append(col);
      }
      if (isToday) {
        svg.append(node('text', { class: 'value', x: cx, y: base - h - 6, 'text-anchor': 'middle' }, String(day.sets)));
      }
      svg.append(
        node(
          'text',
          { class: `day${isToday ? ' today' : ''}`, x: cx, y: height - 6, 'text-anchor': 'middle' },
          day.label,
        ),
      );

      // Stort, usynligt område til hover – hele søjlens plads.
      const hit = node('rect', { class: 'hit', x: pad.left + slot * i, y: pad.top, width: slot, height: plotH });
      const dateText = new Date(day.date).toLocaleDateString('da-DK', {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
      });
      hit.addEventListener('mouseenter', () => {
        col?.classList.add('active');
        tip.textContent = `${dateText}: ${day.sets} sæt`;
        tip.style.left = `${cx}px`;
        tip.style.top = `${base - h}px`;
        tip.hidden = false;
      });
      hit.addEventListener('mouseleave', () => {
        col?.classList.remove('active');
        tip.hidden = true;
      });
      svg.append(hit);
    });
    box.replaceChildren(svg, tip);

    // Tabel til skærmlæsere med de samme tal.
    $('ov-table').replaceChildren(
      el('caption', { text: 'Sæt pr. dag de sidste 7 dage' }),
      ...week.map((day) =>
        el('tr', {}, [
          el('th', { scope: 'row', text: new Date(day.date).toLocaleDateString('da-DK') }),
          el('td', { text: String(day.sets) }),
        ]),
      ),
    );
  }

  // --- Navigation ---------------------------------------------------------------------

  function goTo(next) {
    view = 'step';
    step = Math.max(0, Math.min(STEP_COUNT - 1, next));
    furthest = Math.max(furthest, step);
    for (const section of document.querySelectorAll('.step')) section.hidden = section.dataset.step !== String(step);
    $('nav-overview').removeAttribute('aria-current');
    document.querySelector('.footer').hidden = false;

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
    $('save').disabled = false;
    if (!result || !result.ok) {
      setStatus('Kunne ikke gemme. Prøv igen.');
      return;
    }
    data.firstRun = false;
    showOverview();
    const note = $('ov-saved');
    note.hidden = false;
    clearTimeout(note.timer);
    note.timer = setTimeout(() => (note.hidden = true), 4000);
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

    $('nav-overview').addEventListener('click', showOverview);
    $('ov-now').addEventListener('click', () => api.exerciseNow());
    $('ov-pause').addEventListener('click', async () => {
      const status = await api.status();
      if (status.snoozed) api.resume();
      else api.pauseFor(60);
      setTimeout(refreshOverview, 200);
    });
    $('focus-toggle').addEventListener('change', (e) => {
      draft.useFocusDetection = e.target.checked;
    });
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

    $('speak-test').addEventListener('click', testSpeech);
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
    renderSpeak();
    renderCorners();
    renderToggles();
    renderIntegrations();
    renderKnownGames();
    renderCustomGames();
    renderFoundGames();
    renderHotkeys();
    renderUpdate(data.update);
    api.onUpdateStatus(renderUpdate);
    bindEvents();
    if (data.firstRun) goTo(0);
    else showOverview();
    // Oversigten opdateres løbende, mens den vises.
    setInterval(() => view === 'overview' && refreshOverview(), 2000);
  }

  init();
})();
