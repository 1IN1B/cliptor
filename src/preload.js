const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getHistory: () => ipcRenderer.invoke('get-history'),
  selectItem: (text) => ipcRenderer.send('select-item', text),
  selectImage: (imageData) => ipcRenderer.send('select-image', imageData),
  deleteItem: (id) => ipcRenderer.send('delete-item', id),
  clearHistory: () => ipcRenderer.send('clear-history'),
  hideWindow: () => ipcRenderer.send('hide-window'),
  quitApp: () => ipcRenderer.send('quit-app'),
  showPreview: (item) => ipcRenderer.send('show-preview', item),
  hidePreview: () => ipcRenderer.send('hide-preview'),
  saveVoiceNote: (audioBase64, duration) => ipcRenderer.send('save-voice-note', audioBase64, duration),
  saveNote: (content, itemId) => ipcRenderer.send('save-note', content, itemId),
  playVoiceNote: (item) => ipcRenderer.send('play-voice-note', item),
  openNoteEditor: (item) => ipcRenderer.send('open-note-editor', item),
  closeNoteEditor: () => ipcRenderer.send('close-note-editor'),
  onHistoryUpdated: (callback) => {
    const subscription = (event, history) => callback(history);
    ipcRenderer.on('history-updated', subscription);
    return () => ipcRenderer.removeListener('history-updated', subscription);
  }
});
