'use strict';

function startOfDay(timestamp) {
  const d = new Date(timestamp);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Opsummerer dagens gennemførte øvelser, fx til bakkemenuen og overlayet.
function todaySummary(history, now, exercises) {
  const from = startOfDay(now);
  const byId = new Map();
  let count = 0;
  for (const entry of history) {
    if (entry.status !== 'done' || entry.at < from || entry.at > now) continue;
    count++;
    const row = byId.get(entry.exerciseId) || { id: entry.exerciseId, total: 0, unit: entry.unit };
    row.total += entry.amount;
    byId.set(entry.exerciseId, row);
  }
  const names = new Map(exercises.map((ex) => [ex.id, ex.name]));
  const items = [...byId.values()]
    .map((row) => ({ ...row, name: names.get(row.id) || row.id }))
    .sort((a, b) => b.total - a.total);
  return { count, items };
}

const DAY_NAMES = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'];

// Antal gennemførte sæt pr. dag de sidste `days` dage (ældste først, i dag sidst).
function setsByDay(history, now, days = 7) {
  const today = startOfDay(now);
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const from = d.getTime();
    const next = new Date(from);
    next.setDate(next.getDate() + 1);
    const sets = history.filter((h) => h.status === 'done' && h.at >= from && h.at < next.getTime()).length;
    result.push({ date: from, label: i === 0 ? 'i dag' : DAY_NAMES[d.getDay()], sets });
  }
  return result;
}

// Antal dage i træk med mindst én øvelse. Har man ikke trænet i dag endnu,
// tæller rækken fra i går, så den ikke "brydes" midt på dagen.
function streakDays(history, now) {
  const doneDays = new Set(history.filter((h) => h.status === 'done' && h.at <= now).map((h) => startOfDay(h.at)));
  const day = new Date(startOfDay(now));
  if (!doneDays.has(day.getTime())) day.setDate(day.getDate() - 1);
  let streak = 0;
  while (doneDays.has(day.getTime())) {
    streak++;
    day.setDate(day.getDate() - 1);
  }
  return streak;
}

function describeToday(summary) {
  if (summary.count === 0) return 'Ingen øvelser i dag endnu';
  return summary.count === 1 ? '1 øvelse i dag' : `${summary.count} øvelser i dag`;
}

module.exports = { startOfDay, todaySummary, describeToday, setsByDay, streakDays };
