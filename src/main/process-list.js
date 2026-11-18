'use strict';

const { execFile } = require('node:child_process');
const { parseTasklistEntries, parsePsOutput } = require('../core/games');
const windowsNative = require('./windows-native');

// Henter alle kørende programmer som [{ name, pid }] (pid kun på Windows).
// En tom liste betyder, at de ikke kunne læses.
//
// På Windows læses listen direkte fra systemet (hurtigt). Virker det ikke, bruges
// `tasklist` – det tager længere tid og starter et program hver gang.
function listProcesses() {
  if (process.platform === 'win32') {
    const native = windowsNative.processList();
    if (native) return Promise.resolve(native);
  }
  return new Promise((resolve) => {
    const options = { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 10000 };
    if (process.platform === 'win32') {
      execFile('tasklist', ['/fo', 'csv', '/nh'], options, (err, stdout) =>
        resolve(err ? [] : parseTasklistEntries(stdout)),
      );
    } else {
      execFile('ps', ['-A', '-o', 'comm='], options, (err, stdout) =>
        resolve(err ? [] : parsePsOutput(stdout).map((name) => ({ name, pid: null }))),
      );
    }
  });
}

module.exports = { listProcesses };
