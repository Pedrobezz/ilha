const { contextBridge, ipcRenderer } = require('electron');

const on = ch => cb => ipcRenderer.on(ch, (_, d) => cb(d));
contextBridge.exposeInMainWorld('ilha', {
  setRect: r => ipcRenderer.send('rect', r),
  focus: on_ => ipcRenderer.send('focus', on_),
  getCfg: () => ipcRenderer.invoke('cfg:get'),
  setCfg: p => ipcRenderer.invoke('cfg:set', p),
  media: c => ipcRenderer.send('media', c),
  disk: () => ipcRenderer.send('disk'),
  speedStart: () => ipcRenderer.send('speedtest:start'),
  speedCancel: () => ipcRenderer.send('speedtest:cancel'),
  sh: req => ipcRenderer.invoke('sh', req),
  copy: t => ipcRenderer.send('copy', t),
  clearClips: () => ipcRenderer.send('clips:clear'),
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
  meta: () => ipcRenderer.invoke('meta'),
  open: url => ipcRenderer.send('open', url),
  quit: () => ipcRenderer.send('quit'),
  onHover: on('hover'), onCovered: on('covered'), onNative: on('native'), onSys: on('sys'),
  onSpeed: on('speedtest'), onClips: on('clips'), onToggle: on('toggle'), onBlur: on('blur'), onCfg: on('cfg'),
});
