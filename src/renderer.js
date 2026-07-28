const searchInput = document.getElementById('search-input');
const cardsList = document.getElementById('cards-list');
const emptyState = document.getElementById('empty-state');
const itemsCount = document.getElementById('items-count');
const clearBtn = document.getElementById('clear-btn');
const quitBtn = document.getElementById('quit-btn');
const filterChips = document.querySelectorAll('.filter-chip');

let clipboardHistory = [];
let filteredHistory = [];
let focusedIndex = -1;
let activeFilter = 'all';

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

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

// Get item type for filtering
function getItemType(item) {
  if (item.type === 'image') return 'image';
  if (item.type === 'voice') return 'voice';
  if (item.type === 'note') return 'note';
  if (item.isUrl) return 'link';
  return 'text';
}

// Get type icon SVG
function getTypeIcon(type) {
  switch (type) {
    case 'text':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
    case 'link':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>`;
    case 'image':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`;
    case 'voice':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;
    case 'note':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;
    default:
      return '';
  }
}

// Render cards list
function renderCards(items) {
  cardsList.innerHTML = '';
  filteredHistory = items;
  focusedIndex = -1;

  if (items.length === 0) {
    emptyState.classList.remove('hidden');
    cardsList.classList.add('hidden');
    itemsCount.textContent = '0 items';
    return;
  }

  emptyState.classList.add('hidden');
  cardsList.classList.remove('hidden');
  itemsCount.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;

  items.forEach((item, index) => {
    const type = getItemType(item);
    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('tabindex', '0');
    card.setAttribute('data-id', item.id);
    card.setAttribute('data-type', type);

    const title = item.isUrl
      ? (() => { try { return new URL(item.text.trim()).hostname; } catch { return 'Link'; } })()
      : type === 'image' ? 'Image'
      : type === 'voice' ? 'Voice Note'
      : type === 'note' ? 'Note'
      : item.text.slice(0, 30) || 'Text';

    let bodyHtml = '';
    if (type === 'link') {
      const hostname = (() => { try { return escapeHtml(new URL(item.text.trim()).hostname); } catch { return ''; } })();
      const ogImageHtml = item.ogImage
        ? `<img class="card-link-image" src="${escapeHtml(item.ogImage)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : '';
      const placeholderHtml = item.ogImage
        ? `<div class="card-link-placeholder" style="display:none">${getTypeIcon('link')}</div>`
        : `<div class="card-link-placeholder">${getTypeIcon('link')}</div>`;

      bodyHtml = `
        <div class="card-body-link">
          ${ogImageHtml}
          ${placeholderHtml}
          <div class="card-link-meta">
            <div class="card-link-title">${item.ogTitle ? escapeHtml(item.ogTitle) : hostname}</div>
            <div class="card-link-url">${hostname}</div>
          </div>
        </div>
      `;
    } else if (type === 'image') {
      bodyHtml = `
        <div class="card-body-image">
          <img class="card-image-thumb" src="${escapeHtml(item.imageData)}" alt="">
          <div class="card-image-meta">
            <span>${formatRelativeTime(item.copiedAt)}</span>
          </div>
        </div>
      `;
    } else if (type === 'voice') {
      const duration = item.duration || 0;
      const mins = Math.floor(duration / 60);
      const secs = Math.floor(duration % 60);
      bodyHtml = `
        <div class="card-body-voice">
          <div class="voice-mic-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
          </div>
          <div class="voice-duration">${mins}:${secs.toString().padStart(2, '0')}</div>
          <div class="voice-label">Voice Note</div>
        </div>
      `;
    } else if (type === 'note') {
      bodyHtml = `
        <div class="card-body-note">${item.content || ''}</div>
      `;
    } else {
      bodyHtml = `
        <div class="card-body-text">${escapeHtml(item.text)}</div>
      `;
    }

    card.innerHTML = `
      <div class="card-header">
        <div class="card-type-icon type-${type}">
          ${getTypeIcon(type)}
        </div>
        <div class="card-header-info">
          <div class="card-title">${escapeHtml(title)}</div>
          <div class="card-date">${formatRelativeTime(item.copiedAt)}</div>
        </div>
        <div class="card-actions">
          <button class="card-action-btn btn-remove" title="Remove" tabindex="-1">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>
      <div class="card-body">
        ${bodyHtml}
      </div>
    `;

    // Click to copy
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-action-btn')) return;
      selectItem(item);
    });

    // Remove button
    const removeBtn = card.querySelector('.btn-remove');
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.api.deleteItem(item.id);
    });

    // Long press for preview
    let longPressTimer = null;
    card.addEventListener('mousedown', () => {
      longPressTimer = setTimeout(() => {
        window.api.showPreview(item);
        longPressTimer = null;
      }, 500);
    });
    card.addEventListener('mouseup', () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    });
    card.addEventListener('mouseleave', () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    });

    cardsList.appendChild(card);
  });
}

// Select item to copy & paste
function selectItem(item) {
  if (item.type === 'image') {
    window.api.selectImage(item.imageData);
  } else if (item.type === 'voice') {
    window.api.playVoiceNote(item);
  } else if (item.type === 'note') {
    editNote(item);
  } else {
    window.api.selectItem(item.text);
  }
}

// Filter history
function filterHistory() {
  const query = searchInput.value.toLowerCase().trim();
  let items = clipboardHistory;

  // Apply type filter
  if (activeFilter !== 'all') {
    items = items.filter(item => getItemType(item) === activeFilter);
  }

  // Apply search filter
  if (query) {
    items = items.filter(item => {
      if (item.type === 'image') return false;
      if (item.type === 'voice') return false;
      if (item.type === 'note') {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = item.content || '';
        return tempDiv.textContent.toLowerCase().includes(query);
      }
      return item.text.toLowerCase().includes(query);
    });
  }

  renderCards(items);
}

// Focus an item at a specific index
function focusCard(index) {
  const cards = cardsList.querySelectorAll('.card');
  if (index === -1) {
    searchInput.focus();
    focusedIndex = -1;
  } else if (index >= 0 && index < cards.length) {
    cards[index].focus();
    focusedIndex = index;
    cards[index].scrollIntoView({ block: 'nearest', inline: 'center' });
  }
}

// Filter chip click
filterChips.forEach(chip => {
  chip.addEventListener('click', () => {
    filterChips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    activeFilter = chip.dataset.filter;
    filterHistory();
  });
});

// Keyboard Navigation
window.addEventListener('keydown', (e) => {
  const cards = cardsList.querySelectorAll('.card');

  if (e.key === 'Escape') {
    e.preventDefault();
    window.api.hideWindow();
    return;
  }

  // Arrow Right
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    if (focusedIndex < cards.length - 1) {
      focusCard(focusedIndex + 1);
    }
    return;
  }

  // Arrow Left
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    if (focusedIndex > -1) {
      focusCard(focusedIndex - 1);
    }
    return;
  }

  // Arrow Down - focus search
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    focusCard(-1);
    return;
  }

  // Enter on focused card
  if (e.key === 'Enter' && focusedIndex >= 0) {
    e.preventDefault();
    const item = filteredHistory[focusedIndex];
    if (item) selectItem(item);
    return;
  }

  // Quick shortcuts: Ctrl+1 to Ctrl+9
  if ((e.metaKey || e.ctrlKey) && !isNaN(e.key)) {
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= 9) {
      const targetIndex = num - 1;
      const item = filteredHistory[targetIndex];
      if (item) {
        e.preventDefault();
        selectItem(item);
      }
    }
  }

  // Tab to cycle filter types
  if (e.key === 'Tab') {
    e.preventDefault();
    const chips = Array.from(filterChips);
    const currentIdx = chips.findIndex(c => c.classList.contains('active'));
    const nextIdx = e.shiftKey
      ? (currentIdx - 1 + chips.length) % chips.length
      : (currentIdx + 1) % chips.length;
    chips[nextIdx].click();
  }
});

// Search input events
searchInput.addEventListener('input', filterHistory);

// Focus search when typing begins
window.addEventListener('keypress', (e) => {
  if (document.activeElement !== searchInput && !e.metaKey && !e.ctrlKey) {
    searchInput.focus();
  }
});

// Clear History
clearBtn.addEventListener('click', () => {
  if (confirm('Clear entire clipboard history?')) {
    window.api.clearHistory();
    searchInput.value = '';
    activeFilter = 'all';
    filterChips.forEach(c => c.classList.remove('active'));
    filterChips[0].classList.add('active');
    searchInput.focus();
  }
});

// Quit button
quitBtn.addEventListener('click', () => {
  window.api.quitApp();
});

// Initialize
window.addEventListener('DOMContentLoaded', async () => {
  clipboardHistory = await window.api.getHistory();
  filterHistory();
  searchInput.focus();
});

// Real-time updates
window.api.onHistoryUpdated((newHistory) => {
  clipboardHistory = newHistory;
  filterHistory();
});

// Voice Recording
const recordBtn = document.getElementById('record-btn');
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = null;
let recordingTimer = null;
const MAX_RECORDING_DURATION = 3600000; // 1 hour in ms

recordBtn.addEventListener('click', async () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopRecording();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const duration = (Date.now() - recordingStartTime) / 1000;
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const arrayBuffer = await audioBlob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Convert to base64 for IPC
      let binary = '';
      for (let i = 0; i < uint8Array.byteLength; i++) {
        binary += String.fromCharCode(uint8Array[i]);
      }
      const audioBase64 = btoa(binary);

      if (duration >= 1) {
        await window.api.saveVoiceNote(audioBase64, duration);
      }
    };

    mediaRecorder.start();
    recordingStartTime = Date.now();
    recordBtn.classList.add('recording');

    recordingTimer = setInterval(() => {
      if (Date.now() - recordingStartTime >= MAX_RECORDING_DURATION) {
        stopRecording();
      }
    }, 1000);
  } catch (err) {
    console.error('Microphone access denied:', err);
  }
});

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    recordBtn.classList.remove('recording');
    if (recordingTimer) {
      clearInterval(recordingTimer);
      recordingTimer = null;
    }
  }
}

// Note Editor
const noteBtn = document.getElementById('note-btn');

noteBtn.addEventListener('click', () => {
  window.api.openNoteEditor(null);
});

// Edit note from card
function editNote(item) {
  window.api.openNoteEditor(item);
}
