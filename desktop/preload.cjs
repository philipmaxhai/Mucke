const { contextBridge, ipcRenderer } = require('electron')

// The web app checks for window.muckeDesktop to offer per-app recording.
contextBridge.exposeInMainWorld('muckeDesktop', {
  platform: process.platform,
  listApps: () => ipcRenderer.invoke('loopback:list'),
  setMute: (pid, mute) => ipcRenderer.invoke('loopback:mute', pid, mute),
  start: (opts) => ipcRenderer.invoke('loopback:start', opts),
  stop: (id) => ipcRenderer.invoke('loopback:stop', id),
  onData(cb) {
    const fn = (_e, id, data) => cb(id, data)
    ipcRenderer.on('loopback:data', fn)
    return () => ipcRenderer.removeListener('loopback:data', fn)
  },
  onStatus(cb) {
    const fn = (_e, id, msg) => cb(id, msg)
    ipcRenderer.on('loopback:status', fn)
    return () => ipcRenderer.removeListener('loopback:status', fn)
  },
})
