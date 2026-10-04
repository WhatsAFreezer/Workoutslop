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

function describeToday(summary) {
  if (summary.count === 0) return 'Ingen øvelser i dag endnu';
  return summary.count === 1 ? '1 øvelse i dag' : `${summary.count} øvelser i dag`;
}

module.exports = { startOfDay, todaySummary, describeToday };
