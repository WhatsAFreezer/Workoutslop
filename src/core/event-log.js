'use strict';

// Hændelseslog til fejlfinding: hvad Workoutslop har registreret og gjort de
// seneste minutter. Holdes kun i hukommelsen og forsvinder, når appen lukkes.

class EventLog {
  constructor(max = 300) {
    this.max = max;
    this.items = [];
  }

  // Samme besked flere gange i træk tælles op i stedet for at fylde loggen.
  add(text, at = Date.now()) {
    const last = this.items[this.items.length - 1];
    if (last && last.text === text) {
      last.count += 1;
      last.at = at;
      return;
    }
    this.items.push({ at, text, count: 1 });
    if (this.items.length > this.max) this.items.shift();
  }

  // Nyeste først.
  list() {
    return this.items.map((item) => ({ ...item })).reverse();
  }
}

const pad = (n) => String(n).padStart(2, '0');

function formatTime(at) {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatEntry(entry) {
  return `${formatTime(entry.at)}  ${entry.text}${entry.count > 1 ? ` (×${entry.count})` : ''}`;
}

// Rapport som tekst, så den kan kopieres og sendes.
// sections: [{ title, rows: [[label, value], ...] }], log: EventLog.list()
function formatReport({ title, sections, log }) {
  const lines = [title, ''];
  for (const section of sections) {
    lines.push(`## ${section.title}`);
    for (const [label, value] of section.rows) lines.push(`${label}: ${value}`);
    lines.push('');
  }
  lines.push('## Hændelser (nyeste først)');
  if (log.length === 0) lines.push('Ingen endnu.');
  for (const entry of log) lines.push(formatEntry(entry));
  return lines.join('\n');
}

module.exports = { EventLog, formatTime, formatReport };
