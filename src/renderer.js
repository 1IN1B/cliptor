const searchInput = document.getElementById('search-input');
const historyList = document.getElementById('history-list');
const emptyState = document.getElementById('empty-state');
const itemsCount = document.getElementById('items-count');
const clearBtn = document.getElementById('clear-btn');
const quitBtn = document.getElementById('quit-btn');

let clipboardHistory = [];
let filteredHistory = [];
let focusedIndex = -1; // -1 represents the search input

// Format ISO string to relative time
function formatRelativeTime(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  
  if (diffSec < 5) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  
  // Format as short date
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Render history list to DOM
function renderList(items) {
  historyList.innerHTML = '';
  filteredHistory = items;
  focusedIndex = -1; // reset focus to search
  
  if (items.length === 0) {
    emptyState.classList.remove('hidden');
    historyList.classList.add('hidden');
    itemsCount.textContent = '0 items';
    return;
  }
  
  emptyState.classList.add('hidden');
  historyList.classList.remove('hidden');
  itemsCount.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
  
  items.forEach((item, index) => {
    const itemEl = document.createElement('div');
    itemEl.className = 'history-item';
    if (item.isUrl) itemEl.classList.add('url-item');
    itemEl.setAttribute('tabindex', '0');
    itemEl.setAttribute('data-id', item.id);
    
    if (item.type === 'image') {
      itemEl.classList.add('image-item');
      itemEl.innerHTML = `
        <img class="item-image-thumb" src="${escapeHtml(item.imageData)}" alt="">
        <div class="item-main">
          <div class="item-meta">
            ${index < 9 ? `<span class="item-index">⌘${index + 1}</span>` : ''}
            <span class="item-type item-type-image">IMAGE</span>
            <span class="item-time">${formatRelativeTime(item.copiedAt)}</span>
          </div>
        </div>
        <button class="delete-btn" title="Delete entry" tabindex="-1">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      `;
    } else if (item.isUrl) {
      const hostname = escapeHtml(new URL(item.text.trim()).hostname);
      const title = item.ogTitle ? escapeHtml(item.ogTitle) : hostname;
      const ogImageHtml = item.ogImage
        ? `<img class="og-preview" src="${escapeHtml(item.ogImage)}" alt="" onerror="this.style.display='none'">`
        : `<div class="og-placeholder"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="svg-icon"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></div>`;

      itemEl.innerHTML = `
        ${ogImageHtml}
        <div class="item-main">
          <div class="item-title">${title}</div>
          <div class="item-url">${hostname}</div>
          <div class="item-meta">
            ${index < 9 ? `<span class="item-index">⌘${index + 1}</span>` : ''}
            <span class="item-type">LINK</span>
            <span class="item-time">${formatRelativeTime(item.copiedAt)}</span>
          </div>
        </div>
        <button class="delete-btn" title="Delete entry" tabindex="-1">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      `;
    } else {
      itemEl.innerHTML = `
        <div class="item-main">
          <div class="item-content" title="${escapeHtml(item.text)}">${escapeHtml(item.text)}</div>
          <div class="item-meta">
            ${index < 9 ? `<span class="item-index">⌘${index + 1}</span>` : ''}
            <span class="item-time">${formatRelativeTime(item.copiedAt)}</span>
          </div>
        </div>
        <button class="delete-btn" title="Delete entry" tabindex="-1">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      `;
    }
    
    // Copy item on click
    itemEl.addEventListener('click', (e) => {
      if (e.target.closest('.delete-btn')) return;
      selectItem(item, itemEl);
    });
    
    const deleteBtn = itemEl.querySelector('.delete-btn');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.api.deleteItem(item.id);
    });

    let longPressTimer = null;
    itemEl.addEventListener('mousedown', (e) => {
      if (e.target.closest('.delete-btn')) return;
      longPressTimer = setTimeout(() => {
        window.api.showPreview(item);
        longPressTimer = null;
      }, 500);
    });
    itemEl.addEventListener('mouseup', () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    });
    itemEl.addEventListener('mouseleave', () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    });
    
    historyList.appendChild(itemEl);
  });
}

// Select item to copy & paste
function selectItem(item, itemEl) {
  if (item.type === 'image') {
    window.api.selectImage(item.imageData);
  } else {
    window.api.selectItem(item.text);
  }
}

