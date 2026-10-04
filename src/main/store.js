'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalizeSettings } = require('../core/settings');

const MAX_HISTORY = 5000;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Skriver først til en midlertidig fil, så en halvt skrevet fil aldrig overskriver den gamle.
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// Gemmer indstillinger og træningshistorik som JSON i appens datamappe.
function createStore(dir) {
  const settingsFile = path.join(dir, 'settings.json');
  const historyFile = path.join(dir, 'history.json');

  let settings = normalizeSettings(readJson(settingsFile, {}));
  let history = readJson(historyFile, []);
  if (!Array.isArray(history)) history = [];
  history = history.filter((h) => h && Number.isFinite(h.at) && typeof h.exerciseId === 'string');

  return {
    get settings() {
      return settings;
    },
    get history() {
      return history;
    },
    saveSettings(next) {
      settings = normalizeSettings(next);
      writeJson(settingsFile, settings);
      return settings;
    },
    addHistory(entry) {
      history.push(entry);
      if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
      writeJson(historyFile, history);
    },
  };
}

module.exports = { createStore };
