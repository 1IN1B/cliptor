const { app, BrowserWindow, Tray, ipcMain, clipboard, nativeImage, screen, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, execSync } = require('child_process');
const https = require('https');
const http = require('http');
const zlib = require('zlib');

const isDev = process.argv.includes('--dev');

// Hide the application dock icon so it only runs in the menu bar
if (app.dock) {
  app.dock.hide();
}

let mainWindow = null;
let previewWindow = null;
let noteEditorWindow = null;
let tray = null;
let pollTimer = null;
let lastText = '';
let lastImageDataUrl = '';

const historyFilePath = path.join(app.getPath('userData'), 'history.json');
const recordingsDir = path.join(app.getPath('userData'), 'recordings');
const MAX_HISTORY_ITEMS = 50;
const POLL_INTERVAL = 800; // ms
const SCREENSHOT_DEBOUNCE_MS = 1500;

function loadTrayIcon() {
  const pngPath = path.join(__dirname, '..', 'assets', 'trayIconTemplate.png');
  const image = nativeImage.createFromPath(pngPath);
  image.setTemplateImage(true);
  return image;
}

function getScreenshotDirs() {
  const dirs = [];
  try {
    const result = execSync('defaults read com.apple.screencapture location', { encoding: 'utf8' }).trim();
    if (result && fs.existsSync(result)) {
      dirs.push(result);
      return dirs;
    }
  } catch {}
  const home = app.getPath('home');
  const desktop = path.join(home, 'Desktop');
  const downloads = path.join(home, 'Downloads');
  if (fs.existsSync(desktop)) dirs.push(desktop);
  if (fs.existsSync(downloads)) dirs.push(downloads);
  return dirs;
}

function isScreenshotFile(filename) {
  return /^Screenshot\s\d{4}-\d{2}-\d{2}\sat\s\d{1,2}\.\d{2}\.\d{2}(?:\s(?:AM|PM))?\.(png|jpg|jpeg)$/i.test(filename)
    || /^Screen\sShot\s\d{4}-\d{2}-\d{2}\sat\s\d{1,2}\.\d{2}\.\d{2}(?:\s(?:AM|PM))?\.(png|jpg|jpeg)$/i.test(filename);
}

let screenshotWatcher = null;
let recentScreenshots = new Map();

function addScreenshotToHistory(filePath) {
  const filename = path.basename(filePath);
  if (recentScreenshots.has(filename)) return;

  recentScreenshots.set(filename, true);
  setTimeout(() => recentScreenshots.delete(filename), SCREENSHOT_DEBOUNCE_MS * 2);

  try {
    if (!fs.existsSync(filePath)) return;
    const stats = fs.statSync(filePath);
    if (stats.size > 5 * 1024 * 1024) return;

    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) return;

    const dataUrl = image.toDataURL({ quality: 0.8 });
    if (dataUrl.length > 3 * 1024 * 1024) return;

    const history = loadHistory();
    const exists = history.some(item => item.type === 'image' && item.imageData === dataUrl);
    if (exists) return;

    const newItem = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 5),
      type: 'image',
      imageData: dataUrl,
      copiedAt: new Date().toISOString()
    };

    const newHistory = [newItem, ...history].slice(0, MAX_HISTORY_ITEMS);
    saveHistory(newHistory);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('history-updated', newHistory);
    }
    console.log('[Screenshot] Added:', filename);
  } catch (err) {
    console.error('[Screenshot] Failed:', err.message);
  }
}

function startScreenshotWatcher() {
  const chokidar = require('chokidar');
  const screenshotDirs = getScreenshotDirs();

  console.log('[Screenshot] Watching:', screenshotDirs.join(', '));

  screenshotWatcher = chokidar.watch(
    screenshotDirs.map(dir => path.join(dir, 'Screenshot*')),
    { ignoreInitial: true, persistent: true, depth: 0 }
  );

  screenshotWatcher.on('add', (filePath) => {
    const filename = path.basename(filePath);
    if (isScreenshotFile(filename)) {
      addScreenshotToHistory(filePath);
    }
  });
}

