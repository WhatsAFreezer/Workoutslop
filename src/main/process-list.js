'use strict';

const { execFile } = require('node:child_process');
const { parseTasklistEntries, parsePsOutput } = require('../core/games');

// Henter alle kørende programmer som [{ name, pid }] (pid kun på Windows).
// En tom liste betyder, at de ikke kunne læses.
function listProcesses() {
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
