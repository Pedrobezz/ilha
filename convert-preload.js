// Janela escondida do conversor: recebe a imagem (bytes) do processo principal e devolve convertida
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('conv', {
  onJob: cb => ipcRenderer.on('job', (_, job) => cb(job)),
  done: (id, result) => ipcRenderer.send('conv:result', { id, ...result }),
});
