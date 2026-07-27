const { app, BrowserWindow, Tray, ipcMain, clipboard, nativeImage, screen, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
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
let tray = null;
let pollTimer = null;
let lastText = '';
let lastImageDataUrl = '';

const historyFilePath = path.join(app.getPath('userData'), 'history.json');
const MAX_HISTORY_ITEMS = 50;
const POLL_INTERVAL = 800; // ms

function loadTrayIcon() {
  const pngPath = path.join(__dirname, '..', 'assets', 'trayIconTemplate.png');
  const image = nativeImage.createFromPath(pngPath);
  image.setTemplateImage(true);
  return image;
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

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 320,
    height: 450,
    show: false,
    frame: false,
    fullscreenable: false,
    resizable: false,
    transparent: true,
    vibrancy: 'under-window',
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
  if (!mainWindow || !tray) return;

  const trayBounds = tray.getBounds();
  const windowBounds = mainWindow.getBounds();

  // Horizontal centering under the tray icon
  const x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2));
  
  // Vertical position just below the status bar
  const y = Math.round(trayBounds.y + trayBounds.height + 4);

  mainWindow.setPosition(x, y, false);
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
  const filtered = history.filter(item => item.id !== id);
  saveHistory(filtered);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('history-updated', filtered);
  }
});

ipcMain.on('clear-history', () => {
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

function watchDev() {
  if (!isDev) return;

  const chokidar = require('chokidar');
  const srcDir = __dirname;

  const rendererWatcher = chokidar.watch([
    path.join(srcDir, 'index.html'),
    path.join(srcDir, 'index.css'),
    path.join(srcDir, 'renderer.js'),
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
  const image = loadTrayIcon();
  
  tray = new Tray(image);
  tray.setToolTip('Cliptor - Clipboard History');
  
  tray.on('click', () => {
    toggleWindow();
  });
  
  createMainWindow();
  startClipboardPolling();
  watchDev();
});

app.on('window-all-closed', (e) => {
  // Prevent application from quitting on window close
  e.preventDefault();
});
