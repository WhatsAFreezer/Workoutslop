'use strict';

// Styrkeniveauer man kan vælge i opsætningen. Id'et bruges som indeks i
// øvelsernes `amounts`-lister (niveau 1 = første tal).
const LEVELS = [
  { id: 1, name: 'Begynder', description: 'Jeg træner sjældent eller er lige begyndt.' },
  { id: 2, name: 'Let øvet', description: 'Jeg er aktiv af og til og kan tage et par armbøjninger.' },
  { id: 3, name: 'Øvet', description: 'Jeg træner fast et par gange om ugen.' },
  { id: 4, name: 'Stærk', description: 'Jeg træner meget og vil gerne udfordres.' },
];

// Redskaber man kan have derhjemme. Kropsvægtsøvelser kræver ingen af dem.
const EQUIPMENT = [
  { id: 'dumbbells', name: 'Håndvægte', description: 'Et par håndvægte i en vægt, du kan styre.' },
  { id: 'kettlebell', name: 'Kettlebell', description: 'En kettlebell til swings og squats.' },
  { id: 'bench', name: 'Træningsbænk', description: 'Eller en stabil stol/kasse uden hjul.' },
  { id: 'pullupBar', name: 'Pull-up bar', description: 'I dørkarmen eller på væggen.' },
  { id: 'resistanceBand', name: 'Elastikker', description: 'Træningselastik / modstandsbånd.' },
  { id: 'barbell', name: 'Vægtstang (bar)', description: 'Stang med vægtskiver til curls, roning og pres.' },
];

// Hvor ofte brugeren højst vil have en øvelse.
const FREQUENCIES = [
  { minutes: 5, name: 'Tit', description: 'Højst hvert 5. minut' },
  { minutes: 10, name: 'Normalt', description: 'Højst hvert 10. minut' },
  { minutes: 20, name: 'Sjældnere', description: 'Højst hvert 20. minut' },
  { minutes: 30, name: 'Sjældent', description: 'Højst hver halve time' },
];

// Muskelgruppen vises på overlayet og bruges til at give variation.
const MUSCLE_GROUPS = {
  chest: 'Bryst, skuldre & triceps',
  shoulders: 'Skuldre',
  back: 'Ryg',
  posture: 'Holdning & øvre ryg',
  neck: 'Nakke',
  biceps: 'Biceps',
  triceps: 'Triceps',
  legs: 'Ben & balder',
  core: 'Mave & core',
  cardio: 'Kondition',
};

// Det brugeren kan vælge at træne. Flere kan kombineres, fx "Bryst & skuldre" + "Arme".
// En øvelse hører til et område via sin muskelgruppe (groups) eller via `extraFocus`.
const FOCUS_AREAS = [
  {
    id: 'chestShoulders',
    name: 'Bryst & skuldre',
    description: 'Armbøjninger, bænkpres, skulderpres og sideløft.',
    groups: ['chest', 'shoulders'],
  },
  {
    id: 'backPosture',
    name: 'Ryg, nakke & holdning',
    description: 'Roning, pull-ups, nakkeøvelser og øvelser mod "gamer-holdning".',
    groups: ['back', 'posture', 'neck'],
  },
  {
    id: 'legsAbs',
    name: 'Ben & mave',
    description: 'Squats, udfald, planke, mavebøjninger og kondition.',
    groups: ['legs', 'core', 'cardio'],
  },
  {
    id: 'arms',
    name: 'Arme',
    description: 'Biceps curls, preacher curls, dips og triceps.',
    groups: ['biceps', 'triceps'],
  },
];

const OVERLAY_POSITIONS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];

module.exports = { LEVELS, EQUIPMENT, FREQUENCIES, MUSCLE_GROUPS, FOCUS_AREAS, OVERLAY_POSITIONS };