function isUrl(text) {
  try {
    const url = new URL(text.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function fetchUrlHtml(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept-Encoding': 'gzip, deflate'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrlHtml(res.headers.location).then(resolve).catch(reject);
      }

      const chunks = [];
      let stream = res;

      if (res.headers['content-encoding'] === 'gzip') {
        stream = res.pipe(zlib.createGunzip());
      } else if (res.headers['content-encoding'] === 'deflate') {
        stream = res.pipe(zlib.createInflate());
      }

      stream.on('data', (chunk) => { chunks.push(chunk); });
      stream.on('end', () => {
        const html = Buffer.concat(chunks).toString('utf8');
        resolve(html);
      });
      stream.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function extractOgImage(html) {
  const match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (match) return match[1];
  const match2 = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (match2) return match2[1];
  return null;
}

function extractOgTitle(html) {
  const match = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (match) return match[1];
  const match2 = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  if (match2) return match2[1];
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) return titleMatch[1];
  return null;
}

function extractOgDescription(html) {
  const match = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  if (match) return match[1];
  const match2 = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
  if (match2) return match2[1];
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  if (descMatch) return descMatch[1];
  return null;
}

function fetchOgData(url) {
  return fetchUrlHtml(url)
    .then((html) => {
      const ogImage = extractOgImage(html);
      const ogTitle = extractOgTitle(html);
      const ogDescription = extractOgDescription(html);
      return { ogImage, ogTitle, ogDescription };
    })
    .catch(() => ({ ogImage: null, ogTitle: null, ogDescription: null }));
}

function loadHistory() {
  try {
    if (fs.existsSync(historyFilePath)) {
      const data = fs.readFileSync(historyFilePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to load history:', err);
  }
  return [];
}

function saveHistory(history) {
  try {
    fs.writeFileSync(historyFilePath, JSON.stringify(history, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save history:', err);
  }
}

function startClipboardPolling() {
  lastText = clipboard.readText();
  lastImageDataUrl = '';

  pollTimer = setInterval(() => {
    const text = clipboard.readText();
    if (text && text.trim() !== '') {
      if (text !== lastText) {
        lastText = text;
        addTextToHistory(text);
      }
      return;
    }

    const formats = clipboard.availableFormats('clipboard');
    const hasImage = formats.some(f =>
      f.startsWith('image/') ||
      f === 'public.png' ||
      f === 'public.tiff' ||
      f === 'public.jpeg'
    );
    if (!hasImage) return;

    const image = clipboard.readImage('clipboard');
    if (image.isEmpty()) return;

    const dataUrl = image.toDataURL();
    if (dataUrl === lastImageDataUrl) return;
    lastImageDataUrl = dataUrl;

    addImageToHistory(dataUrl);
  }, POLL_INTERVAL);
}

function addTextToHistory(text) {
  const history = loadHistory();
  const filtered = history.filter(item => item.text !== text);
  
  const newItem = {
    id: Date.now().toString() + Math.random().toString(36).substring(2, 5),
    text: text,
    copiedAt: new Date().toISOString()
  };

  if (isUrl(text)) {
    newItem.isUrl = true;
    newItem.ogImage = null;
    newItem.ogTitle = null;
    newItem.ogDescription = null;
  }
  
  const newHistory = [newItem, ...filtered].slice(0, MAX_HISTORY_ITEMS);
  saveHistory(newHistory);
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('history-updated', newHistory);
  }

  if (isUrl(text)) {
    const itemId = newItem.id;
    fetchOgData(text.trim()).then(({ ogImage, ogTitle, ogDescription }) => {
      if (!ogImage && !ogTitle && !ogDescription) return;
      const currentHistory = loadHistory();
      const item = currentHistory.find(i => i.id === itemId);
      if (!item) return;
      item.ogImage = ogImage;
      item.ogTitle = ogTitle;
      item.ogDescription = ogDescription;
      saveHistory(currentHistory);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('history-updated', currentHistory);
      }
    });
  }
}

function addImageToHistory(dataUrl) {
  if (dataUrl.length > 3 * 1024 * 1024) return;

  const history = loadHistory();
  const exists = history.some(item => item.type === 'image' && item.imageData === dataUrl);
  if (exists) return;

  const newItem = {
    id: Date.now().toString() + Math.random().toString(36).substring(2, 5),
    type: 'image',
    imageData: dataUrl,
    copiedAt: new Date().toISOString()
  };

  const newHistory = [newItem, ...history].slice(0, MAX_HISTORY_ITEMS);
  saveHistory(newHistory);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('history-updated', newHistory);
  }
}

function ensureRecordingsDir() {
  if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir, { recursive: true });
  }
}

function addVoiceNoteToHistory(audioBase64, duration) {
  ensureRecordingsDir();
  const id = Date.now().toString() + Math.random().toString(36).substring(2, 5);
  const filename = `voice-${id}.webm`;
  const filePath = path.join(recordingsDir, filename);

  const audioBuffer = Buffer.from(audioBase64, 'base64');
  fs.writeFileSync(filePath, audioBuffer);

  const history = loadHistory();
  const newItem = {
    id: id,
    type: 'voice',
    audioFile: filename,
    duration: duration,
    copiedAt: new Date().toISOString()
  };

  const newHistory = [newItem, ...history].slice(0, MAX_HISTORY_ITEMS);
  saveHistory(newHistory);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('history-updated', newHistory);
  }
}

