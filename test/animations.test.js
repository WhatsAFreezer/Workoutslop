'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Figure = require('../src/renderer/shared/figure');
const ANIMATIONS = require('../src/renderer/shared/animations');
const { EXERCISES } = require('../src/core/exercises');

const { DIM } = Figure;
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

function samples(anim) {
  const result = [];
  for (let t = 0; t < 12000; t += 97)
    result.push(
      Figure.sampleAnimation(
        anim,
        anim.frames.map((f) => Figure.solvePose(f, anim.view)),
        t,
      ),
    );
  return result;
}

test('alle øvelser har en animation', () => {
  for (const ex of EXERCISES) assert.ok(ANIMATIONS[ex.animation], `${ex.id} -> ${ex.animation}`);
});

test('lemmerne beholder deres længde gennem hele animationen', () => {
  for (const [name, anim] of Object.entries(ANIMATIONS)) {
    for (const s of samples(anim)) {
      for (const arm of s.arms) {
        assert.ok(Math.abs(dist(arm.root, arm.joint) - DIM.upperArm) < 0.01, `${name}: overarm`);
        assert.ok(Math.abs(dist(arm.joint, arm.end) - DIM.foreArm) < 0.01, `${name}: underarm`);
      }
      for (const leg of s.legs) {
        assert.ok(Math.abs(dist(leg.root, leg.joint) - DIM.thigh) < 0.01, `${name}: lår`);
        assert.ok(Math.abs(dist(leg.joint, leg.end) - DIM.shin) < 0.01, `${name}: underben`);
      }
    }
  }
});

test('figuren holder sig inden for billedet og over gulvet', () => {
  for (const [name, anim] of Object.entries(ANIMATIONS)) {
    const [x, y, w, h] = (anim.viewBox || Figure.fitViewBox(anim)).split(' ').map(Number);
    for (const s of samples(anim)) {
      const points = [
        s.hip,
        s.neck,
        ...s.arms.flatMap((a) => [a.joint, a.end]),
        ...s.legs.flatMap((l) => [l.joint, l.end, l.toe]),
      ];
      for (const p of points) {
        assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]), `${name}: ugyldigt punkt`);
        assert.ok(p[0] > x && p[0] < x + w, `${name}: x=${p[0].toFixed(1)} uden for billedet`);
        assert.ok(p[1] > y && p[1] < y + h, `${name}: y=${p[1].toFixed(1)} uden for billedet`);
        assert.ok(p[1] <= Figure.FLOOR_Y + 1, `${name}: under gulvet (y=${p[1].toFixed(1)})`);
      }
      assert.ok(s.head[1] - DIM.headR > y, `${name}: hovedet er skåret af`);
    }
  }
});

test('markup kan genereres for alle animationer', () => {
  for (const [name, anim] of Object.entries(ANIMATIONS)) {
    const s = Figure.solvePose(anim.frames[0], anim.view);
    const markup = Figure.figureMarkup(anim, s);
    assert.ok(markup.includes('fig-head'), name);
    assert.ok(!markup.includes('NaN'), name);
  }
});