// Escape HTML utility
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Filter history based on search input
function filterHistory() {
  const query = searchInput.value.toLowerCase().trim();
  if (!query) {
    renderList(clipboardHistory);
    return;
  }
  
  const filtered = clipboardHistory.filter(item =>
    item.type === 'image' ? false : item.text.toLowerCase().includes(query)
  );
  renderList(filtered);
}

// Focus an item at a specific index
function focusItem(index) {
  const items = historyList.querySelectorAll('.history-item');
  if (index === -1) {
    searchInput.focus();
    focusedIndex = -1;
  } else if (index >= 0 && index < items.length) {
    items[index].focus();
    focusedIndex = index;
    // Scroll item into view if needed
    items[index].scrollIntoView({ block: 'nearest' });
  }
}

// Keyboard Navigation Handlers
window.addEventListener('keydown', (e) => {
  const items = historyList.querySelectorAll('.history-item');
  
  if (e.key === 'Escape') {
    e.preventDefault();
    window.api.hideWindow();
    return;
  }
  
  // Arrow Down
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (focusedIndex < items.length - 1) {
      focusItem(focusedIndex + 1);
    }
    return;
  }
  
  // Arrow Up
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (focusedIndex > -1) {
      focusItem(focusedIndex - 1);
    }
    return;
  }
  
  // Enter on focused item
  if (e.key === 'Enter' && focusedIndex >= 0) {
    e.preventDefault();
    const item = filteredHistory[focusedIndex];
    const itemEl = items[focusedIndex];
    if (item && itemEl) {
      selectItem(item, itemEl);
    }
    return;
  }

  // Quick ⌘1 to ⌘9 shortcuts
  if (e.metaKey && !isNaN(e.key)) {
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= 9) {
      const targetIndex = num - 1;
      const item = filteredHistory[targetIndex];
      const itemEl = items[targetIndex];
      if (item && itemEl) {
        e.preventDefault();
        selectItem(item, itemEl);
      }
    }
  }
});

// Search input key events
searchInput.addEventListener('input', filterHistory);

// Focus search when typing begins anywhere (unless already focusing inputs)
window.addEventListener('keypress', (e) => {
  if (document.activeElement !== searchInput) {
    searchInput.focus();
  }
});

// Clear All History click handler
clearBtn.addEventListener('click', () => {
  if (confirm('Are you sure you want to clear your entire clipboard history?')) {
    window.api.clearHistory();
    searchInput.value = '';
    searchInput.focus();
  }
});

// Quit button click handler
quitBtn.addEventListener('click', () => {
  // Directly close the application by requesting window.api to quit or exit
  // Wait, we need a quit or exit IPC. Let's see: we can quit directly from renderer 
  // or add a close handler. Wait! Let's check how main.js processes close.
  // In main.js, we don't have a specific quit IPC yet, so let's add one or call Electron remote?
  // Let's just create an IPC event for 'quit-app'. Let's do that!
  // Wait, we can add it to preload.js and main.js or just send a message.
  // Let's edit preload.js and main.js to add a quitApp API.
  // Wait! Electron's ipcRenderer.send('quit-app') is perfect. Let's see if we can trigger that.
  ipcRendererSendQuit();
});

function ipcRendererSendQuit() {
  // Send quit command to main process via a simple message
  // Wait, we can just use a simple ipcRenderer send directly or export it via api contextBridge.
  // Since contextBridge in preload.js does not have quitApp, let's update preload.js and main.js
  // to support quitting, OR we can just use the existing api?
  // Ah! We can easily use a message like 'hide-window' or we can add 'quit-app' to preload.js.
  // Let's edit preload.js to include quitApp. Let's do that in a bit or let's use a quick replace.
  // Wait, let's write renderer.js first with window.api.quitApp() call!
  window.api.quitApp();
}

// Initialize list
window.addEventListener('DOMContentLoaded', async () => {
  clipboardHistory = await window.api.getHistory();
  renderList(clipboardHistory);
  searchInput.focus();
});

// Handle real-time updates from backend
window.api.onHistoryUpdated((newHistory) => {
  clipboardHistory = newHistory;
  filterHistory();
});
