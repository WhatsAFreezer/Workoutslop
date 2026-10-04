/*
 * Tegner og animerer en tændstikmand, der viser, hvordan en øvelse udføres.
 *
 * En "pose" beskriver kroppen:
 *   hip:   [x, y]   hoftens placering – eller { pivot: [x, y], angle, dist },
 *                    så hoften drejer rundt om et fast punkt (fx fødderne i en armbøjning)
 *   torso: grader   retningen fra hofte til skuldre (-90 = lige op)
 *   head:  grader   (valgfri) retningen fra skuldre til hoved
 *   arm / arm2 / leg / leg2: lemmer, enten som
 *     { a, b }          absolutte vinkler for øverste og nederste del, eller
 *     { to, bend }      et mål for hånd/ankel – albue/knæ udregnes (invers kinematik)
 *   leg kan også have `foot` (vinkel på foden), og arm kan have `hand` (vinkel på hånden,
 *   så man kan se håndleddet bøje – fx i håndledscurls).
 *
 * Vinkler er i grader, hvor 0 = mod højre og 90 = nedad (SVG-koordinater).
 * Animationen glider mellem poserne, og lemmerne beholder deres længde.
 */
(function (global) {
  'use strict';

  const DIM = {
    torso: 46,
    neck: 13,
    headR: 9,
    upperArm: 27,
    foreArm: 25,
    thigh: 36,
    shin: 34,
    foot: 9,
    hand: 8,
    shoulderHalf: 11,
    hipHalf: 7,
  };
  const FLOOR_Y = 150;
  const ASPECT = 1.6; // bredde/højde på tegnefladen
  const MIN_VIEW_WIDTH = 176; // så små bevægelser (fx planke) ikke bliver zoomet for meget ind

  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const move = (p, angle, len) => [p[0] + Math.cos(rad(angle)) * len, p[1] + Math.sin(rad(angle)) * len];
  const angleBetween = (p, q) => deg(Math.atan2(q[1] - p[1], q[0] - p[0]));
  const distance = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
  const lerp = (a, b, t) => a + (b - a) * t;
  const lerpPoint = (p, q, t) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t)];

  // Interpolerer ad den korteste vej rundt (fx fra 170° til -170° via 180°).
  function lerpAngle(a, b, t) {
    const diff = ((((b - a) % 360) + 540) % 360) - 180;
    return a + diff * t;
  }

  function solveLimb(root, spec, l1, l2) {
    if (spec.to) {
      const d = clamp(distance(root, spec.to), Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.01);
      const base = angleBetween(root, spec.to);
      const cos = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
      const upper = base + (spec.bend ?? 1) * deg(Math.acos(clamp(cos, -1, 1)));
      const joint = move(root, upper, l1);
      const lower = angleBetween(joint, spec.to);
      return { joint, end: move(joint, lower, l2), upper, lower };
    }
    const upper = spec.a;
    const lower = spec.b ?? spec.a;
    const joint = move(root, upper, l1);
    return { joint, end: move(joint, lower, l2), upper, lower };
  }

  const hipPoint = (hip) => (Array.isArray(hip) ? hip : move(hip.pivot, hip.angle, hip.dist));

  function lerpHip(a, b, t) {
    if (!Array.isArray(a) && !Array.isArray(b) && a.pivot[0] === b.pivot[0] && a.pivot[1] === b.pivot[1]) {
      return { pivot: a.pivot, angle: lerpAngle(a.angle, b.angle, t), dist: lerp(a.dist, b.dist, t) };
    }
    return lerpPoint(hipPoint(a), hipPoint(b), t);
  }

  function solvePose(pose, view) {
    const front = view === 'front';
    const hip = hipPoint(pose.hip);
    const neck = move(hip, pose.torso, DIM.torso);
    const head = move(neck, pose.head ?? pose.torso, DIM.neck);
    const sx = front ? DIM.shoulderHalf : 0;
    const hx = front ? DIM.hipHalf : 0;
    const shoulders = [
      [neck[0] - sx, neck[1]],
      [neck[0] + sx, neck[1]],
    ];
    const hips = [
      [hip[0] - hx, hip[1]],
      [hip[0] + hx, hip[1]],
    ];

    const armSpecs = [pose.arm, pose.arm2 ?? pose.arm];
    const legSpecs = [pose.leg, pose.leg2 ?? pose.leg];

    const arms = armSpecs.map((spec, i) => {
      const limb = solveLimb(shoulders[i], spec, DIM.upperArm, DIM.foreArm);
      const grip = spec.hand != null ? move(limb.end, spec.hand, DIM.hand) : null;
      return { root: shoulders[i], ...limb, handAngle: spec.hand ?? limb.lower, grip };
    });
    const legs = legSpecs.map((spec, i) => {
      const limb = solveLimb(hips[i], spec, DIM.thigh, DIM.shin);
      const footAngle = spec.foot ?? (front ? (i === 0 ? 180 : 0) : limb.lower - 90);
      const toe = move(limb.end, footAngle, front ? 5 : DIM.foot);
      return { root: hips[i], ...limb, footAngle, toe };
    });

    return { view: front ? 'front' : 'side', hip, neck, head, shoulders, hips, arms, legs };
  }

  function lerpLimb(a, b, t, solvedA, solvedB, isLeg) {
    let result;
    if (a.to && b.to) {
      result = { to: lerpPoint(a.to, b.to, t), bend: a.bend };
    } else if (!a.to && !b.to) {
      result = { a: lerpAngle(a.a, b.a, t), b: lerpAngle(a.b ?? a.a, b.b ?? b.a, t) };
    } else {
      // Forskellig beskrivelse i de to poser: brug de udregnede vinkler.
      result = { a: lerpAngle(solvedA.upper, solvedB.upper, t), b: lerpAngle(solvedA.lower, solvedB.lower, t) };
    }
    // Fod (ben) eller hånd (arm), hvis en af poserne angiver den.
    const [key, solvedKey] = isLeg ? ['foot', 'footAngle'] : ['hand', 'handAngle'];
    if (a[key] != null || b[key] != null) {
      result[key] = lerpAngle(a[key] ?? solvedA[solvedKey], b[key] ?? solvedB[solvedKey], t);
    }
    return result;
  }

  function lerpPose(A, B, sA, sB, t) {
    const pose = {
      hip: lerpHip(A.hip, B.hip, t),
      torso: lerpAngle(A.torso, B.torso, t),
      arm: lerpLimb(A.arm, B.arm, t, sA.arms[0], sB.arms[0], false),
      arm2: lerpLimb(A.arm2 ?? A.arm, B.arm2 ?? B.arm, t, sA.arms[1], sB.arms[1], false),
      leg: lerpLimb(A.leg, B.leg, t, sA.legs[0], sB.legs[0], true),
      leg2: lerpLimb(A.leg2 ?? A.leg, B.leg2 ?? B.leg, t, sA.legs[1], sB.legs[1], true),
    };
    if (A.head != null || B.head != null) pose.head = lerpAngle(A.head ?? A.torso, B.head ?? B.torso, t);
    return pose;
  }

  // --- Tegning ---------------------------------------------------------------

  const f = (n) => n.toFixed(1);
  const path = (points) => 'M' + points.map((p) => `${f(p[0])} ${f(p[1])}`).join(' L');

  function pointRef(s, ref) {
    const index = Number(ref.slice(-1)) || 0;
    const kind = ref.replace(/\d$/, '');
    switch (kind) {
      case 'hand':
        return s.arms[index].end;
      case 'grip':
        return s.arms[index].grip || s.arms[index].end;
      case 'elbow':
        return s.arms[index].joint;
      case 'ankle':
        return s.legs[index].end;
      case 'toe':
        return s.legs[index].toe;
      case 'knee':
        return s.legs[index].joint;
      case 'neck':
        return s.neck;
      default:
        return s.hip;
    }
  }

  function propMarkup(prop, s) {
    switch (prop.type) {
      case 'floor':
        return `<line class="fig-floor" x1="-60" y1="${FLOOR_Y + 1}" x2="320" y2="${FLOOR_Y + 1}"/>`;
      case 'bench': {
        const { x, w, top } = prop;
        const legY = FLOOR_Y;
        return (
          `<g class="fig-prop">` +
          `<rect x="${x}" y="${top}" width="${w}" height="7" rx="2"/>` +
          `<line x1="${x + 8}" y1="${top + 7}" x2="${x + 8}" y2="${legY}"/>` +
          `<line x1="${x + w - 8}" y1="${top + 7}" x2="${x + w - 8}" y2="${legY}"/></g>`
        );
      }
      case 'wall':
        return `<line class="fig-prop fig-wall" x1="${prop.x}" y1="-40" x2="${prop.x}" y2="${FLOOR_Y}"/>`;
      case 'bar': {
        const [x, y] = prop.at;
        return (
          `<g class="fig-prop"><line x1="${x}" y1="${y - 4}" x2="${x}" y2="${y - 22}"/>` +
          `<circle class="fig-bar" cx="${x}" cy="${y}" r="4.5"/></g>`
        );
      }
      case 'dumbbell': {
        const [x, y] = pointRef(s, prop.on || 'hand0');
        return (
          `<g class="fig-weight${prop.far ? ' fig-far' : ''}"><circle cx="${f(x)}" cy="${f(y)}" r="7"/>` +
          `<circle class="fig-weight-hole" cx="${f(x)}" cy="${f(y)}" r="2.2"/></g>`
        );
      }
      case 'kettlebell': {
        const arm = s.arms[0];
        const c = move(arm.end, arm.lower, 10);
        return (
          `<g class="fig-weight"><line x1="${f(arm.end[0])}" y1="${f(arm.end[1])}" x2="${f(c[0])}" y2="${f(c[1])}"/>` +
          `<circle cx="${f(c[0])}" cy="${f(c[1])}" r="8"/></g>`
        );
      }
      case 'plate': {
        // Vægtstang set fra siden: vægtskiven ved hænderne.
        const [x, y] = pointRef(s, prop.on || 'hand0');
        return (
          `<g class="fig-weight"><circle cx="${f(x)}" cy="${f(y)}" r="11"/>` +
          `<circle class="fig-weight-hole" cx="${f(x)}" cy="${f(y)}" r="2.6"/></g>`
        );
      }
      case 'board': {
        // Skrå flade (skråbænk, preacher-pude) med ben ned til gulvet.
        const [x1, y1] = prop.from;
        const [x2, y2] = prop.to;
        const yAt = (x) => y1 + ((x - x1) / (x2 - x1)) * (y2 - y1);
        const legs = (prop.legs || [])
          .map((x) => `<line x1="${f(x)}" y1="${f(yAt(x))}" x2="${f(x)}" y2="${FLOOR_Y}"/>`)
          .join('');
        return (
          `<g class="fig-prop"><line class="fig-board" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>` +
          `${legs}</g>`
        );
      }
      case 'band': {
        const p = pointRef(s, prop.from);
        const q = pointRef(s, prop.to);
        return `<line class="fig-band" x1="${f(p[0])}" y1="${f(p[1])}" x2="${f(q[0])}" y2="${f(q[1])}"/>`;
      }
      default:
        return '';
    }
  }

  function limbMarkup(limb, extra, cls) {
    const points = [limb.root, limb.joint, limb.end];
    if (extra) points.push(extra);
    return `<path class="${cls}" d="${path(points)}"/>`;
  }

  function figureMarkup(anim, s) {
    const props = anim.props || [];
    const held = ['dumbbell', 'kettlebell', 'band', 'plate'];
    const behind = props.filter((p) => !held.includes(p.type));
    const front = props.filter((p) => held.includes(p.type) && !p.far);
    const farProps = props.filter((p) => p.far);
    const side = s.view === 'side';
    const farCls = side ? 'fig-limb fig-far' : 'fig-limb';

    let out = behind.map((p) => propMarkup(p, s)).join('');
    out += farProps.map((p) => propMarkup(p, s)).join('');
    out += limbMarkup(s.legs[1], s.legs[1].toe, farCls);
    out += limbMarkup(s.arms[1], s.arms[1].grip, farCls);
    if (!side) {
      out += `<path class="fig-limb" d="${path(s.shoulders)}"/><path class="fig-limb" d="${path(s.hips)}"/>`;
    }
    out += `<path class="fig-limb" d="${path([s.hip, s.neck])}"/>`;
    out += `<circle class="fig-head" cx="${f(s.head[0])}" cy="${f(s.head[1])}" r="${DIM.headR}"/>`;
    out += limbMarkup(s.legs[0], s.legs[0].toe, 'fig-limb');
    out += limbMarkup(s.arms[0], s.arms[0].grip, 'fig-limb');
    out += front.map((p) => propMarkup(p, s)).join('');
    return out;
  }

  // --- Afspilning --------------------------------------------------------------

  const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

  function timing(anim) {
    const durations = anim.frames.map((_, i) => (anim.durations && anim.durations[i]) || anim.tempo || 900);
    const holds = anim.frames.map((_, i) => (anim.holds && anim.holds[i] != null ? anim.holds[i] : (anim.hold ?? 150)));
    const total = durations.reduce((a, b) => a + b, 0) + holds.reduce((a, b) => a + b, 0);
    return { durations, holds, total };
  }

  // Tidspunkterne hvor animationen står i hver af sine nøgleposer.
  function keyframeTimes(anim) {
    const { durations, holds } = timing(anim);
    let t = 0;
    return anim.frames.map((_, i) => {
      const at = t;
      t += holds[i] + durations[i];
      return at;
    });
  }

  // Udregner hvilken pose animationen er i efter `elapsed` millisekunder.
  function sampleAnimation(anim, solvedFrames, elapsed) {
    const frames = anim.frames;
    const n = frames.length;
    if (n === 1) return solvedFrames[0];
    const { durations, holds, total } = timing(anim);
    let t = ((elapsed % total) + total) % total;
    for (let i = 0; i < n; i++) {
      if (t < holds[i]) return solvedFrames[i];
      t -= holds[i];
      if (t < durations[i]) {
        const j = (i + 1) % n;
        const pose = lerpPose(frames[i], frames[j], solvedFrames[i], solvedFrames[j], ease(t / durations[i]));
        return solvePose(pose, anim.view);
      }
      t -= durations[i];
    }
    return solvedFrames[0];
  }

  // Finder et udsnit, der viser hele bevægelsen (inkl. bænk, stang osv.) med lidt luft.
  function fitViewBox(anim, solvedFrames = anim.frames.map((f) => solvePose(f, anim.view))) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const include = (p, r = 0) => {
      minX = Math.min(minX, p[0] - r);
      maxX = Math.max(maxX, p[0] + r);
      minY = Math.min(minY, p[1] - r);
      maxY = Math.max(maxY, p[1] + r);
    };
    const handRoom = (anim.props || []).some((p) => p.type === 'plate') ? 12 : 8;
    const { total } = timing(anim);
    const steps = anim.frames.length === 1 ? 1 : 60;
    for (let i = 0; i < steps; i++) {
      const s = sampleAnimation(anim, solvedFrames, (total * i) / steps);
      include(s.head, DIM.headR);
      include(s.hip);
      include(s.neck);
      for (const arm of s.arms) {
        include(arm.joint);
        include(arm.end, handRoom); // plads til håndvægte og vægtskiver
        if (arm.grip) include(arm.grip, handRoom);
      }
      for (const leg of s.legs) {
        include(leg.joint);
        include(leg.end);
        include(leg.toe);
      }
    }
    const props = anim.props || [];
    for (const prop of props) {
      if (prop.type === 'bench') {
        include([prop.x, prop.top]);
        include([prop.x + prop.w, FLOOR_Y]);
      } else if (prop.type === 'board') {
        include(prop.from);
        include(prop.to);
        if (prop.legs && prop.legs.length) include([prop.legs[0], FLOOR_Y]);
      } else if (prop.type === 'bar') {
        include(prop.at, 8);
      }
    }

    const pad = 12;
    const width = Math.max(maxX - minX + pad * 2, (maxY - minY + pad * 2) * ASPECT, MIN_VIEW_WIDTH);
    const height = width / ASPECT;
    const x = (minX + maxX) / 2 - width / 2;
    // Med gulv: lås gulvet nær bunden. Ellers: centrér.
    const hasFloor = props.some((p) => p.type === 'floor');
    const y = hasFloor ? Math.max(maxY, FLOOR_Y) + 8 - height : (minY + maxY) / 2 - height / 2;
    return [x, y, width, height].map((n) => Math.round(n * 10) / 10).join(' ');
  }

  function prepare(svg, anim) {
    const solved = anim.frames.map((frame) => solvePose(frame, anim.view));
    svg.setAttribute('viewBox', anim.viewBox || fitViewBox(anim, solved));
    return solved;
  }

  function renderFrame(svg, anim, elapsed) {
    const solved = prepare(svg, anim);
    svg.innerHTML = figureMarkup(anim, sampleAnimation(anim, solved, elapsed));
  }

  function play(svg, anim) {
    const solved = prepare(svg, anim);
    let raf = null;
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const draw = (now) => {
      svg.innerHTML = figureMarkup(anim, sampleAnimation(anim, solved, now - start));
      raf = requestAnimationFrame(draw);
    };
    draw(start);
    return {
      stop() {
        if (raf != null) cancelAnimationFrame(raf);
      },
    };
  }

  const Figure = {
    DIM,
    FLOOR_Y,
    solvePose,
    lerpPose,
    lerpAngle,
    sampleAnimation,
    keyframeTimes,
    fitViewBox,
    figureMarkup,
    renderFrame,
    play,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Figure;
  else global.Figure = Figure;
})(typeof window !== 'undefined' ? window : globalThis);
