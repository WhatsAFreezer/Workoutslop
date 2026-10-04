'use strict';

const { execFile } = require('node:child_process');
const { parseTasklistCsv, parsePsOutput } = require('../core/games');

// Henter navnene på alle kørende programmer.
function listProcesses() {
  return new Promise((resolve) => {
    const options = { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 10000 };
    if (process.platform === 'win32') {
      execFile('tasklist', ['/fo', 'csv', '/nh'], options, (err, stdout) =>
        resolve(err ? [] : parseTasklistCsv(stdout)),
      );
    } else {
      execFile('ps', ['-A', '-o', 'comm='], options, (err, stdout) => resolve(err ? [] : parsePsOutput(stdout)));
    }
  });
}

module.exports = { listProcesses };
