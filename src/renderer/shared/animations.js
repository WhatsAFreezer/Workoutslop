/*
 * Animationer til alle øvelser. Hver animation har:
 *   view:      'side' (set fra siden, ansigt mod højre) eller 'front'
 *   frames:    poser som animationen glider imellem (se figure.js)
 *   props:     ting der tegnes med: gulv, bænk, stang, håndvægte, elastik ...
 *   tempo:     millisekunder pr. bevægelse (eller `durations` pr. bevægelse)
 *   hold:      pause ved hver pose (eller `holds` pr. pose)
 *   viewBox:   (valgfri) fast udsnit – ellers zoomes der automatisk ind på bevægelsen
 *
 * Koordinater: gulvet ligger ved y=150, og en ankel/krop der hviler på
 * gulvet har sit centrum ved y=146.
 */
(function (global) {
  'use strict';

  const F = 146;
  const L = 144; // kropscentrum når man ligger ned

  const floor = { type: 'floor' };

  const rad = (d) => (d * Math.PI) / 180;
  const at = (p, angle, len) => [p[0] + Math.cos(rad(angle)) * len, p[1] + Math.sin(rad(angle)) * len];

  // En flade parallelt med en kropsdel og lidt under den (skråbænk, preacher-pude).
  function padUnder(start, angle, from, to, offset, legs) {
    const normal = angle + 90;
    return {
      type: 'board',
      from: at(at(start, angle, from), normal, offset),
      to: at(at(start, angle, to), normal, offset),
      legs,
    };
  }

  // Lige krop fra anklen og op i en given vinkel (armbøjninger, planke osv.).
  // Hoften drejer rundt om anklen, så benene forbliver strakte undervejs.
  function straightBody(ankle, angle) {
    return { hip: { pivot: ankle, angle: -angle, dist: 70 }, torso: -angle };
  }

  const standing = (x = 120) => ({
    hip: [x, 76],
    torso: -90,
    arm: { a: 93, b: 92 },
    arm2: { a: 87, b: 88 },
    leg: { to: [x + 1, F], bend: -1 },
    leg2: { to: [x - 1, F], bend: -1 },
  });

  const PUSH_ANKLE = [50, 141];
  const PUSH_HANDS = { to: [153, 145], bend: 1 };
  const pushTop = { ...straightBody(PUSH_ANKLE, 22), arm: PUSH_HANDS, leg: { to: PUSH_ANKLE, bend: -1 } };
  const pushBottom = { ...straightBody(PUSH_ANKLE, 6), arm: PUSH_HANDS, leg: { to: PUSH_ANKLE, bend: -1 } };
  const INCLINE_ANKLE = [60, 141];
  // Midt i hoppet mellem squat og armbøjningsposition (fødderne er i luften).
  const BURPEE_HOP = { hip: [116, 104], torso: -10, arm: PUSH_HANDS, leg: { to: [88, 126], bend: -1 } };
  const KNEE = [80, 146];

  // Hængende i en stang (pull-ups m.m.).
  const BAR = [138, -2];
  const hang = {
    hip: [128.6, 96],
    torso: -92,
    head: -98,
    arm: { to: [138, 0], bend: 1 },
    leg: { a: 100, b: 165 },
    leg2: { a: 96, b: 168 },
  };
  const pullTop = { ...hang, hip: [123.6, 52], head: -92 };

  // Liggende på maven på en skråbænk (Y-løft, roning på skråbænk).
  const PRONE_HIP = [100, 110];
  const prone = { hip: PRONE_HIP, torso: -35, leg: { to: [54, 140], bend: -1 } };
  const proneBench = padUnder(PRONE_HIP, -35, -22, 40, 7, [92, 130]);

  // Siddende på en bænk med overarmen på en skrå pude (preacher curls).
  const PREACHER_HIP = [92, 112];
  const preacherPad = padUnder(at(PREACHER_HIP, -80, 46), 48, 2, 30, 6, [115]);

  // Liggende på ryggen på en bænk med hovedet ud over kanten (nakkecurls).
  const NECK_CURL_NECK = [132, 104];
  const neckCurlPose = (headAngle) => {
    const head = at(NECK_CURL_NECK, headAngle, 13);
    return {
      hip: [86, 104],
      torso: 0,
      head: headAngle,
      arm: { to: at(head, headAngle - 70, 10), bend: -1 }, // hænderne holder vægten på panden
      leg: { to: [56, F], bend: 1, foot: 0 },
    };
  };

  const curlDown = { ...standing(), arm: { a: 94, b: 94 }, arm2: { a: 86, b: 86 } };
  const curlUp = { ...standing(), arm: { a: 94, b: -60 }, arm2: { a: 86, b: -66 } };

  const ANIMATIONS = {
    pushup: {
      view: 'side',
      props: [floor],
      frames: [pushTop, pushBottom],
      tempo: 900,
      hold: 150,
    },

    kneePushup: {
      view: 'side',
      props: [floor],
      frames: [
        {
          hip: { pivot: KNEE, angle: -34, dist: 36 },
          torso: -34,
          arm: { to: [150, 145], bend: 1 },
          leg: { to: [48, 134.4], bend: -1, foot: 200 },
        },
        {
          hip: { pivot: KNEE, angle: -11, dist: 36 },
          torso: -11,
          arm: { to: [150, 145], bend: 1 },
          leg: { to: [48, 134.4], bend: -1, foot: 200 },
        },
      ],
      tempo: 900,
    },

    inclinePushup: {
      view: 'side',
      props: [floor, { type: 'bench', x: 140, w: 80, top: 112 }],
      frames: [
        { ...straightBody(INCLINE_ANKLE, 46), arm: { to: [152, 108], bend: 1 }, leg: { to: INCLINE_ANKLE, bend: -1 } },
        { ...straightBody(INCLINE_ANKLE, 26), arm: { to: [152, 108], bend: 1 }, leg: { to: INCLINE_ANKLE, bend: -1 } },
      ],
      tempo: 900,
    },

    squat: {
      view: 'side',
      props: [floor],
      frames: [
        {
          hip: [120, 77],
          torso: -88,
          arm: { a: 0, b: 0 },
          arm2: { a: 4, b: 4 },
          leg: { to: [122, F], bend: -1 },
          leg2: { to: [118, F], bend: -1 },
        },
        {
          hip: [98, 110],
          torso: -48,
          head: -70,
          arm: { a: -8, b: -8 },
          arm2: { a: -4, b: -4 },
          leg: { to: [122, F], bend: -1 },
          leg2: { to: [118, F], bend: -1 },
        },
      ],
      tempo: 1000,
      hold: 150,
    },

    gobletSquat: {
      view: 'side',
      props: [floor, { type: 'dumbbell', on: 'hand0' }],
      frames: [
        {
          hip: [120, 77],
          torso: -88,
          arm: { to: [137, 33], bend: 1 },
          leg: { to: [122, F], bend: -1 },
          leg2: { to: [118, F], bend: -1 },
        },
        {
          hip: [98, 110],
          torso: -48,
          head: -70,
          arm: { to: [139, 88], bend: 1 },
          leg: { to: [122, F], bend: -1 },
          leg2: { to: [118, F], bend: -1 },
        },
      ],
      tempo: 1100,
    },

    lunge: {
      view: 'side',
      props: [floor],
      frames: [
        {
          hip: [117, 84],
          torso: -90,
          arm: { a: 92, b: 90 },
          leg: { to: [148, F], bend: -1 },
          leg2: { to: [88, 140], bend: -1, foot: 70 },
        },
        {
          hip: [113, 106],
          torso: -90,
          arm: { a: 92, b: 90 },
          leg: { to: [148, F], bend: -1 },
          leg2: { to: [88, 140], bend: -1, foot: 70 },
        },
      ],
      tempo: 1000,
    },

    splitSquat: {
      view: 'side',
      props: [floor, { type: 'bench', x: 20, w: 72, top: 116 }],
      frames: [
        {
          hip: [126, 82],
          torso: -88,
          arm: { a: 92, b: 90 },
          leg: { to: [150, F], bend: -1 },
          leg2: { to: [78, 108], bend: -1, foot: 175 },
        },
        {
          hip: [122, 104],
          torso: -84,
          arm: { a: 92, b: 90 },
          leg: { to: [150, F], bend: -1 },
          leg2: { to: [78, 108], bend: -1, foot: 175 },
        },
      ],
      tempo: 1100,
    },

    stepUp: {
      view: 'side',
      props: [floor, { type: 'bench', x: 128, w: 90, top: 116 }],
      frames: [
        {
          hip: [112, 80],
          torso: -84,
          arm: { a: 80, b: 80 },
          arm2: { a: 100, b: 100 },
          leg: { to: [150, 112], bend: -1 },
          leg2: { to: [95, F], bend: -1 },
        },
        {
          hip: [145, 46],
          torso: -90,
          arm: { a: 100, b: 100 },
          arm2: { a: 82, b: 82 },
          leg: { to: [150, 112], bend: -1 },
          leg2: { to: [122, 104], bend: -1 },
        },
      ],
      tempo: 1000,
      hold: 200,
    },

    plank: {
      view: 'side',
      props: [floor],
      frames: [
        { ...straightBody(PUSH_ANKLE, 10.9), arm: { a: 90, b: 0 }, leg: { to: PUSH_ANKLE, bend: -1 } },
        { ...straightBody(PUSH_ANKLE, 11.8), arm: { a: 88, b: 0 }, leg: { to: PUSH_ANKLE, bend: -1 } },
      ],
      tempo: 1800,
      hold: 300,
    },

    jumpingJack: {
      view: 'front',
      props: [floor],
      frames: [
        {
          hip: [120, 76],
          torso: -90,
          arm: { a: 100, b: 96 },
          arm2: { a: 80, b: 84 },
          leg: { a: 93, b: 92 },
          leg2: { a: 87, b: 88 },
        },
        {
          hip: [120, 70],
          torso: -90,
          arm: { a: -125, b: -110 },
          arm2: { a: -55, b: -70 },
          leg: { a: 108, b: 106 },
          leg2: { a: 72, b: 74 },
        },
      ],
      tempo: 420,
      hold: 60,
    },

    mountainClimber: {
      view: 'side',
      props: [floor],
      frames: [
        { ...pushTop, leg: { to: [112, 132], bend: -1 }, leg2: { to: PUSH_ANKLE, bend: -1 } },
        { ...pushTop, leg: { to: PUSH_ANKLE, bend: -1 }, leg2: { to: [112, 132], bend: -1 } },
      ],
      tempo: 320,
      hold: 40,
    },

    gluteBridge: {
      view: 'side',
      props: [floor],
      frames: [
        {
          hip: { pivot: [60, L], angle: 0, dist: 46 },
          torso: 180,
          head: 195,
          arm: { a: 0, b: 0 },
          leg: { to: [155, F], bend: -1, foot: 0 },
        },
        {
          hip: { pivot: [60, L], angle: -35, dist: 46 },
          torso: 145,
          head: 195,
          arm: { a: 0, b: 0 },
          leg: { to: [155, F], bend: -1, foot: 0 },
        },
      ],
      tempo: 1000,
      holds: [150, 450],
    },

    crunch: {
      view: 'side',
      props: [floor],
      frames: [
        { hip: [106, L], torso: 180, head: 195, arm: { a: -8, b: -8 }, leg: { to: [155, F], bend: -1, foot: 0 } },
        { hip: [106, L], torso: -150, head: -140, arm: { a: -8, b: -8 }, leg: { to: [155, F], bend: -1, foot: 0 } },
      ],
      tempo: 800,
      holds: [150, 300],
    },

    superman: {
      view: 'side',
      props: [floor],
      frames: [
        { hip: [100, L], torso: 0, head: -15, arm: { a: 0, b: 0 }, leg: { a: 180, b: 180, foot: 180 } },
        { hip: [100, L], torso: -10, head: -22, arm: { a: -14, b: -14 }, leg: { a: 192, b: 192, foot: 190 } },
      ],
      tempo: 900,
      holds: [150, 600],
    },

    wallSit: {
      view: 'side',
      props: [floor, { type: 'wall', x: 70 }],
      frames: [
        { hip: [77, 112], torso: -90, arm: { a: 70, b: 10 }, leg: { a: 0, b: 90 } },
        { hip: [77, 113], torso: -90, arm: { a: 71, b: 11 }, leg: { a: 1, b: 90 } },
      ],
      tempo: 1800,
      hold: 300,
    },

    calfRaise: {
      view: 'side',
      props: [floor],
      frames: [
        { ...standing(), leg: { to: [121, F], bend: -1, foot: 0 }, leg2: { to: [119, F], bend: -1, foot: 0 } },
        {
          ...standing(),
          hip: [120, 68],
          leg: { to: [121, 138], bend: -1, foot: 62 },
          leg2: { to: [119, 138], bend: -1, foot: 62 },
        },
      ],
      tempo: 700,
      holds: [150, 350],
    },

    burpee: {
      view: 'side',
      props: [floor],
      frames: [
        // Stå
        { hip: [126, 76], torso: -90, arm: { to: [127, 82], bend: 1 }, leg: { to: [128, F], bend: -1 } },
        // Squat med hænderne i gulvet
        { hip: [112, 118], torso: -25, arm: PUSH_HANDS, leg: { to: [130, F], bend: -1, foot: 0 } },
        // Hop fødderne bagud
        BURPEE_HOP,
        // Armbøjningsposition
        { ...pushTop, leg: { to: PUSH_ANKLE, bend: -1 } },
        // Hop fødderne frem igen
        BURPEE_HOP,
        // Tilbage i squat
        { hip: [112, 118], torso: -25, arm: PUSH_HANDS, leg: { to: [130, F], bend: -1, foot: 0 } },
        // Stå
        { hip: [126, 76], torso: -90, arm: { to: [127, 82], bend: 1 }, leg: { to: [128, F], bend: -1 } },
        // Hop med armene over hovedet
        { hip: [126, 64], torso: -90, arm: { to: [131, -28], bend: 1 }, leg: { to: [128, 134], bend: -1 } },
      ],
      durations: [420, 220, 220, 220, 220, 420, 420, 420],
      holds: [60, 60, 0, 120, 0, 60, 60, 60],
    },

    pullup: {
      view: 'side',
      props: [{ type: 'bar', at: BAR }],
      frames: [hang, pullTop],
      durations: [900, 1100],
      holds: [200, 250],
    },

    negativePullup: {
      view: 'side',
      props: [{ type: 'bar', at: BAR }],
      frames: [hang, pullTop],
      durations: [500, 3000],
      holds: [350, 200],
    },

    deadHang: {
      view: 'side',
      props: [{ type: 'bar', at: BAR }],
      frames: [hang, { ...hang, hip: [128.4, 97], leg: { a: 97, b: 167 }, leg2: { a: 94, b: 170 } }],
      tempo: 1600,
      hold: 200,
    },

    hangingKneeRaise: {
      view: 'side',
      props: [{ type: 'bar', at: [138, -18] }],
      frames: [
        {
          hip: [128.6, 80],
          torso: -92,
          head: -98,
          arm: { to: [138, -16], bend: 1 },
          leg: { a: 93, b: 92 },
          leg2: { a: 91, b: 90 },
        },
        {
          hip: [128.6, 80],
          torso: -96,
          head: -98,
          arm: { to: [138, -16], bend: 1 },
          leg: { a: -15, b: 80 },
          leg2: { a: -12, b: 84 },
        },
      ],
      tempo: 1000,
      holds: [200, 300],
    },

    bicepCurl: {
      view: 'side',
      props: [floor, { type: 'dumbbell', on: 'hand1', far: true }, { type: 'dumbbell', on: 'hand0' }],
      frames: [curlDown, curlUp],
      tempo: 900,
    },

    bandCurl: {
      view: 'side',
      props: [floor, { type: 'band', from: 'ankle0', to: 'hand0' }],
      frames: [curlDown, curlUp],
      tempo: 900,
    },

    dumbbellRow: {
      view: 'side',
      props: [floor, { type: 'dumbbell', on: 'hand0' }],
      frames: [
        {
          hip: [95, 84],
          torso: -25,
          arm: { to: [138, 115], bend: 1 },
          arm2: { to: [121, 104], bend: 1 },
          leg: { to: [115, F], bend: -1 },
          leg2: { to: [111, F], bend: -1 },
        },
        {
          hip: [95, 84],
          torso: -25,
          arm: { to: [126, 80], bend: 1 },
          arm2: { to: [121, 104], bend: 1 },
          leg: { to: [115, F], bend: -1 },
          leg2: { to: [111, F], bend: -1 },
        },
      ],
      tempo: 850,
      holds: [150, 250],
    },

    shoulderPress: {
      view: 'front',
      props: [floor, { type: 'dumbbell', on: 'hand0' }, { type: 'dumbbell', on: 'hand1' }],
      frames: [
        {
          hip: [120, 76],
          torso: -90,
          arm: { a: 175, b: -95 },
          arm2: { a: 5, b: -85 },
          leg: { a: 95, b: 93 },
          leg2: { a: 85, b: 87 },
        },
        {
          hip: [120, 76],
          torso: -90,
          arm: { a: -105, b: -95 },
          arm2: { a: -75, b: -85 },
          leg: { a: 95, b: 93 },
          leg2: { a: 85, b: 87 },
        },
      ],
      tempo: 900,
    },

    lateralRaise: {
      view: 'front',
      props: [floor, { type: 'dumbbell', on: 'hand0' }, { type: 'dumbbell', on: 'hand1' }],
      frames: [
        {
          hip: [120, 76],
          torso: -90,
          arm: { a: 100, b: 97 },
          arm2: { a: 80, b: 83 },
          leg: { a: 95, b: 93 },
          leg2: { a: 85, b: 87 },
        },
        {
          hip: [120, 76],
          torso: -90,
          arm: { a: 178, b: 175 },
          arm2: { a: 2, b: 5 },
          leg: { a: 95, b: 93 },
          leg2: { a: 85, b: 87 },
        },
      ],
      tempo: 900,
      holds: [150, 250],
    },

    benchPress: {
      view: 'side',
      props: [floor, { type: 'bench', x: 72, w: 100, top: 108 }, { type: 'dumbbell', on: 'hand0' }],
      frames: [
        { hip: [96, 104], torso: 0, head: 0, arm: { to: [126, 98], bend: -1 }, leg: { to: [66, F], bend: 1, foot: 0 } },
        { hip: [96, 104], torso: 0, head: 0, arm: { to: [142, 53], bend: -1 }, leg: { to: [66, F], bend: 1, foot: 0 } },
      ],
      tempo: 900,
    },

    benchDip: {
      view: 'side',
      props: [floor, { type: 'bench', x: 30, w: 70, top: 112 }],
      frames: [
        { hip: [97.4, 103], torso: -88, arm: { to: [96, 108], bend: 1 }, leg: { to: [150, F], bend: -1 } },
        { hip: [99.4, 128], torso: -88, arm: { to: [96, 108], bend: 1 }, leg: { to: [150, F], bend: -1 } },
      ],
      tempo: 900,
    },

    kettlebellSwing: {
      view: 'side',
      props: [floor, { type: 'kettlebell' }],
      frames: [
        {
          hip: [96, 86],
          torso: -28,
          arm: { a: 115, b: 115 },
          leg: { to: [124, F], bend: -1 },
          leg2: { to: [118, F], bend: -1 },
        },
        {
          hip: [118, 77],
          torso: -90,
          arm: { a: 7, b: 7 },
          leg: { to: [124, F], bend: -1 },
          leg2: { to: [118, F], bend: -1 },
        },
      ],
      durations: [550, 750],
      hold: 80,
    },

    bandPullApart: {
      view: 'front',
      props: [floor, { type: 'band', from: 'hand0', to: 'hand1' }],
      frames: [
        {
          hip: [120, 76],
          torso: -90,
          arm: { to: [114, 44], bend: 1 },
          arm2: { to: [126, 44], bend: -1 },
          leg: { a: 95, b: 93 },
          leg2: { a: 85, b: 87 },
        },
        {
          hip: [120, 76],
          torso: -90,
          arm: { to: [58, 32], bend: 1 },
          arm2: { to: [182, 32], bend: -1 },
          leg: { a: 95, b: 93 },
          leg2: { a: 85, b: 87 },
        },
      ],
      tempo: 900,
      holds: [150, 250],
    },

    chinTuck: {
      view: 'side',
      props: [floor, { type: 'bench', x: 78, w: 48, top: 116 }],
      frames: [
        // Fra "gamer-holdning" med hovedet skudt frem ...
        { hip: [100, 112], torso: -80, head: -50, arm: { to: [126, 107], bend: 1 }, leg: { a: 0, b: 90 } },
        // ... til rank ryg og hagen trukket bagud.
        { hip: [100, 112], torso: -92, head: -112, arm: { to: [124, 107], bend: 1 }, leg: { a: 0, b: 90 } },
      ],
      tempo: 700,
      holds: [300, 1400],
    },

    wallAngel: {
      view: 'front',
      props: [floor],
      frames: [
        {
          hip: [120, 76],
          torso: -90,
          arm: { a: 180, b: -90 },
          arm2: { a: 0, b: -90 },
          leg: { a: 95, b: 93 },
          leg2: { a: 85, b: 87 },
        },
        {
          hip: [120, 76],
          torso: -90,
          arm: { a: -118, b: -108 },
          arm2: { a: -62, b: -72 },
          leg: { a: 95, b: 93 },
          leg2: { a: 85, b: 87 },
        },
      ],
      tempo: 1400,
      hold: 200,
    },

    neckCurl: {
      view: 'side',
      props: [floor, { type: 'bench', x: 40, w: 98, top: 108 }, { type: 'dumbbell', on: 'hand0' }],
      frames: [neckCurlPose(40), neckCurlPose(-55)],
      tempo: 900,
      holds: [150, 300],
    },

    neckExtension: {
      view: 'side',
      props: [floor, { type: 'bench', x: 50, w: 102, top: 108 }],
      frames: [
        {
          hip: [110, 104],
          torso: 0,
          head: 65,
          arm: { to: [148, 140], bend: 1 },
          leg: { a: 180, b: 180, foot: 180 },
        },
        {
          hip: [110, 104],
          torso: 0,
          head: -20,
          arm: { to: [148, 140], bend: 1 },
          leg: { a: 180, b: 180, foot: 180 },
        },
      ],
      tempo: 900,
      holds: [150, 300],
    },

    proneYRaise: {
      view: 'side',
      props: [floor, proneBench, { type: 'dumbbell', on: 'hand1', far: true }, { type: 'dumbbell', on: 'hand0' }],
      frames: [
        { ...prone, arm: { a: 92, b: 92 }, arm2: { a: 88, b: 88 } },
        { ...prone, arm: { a: -35, b: -35 }, arm2: { a: -38, b: -38 } },
      ],
      tempo: 1000,
      holds: [150, 400],
    },

    chestSupportedRow: {
      view: 'side',
      props: [floor, proneBench, { type: 'dumbbell', on: 'hand1', far: true }, { type: 'dumbbell', on: 'hand0' }],
      frames: [
        { ...prone, arm: { to: [136, 134], bend: 1 } },
        { ...prone, arm: { to: [124, 98], bend: 1 } },
      ],
      tempo: 850,
      holds: [150, 300],
    },

    preacherCurl: {
      view: 'side',
      props: [
        floor,
        { type: 'bench', x: 60, w: 54, top: 116 },
        preacherPad,
        { type: 'dumbbell', on: 'hand1', far: true },
        { type: 'dumbbell', on: 'hand0' },
      ],
      frames: [
        { hip: PREACHER_HIP, torso: -80, arm: { a: 48, b: 62 }, leg: { to: [128, F], bend: -1 } },
        { hip: PREACHER_HIP, torso: -80, arm: { a: 48, b: -95 }, leg: { to: [128, F], bend: -1 } },
      ],
      tempo: 950,
      holds: [150, 250],
    },

    barbellCurl: {
      view: 'side',
      props: [floor, { type: 'plate', on: 'hand0' }],
      frames: [curlDown, curlUp],
      tempo: 950,
    },

    barbellRow: {
      view: 'side',
      props: [floor, { type: 'plate', on: 'hand0' }],
      frames: [
        {
          hip: [95, 84],
          torso: -25,
          arm: { to: [137, 118], bend: 1 },
          leg: { to: [115, F], bend: -1 },
          leg2: { to: [111, F], bend: -1 },
        },
        {
          hip: [95, 84],
          torso: -25,
          arm: { to: [116, 92], bend: 1 },
          leg: { to: [115, F], bend: -1 },
          leg2: { to: [111, F], bend: -1 },
        },
      ],
      tempo: 850,
      holds: [150, 250],
    },

    overheadPress: {
      view: 'side',
      props: [floor, { type: 'plate', on: 'hand0' }],
      frames: [
        { ...standing(), arm: { to: [131, 30], bend: 1 } },
        { ...standing(), arm: { to: [123, -20], bend: 1 } },
      ],
      tempo: 900,
    },

    romanianDeadlift: {
      view: 'side',
      props: [floor, { type: 'plate', on: 'hand0' }],
      frames: [
        {
          hip: [120, 76],
          torso: -90,
          arm: { to: [124, 84], bend: 1 },
          leg: { to: [122, F], bend: -1 },
          leg2: { to: [118, F], bend: -1 },
        },
        {
          hip: [96, 82],
          torso: -20,
          arm: { to: [137, 116], bend: 1 },
          leg: { to: [122, F], bend: -1 },
          leg2: { to: [118, F], bend: -1 },
        },
      ],
      tempo: 1100,
      holds: [150, 250],
    },

    barbellBenchPress: {
      view: 'side',
      props: [floor, { type: 'bench', x: 72, w: 100, top: 108 }, { type: 'plate', on: 'hand0' }],
      frames: [
        { hip: [96, 104], torso: 0, head: 0, arm: { to: [126, 98], bend: -1 }, leg: { to: [66, F], bend: 1, foot: 0 } },
        { hip: [96, 104], torso: 0, head: 0, arm: { to: [142, 53], bend: -1 }, leg: { to: [66, F], bend: 1, foot: 0 } },
      ],
      tempo: 950,
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = ANIMATIONS;
  else global.ANIMATIONS = ANIMATIONS;
})(typeof window !== 'undefined' ? window : globalThis);
