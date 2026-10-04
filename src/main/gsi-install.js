'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { INTEGRATIONS, CFG_FILE_NAME, buildCfg, parseLibraryFolders } = require('../core/gsi');

// Typiske steder Steam er installeret.
function steamRoots() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return [
      process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Steam'),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Steam'),
      'C:\\Program Files (x86)\\Steam',
    ].filter(Boolean);
  }
  if (process.platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'Steam')];
  return [
    path.join(home, '.steam', 'steam'),
    path.join(home, '.local', 'share', 'Steam'),
    path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'),
  ];
}

// Alle Steam-biblioteker (hovedmappen + ekstra biblioteker fra libraryfolders.vdf).
function steamLibraries() {
  const libraries = new Set();
  for (const root of steamRoots()) {
    if (!fs.existsSync(root)) continue;
    libraries.add(root);
    try {
      const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const lib of parseLibraryFolders(vdf)) libraries.add(lib);
    } catch {
      // Ingen ekstra biblioteker.
    }
  }
  return [...libraries];
}

function findGameFolder(integration) {
  for (const lib of steamLibraries()) {
    const folder = path.join(lib, 'steamapps', 'common', integration.steamFolder);
    if (fs.existsSync(folder)) return folder;
  }
  return null;
}

// Brugeren kan have valgt en undermappe (fx ...\game\csgo). Gå op, til vi finder spillets hovedmappe.
function resolveGameFolder(chosen, integration) {
  let dir = chosen;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, integration.cfgDir[0], integration.cfgDir[1]))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Skriver cfg-filen ind i spillets mappe. `gameFolder` kan gives, hvis brugeren
// selv har valgt mappen. Returnerer { ok, file } eller { ok: false, reason }.
function installIntegration(integrationId, { port, token, gameFolder } = {}) {
  const integration = INTEGRATIONS[integrationId];
  if (!integration) return { ok: false, reason: 'unknown' };
  const folder = gameFolder ? resolveGameFolder(gameFolder, integration) : findGameFolder(integration);
  if (!folder) return { ok: false, reason: gameFolder ? 'wrong-folder' : 'not-found' };
  const cfgDir = path.join(folder, ...integration.cfgDir);
  try {
    fs.mkdirSync(cfgDir, { recursive: true });
    const file = path.join(cfgDir, CFG_FILE_NAME);
    fs.writeFileSync(file, buildCfg(integrationId, { port, token }));
    return { ok: true, file };
  } catch (err) {
    return { ok: false, reason: 'write-failed', message: err.message };
  }
}

function integrationStatus(integrationId, savedFile) {
  const integration = INTEGRATIONS[integrationId];
  if (savedFile && fs.existsSync(savedFile)) return { found: true, installed: true, file: savedFile };
  const folder = findGameFolder(integration);
  if (!folder) return { found: false, installed: false };
  const file = path.join(folder, ...integration.cfgDir, CFG_FILE_NAME);
  return { found: true, installed: fs.existsSync(file), file };
}

module.exports = { installIntegration, integrationStatus };
