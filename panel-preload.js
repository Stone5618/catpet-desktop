'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('panel', {
  state: () => ipcRenderer.invoke('panel:state'),
  action: (type) => ipcRenderer.send('panel:action', { type }),
  onState: (handler) => ipcRenderer.on('pet:state', (_e, payload) => handler(payload)),
  onInfo: (handler) => ipcRenderer.on('panel:info', (_e, payload) => handler(payload)),
  shot: () => ipcRenderer.invoke('debug:shot'),
});