function addNoteToHistory(content, itemId) {
  const history = loadHistory();

  if (itemId) {
    const existingItem = history.find(item => item.id === itemId);
    if (existingItem) {
      existingItem.content = content;
      saveHistory(history);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('history-updated', history);
      }
      return;
    }
  }

  const newItem = {
    id: Date.now().toString() + Math.random().toString(36).substring(2, 5),
    type: 'note',
    content: content,
    copiedAt: new Date().toISOString()
  };

  const newHistory = [newItem, ...history].slice(0, MAX_HISTORY_ITEMS);
  saveHistory(newHistory);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('history-updated', newHistory);
  }
}

function createMainWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().bounds;

  mainWindow = new BrowserWindow({
    width: screenWidth,
    height: 400,
    x: 0,
    y: screenHeight - 400,
    show: false,
    frame: false,
    fullscreenable: false,
    resizable: false,
    transparent: true,
    vibrancy: 'under-window',
    roundedCorners: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('blur', () => {
    if (mainWindow && !isDev) {
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function toggleWindow() {
  if (!mainWindow) {
    createMainWindow();
  }
  
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    positionWindow();
    mainWindow.show();
    mainWindow.focus();
  }
}

function positionWindow() {
  if (!mainWindow) return;

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().bounds;
  mainWindow.setPosition(0, screenHeight - 400, false);
}

// IPC Handlers
ipcMain.handle('get-history', () => {
  return loadHistory();
});

function showCopiedNotification(label) {
  if (!Notification.isSupported()) return;
  const notif = new Notification({ title: 'Cliptor', body: `${label} copied and pasted` });
  notif.show();
}

ipcMain.on('select-item', (event, text) => {
  lastText = text;
  lastImageDataUrl = '';
  clipboard.writeText(text);

  const snippet = text.length > 40 ? text.slice(0, 40) + '…' : text;
  showCopiedNotification(snippet);

  if (mainWindow) {
    mainWindow.hide();
  }

  setTimeout(() => {
    const appleScript = `tell application "System Events" to keystroke "v" using command down`;
    exec(`osascript -e '${appleScript}'`, (err) => {
      if (err) {
        console.warn('Auto-paste keystroke failed:', err.message);
      }
    });
  }, 80);
});

ipcMain.on('select-image', (event, imageDataUrl) => {
  lastText = '';
  lastImageDataUrl = imageDataUrl;
  const image = nativeImage.createFromDataURL(imageDataUrl);
  clipboard.writeImage(image);

  showCopiedNotification('Image');

  if (mainWindow) {
    mainWindow.hide();
  }

  setTimeout(() => {
    const appleScript = `tell application "System Events" to keystroke "v" using command down`;
    exec(`osascript -e '${appleScript}'`, (err) => {
      if (err) {
        console.warn('Auto-paste keystroke failed:', err.message);
      }
    });
  }, 80);
});

ipcMain.on('delete-item', (event, id) => {
  const history = loadHistory();
  const itemToDelete = history.find(item => item.id === id);
  if (itemToDelete && itemToDelete.type === 'voice' && itemToDelete.audioFile) {
    const filePath = path.join(recordingsDir, itemToDelete.audioFile);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
  const filtered = history.filter(item => item.id !== id);
  saveHistory(filtered);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('history-updated', filtered);
  }
});

ipcMain.on('clear-history', () => {
  if (fs.existsSync(recordingsDir)) {
    const files = fs.readdirSync(recordingsDir);
    files.forEach(file => {
      fs.unlinkSync(path.join(recordingsDir, file));
    });
  }
  saveHistory([]);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('history-updated', []);
  }
});

ipcMain.on('hide-window', () => {
  if (mainWindow) {
    mainWindow.hide();
  }
});

ipcMain.on('save-voice-note', (event, audioBase64, duration) => {
  addVoiceNoteToHistory(audioBase64, duration);
});

ipcMain.on('save-note', (event, content, itemId) => {
  addNoteToHistory(content, itemId);
});

ipcMain.on('play-voice-note', (event, item) => {
  if (!previewWindow) {
    createPreviewWindow();
  }

  let itemToSend = { ...item };
  if (item.audioFile) {
    const filePath = path.join(recordingsDir, item.audioFile);
    if (fs.existsSync(filePath)) {
      const audioBuffer = fs.readFileSync(filePath);
      itemToSend.audioDataUrl = `data:audio/webm;base64,${audioBuffer.toString('base64')}`;
    }
  }

  previewWindow.webContents.executeJavaScript(`renderPreview(${JSON.stringify(itemToSend)})`);
  previewWindow.show();
  previewWindow.focus();
});

function createPreviewWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  previewWindow = new BrowserWindow({
    width: 420,
    height: 500,
    show: false,
    frame: false,
    fullscreenable: false,
    resizable: false,
    transparent: true,
    vibrancy: 'under-window',
    alwaysOnTop: true,
    skipTaskbar: true,
    x: Math.round((width - 420) / 2),
    y: Math.round((height - 500) / 2),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  previewWindow.loadFile(path.join(__dirname, 'preview.html'));

  previewWindow.on('closed', () => {
    previewWindow = null;
  });
}

ipcMain.on('show-preview', (event, item) => {
  if (!previewWindow) {
    createPreviewWindow();
  }

  previewWindow.webContents.executeJavaScript(`renderPreview(${JSON.stringify(item)})`);

  previewWindow.show();
  previewWindow.focus();
});

ipcMain.on('hide-preview', () => {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.hide();
  }
});

function createNoteEditorWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  noteEditorWindow = new BrowserWindow({
    width: 460,
    height: 500,
    show: false,
    frame: false,
    fullscreenable: false,
    resizable: false,
    transparent: true,
    vibrancy: 'under-window',
    alwaysOnTop: true,
    skipTaskbar: true,
    x: Math.round((width - 460) / 2),
    y: Math.round((height - 500) / 2),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  noteEditorWindow.loadFile(path.join(__dirname, 'note-editor.html'));

  noteEditorWindow.on('closed', () => {
    noteEditorWindow = null;
  });
}

ipcMain.on('open-note-editor', (event, item) => {
  if (noteEditorWindow && !noteEditorWindow.isDestroyed()) {
    noteEditorWindow.focus();
    if (item) {
      noteEditorWindow.webContents.executeJavaScript(`initEditor(${JSON.stringify(item)})`);
    }
    return;
  }

  createNoteEditorWindow();
  noteEditorWindow.once('ready-to-show', () => {
    noteEditorWindow.show();
    noteEditorWindow.focus();
    if (item) {
      noteEditorWindow.webContents.executeJavaScript(`initEditor(${JSON.stringify(item)})`);
    }
  });
});

ipcMain.on('close-note-editor', () => {
  if (noteEditorWindow && !noteEditorWindow.isDestroyed()) {
    noteEditorWindow.hide();
  }
});

function watchDev() {
  if (!isDev) return;

  const chokidar = require('chokidar');
  const srcDir = __dirname;

  const rendererWatcher = chokidar.watch([
    path.join(srcDir, 'index.html'),
    path.join(srcDir, 'index.css'),
    path.join(srcDir, 'renderer.js'),
    path.join(srcDir, 'note-editor.html'),
    path.join(srcDir, 'note-editor.css'),
  ], { ignoreInitial: true });

  rendererWatcher.on('change', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload();
      if (!mainWindow.isVisible()) {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  const mainWatcher = chokidar.watch([
    path.join(srcDir, 'main.js'),
    path.join(srcDir, 'preload.js'),
  ], { ignoreInitial: true });

  mainWatcher.on('change', () => {
    app.relaunch();
    app.exit(0);
  });
}

ipcMain.on('quit-app', () => {
  app.exit(0);
});

app.whenReady().then(() => {
  ensureRecordingsDir();
  const image = loadTrayIcon();
  
  tray = new Tray(image);
  tray.setToolTip('Cliptor - Clipboard History');
  
  tray.on('click', () => {
    toggleWindow();
  });
  
  createMainWindow();
  startClipboardPolling();
  startScreenshotWatcher();
  watchDev();
});

app.on('window-all-closed', (e) => {
  // Prevent application from quitting on window close
  e.preventDefault();
});
