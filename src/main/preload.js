'use strict';

// Bro mellem siderne (setup/overlay) og hovedprocessen. Siderne får kun
// adgang til præcis de funktioner, der står her – ikke til Node.js.
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('workoutslop', {
  setup: {
    get: () => ipcRenderer.invoke('setup:get'),
    countExercises: (draft) => ipcRenderer.invoke('setup:count', draft),
    listProcesses: () => ipcRenderer.invoke('setup:processes'),
    installIntegration: (id) => ipcRenderer.invoke('setup:install-integration', id),
    preview: (draft) => ipcRenderer.invoke('setup:preview', draft),
    save: (draft) => ipcRenderer.invoke('setup:save', draft),
    close: () => ipcRenderer.send('setup:close'),
    checkUpdates: () => ipcRenderer.send('updates:check'),
    installUpdate: () => ipcRenderer.send('updates:install'),
    onUpdateStatus: listen('updates:status'),
  },
  overlay: {
    onShow: listen('overlay:show'),
    onMode: listen('overlay:mode'),
    onAction: listen('overlay:action'),
    onClear: listen('overlay:clear'),
    reportSize: (height) => ipcRenderer.send('overlay:size', height),
    complete: () => ipcRenderer.send('overlay:complete'),
    skip: () => ipcRenderer.send('overlay:skip'),
    reroll: () => ipcRenderer.send('overlay:reroll'),
    snooze: () => ipcRenderer.send('overlay:snooze'),
    expand: () => ipcRenderer.send('overlay:expand'),
  },
});
