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
];

// Hvor ofte brugeren højst vil have en øvelse.
const FREQUENCIES = [
  { minutes: 5, name: 'Tit', description: 'Højst hvert 5. minut' },
  { minutes: 10, name: 'Normalt', description: 'Højst hvert 10. minut' },
  { minutes: 20, name: 'Sjældnere', description: 'Højst hvert 20. minut' },
  { minutes: 30, name: 'Sjældent', description: 'Højst hver halve time' },
];

const MUSCLE_GROUPS = {
  push: 'Bryst, skuldre & triceps',
  pull: 'Ryg & biceps',
  legs: 'Ben & balder',
  core: 'Mave & core',
  cardio: 'Kondition',
};

const OVERLAY_POSITIONS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];

module.exports = { LEVELS, EQUIPMENT, FREQUENCIES, MUSCLE_GROUPS, OVERLAY_POSITIONS };
