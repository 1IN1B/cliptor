const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getHistory: () => ipcRenderer.invoke('get-history'),
  selectItem: (text) => ipcRenderer.send('select-item', text),
  deleteItem: (id) => ipcRenderer.send('delete-item', id),
  clearHistory: () => ipcRenderer.send('clear-history'),
  hideWindow: () => ipcRenderer.send('hide-window'),
  quitApp: () => ipcRenderer.send('quit-app'),
  showPreview: (item) => ipcRenderer.send('show-preview', item),
  hidePreview: () => ipcRenderer.send('hide-preview'),
  onHistoryUpdated: (callback) => {
    const subscription = (event, history) => callback(history);
    ipcRenderer.on('history-updated', subscription);
    return () => ipcRenderer.removeListener('history-updated', subscription);
  }
});
