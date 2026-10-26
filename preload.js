'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  dragStart: (offsetX, offsetY) => ipcRenderer.send('pet:drag-start', { offsetX, offsetY }),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  click: () => ipcRenderer.send('pet:click'),
  panel: () => ipcRenderer.send('pet:panel'),
  menu: () => ipcRenderer.send('pet:menu'),
  onState: (handler) => ipcRenderer.on('pet:state', (_e, payload) => handler(payload)),
  onSay: (handler) => ipcRenderer.on('pet:say', (_e, payload) => handler(payload)),
  onFx: (handler) => ipcRenderer.on('pet:fx', (_e, payload) => handler(payload)),
  debug: () => ipcRenderer.invoke('debug:query'),
  shot: () => ipcRenderer.invoke('debug:shot'),
});
