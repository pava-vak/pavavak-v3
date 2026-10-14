import { fetchChatMedia, fetchAdminChatMedia, requestMediaBlob, requestDeleteMessage } from '../../shared/apiClient.js';

const IST_OPTS = { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true };

function formatGalleryDate(isoString) {
  try { return new Date(isoString).toLocaleString('en-IN', IST_OPTS); } catch { return ''; }
}

const blobCache = new Map();

async function loadBlob(fileId) {
  if (blobCache.has(fileId)) return blobCache.get(fileId);
  const blob = await requestMediaBlob(fileId);
  const url = URL.createObjectURL(blob);
  blobCache.set(fileId, url);
  return url;
}

// ── Image / Video viewer with prev/next navigation ──────────────────────────

function openMediaViewer({ mediaList, startIndex, onDelete }) {
  document.getElementById('pava-img-viewer')?.remove();

  let currentIndex = startIndex;

  const overlay = document.createElement('div');
  overlay.id = 'pava-img-viewer';
  overlay.className = 'img-viewer-overlay';
  overlay.innerHTML = `
    <div class="img-viewer-topbar">
      <button class="img-viewer-close" aria-label="Close">✕</button>
      <span class="img-viewer-caption"></span>
      <div class="img-viewer-actions">
        <button class="img-viewer-del" aria-label="Delete" title="Delete this item">🗑</button>
        <button class="img-viewer-save" aria-label="Save">⬇ Save</button>
      </div>
    </div>
    <div class="img-viewer-stage">
      <button class="img-viewer-nav img-viewer-prev" aria-label="Previous">‹</button>
      <img class="img-viewer-img" draggable="false" alt="">
      <video class="img-viewer-vid" controls playsinline controlsList="nodownload" style="display:none"></video>
      <button class="img-viewer-nav img-viewer-next" aria-label="Next">›</button>
    </div>
    <div class="img-viewer-counter"></div>
  `;
  overlay.addEventListener('contextmenu', e => e.preventDefault());

  const stage   = overlay.querySelector('.img-viewer-stage');
  const img     = overlay.querySelector('.img-viewer-img');
  const vid     = overlay.querySelector('.img-viewer-vid');
  const caption = overlay.querySelector('.img-viewer-caption');
  const counter = overlay.querySelector('.img-viewer-counter');
  const prevBtn = overlay.querySelector('.img-viewer-prev');
  const nextBtn = overlay.querySelector('.img-viewer-next');
  const delBtn  = overlay.querySelector('.img-viewer-del');
  const saveBtn = overlay.querySelector('.img-viewer-save');

  let scale = 1, tx = 0, ty = 0;
  let dragging = false, dragX = 0, dragY = 0;
  let lastTap = 0, pinchDist = 0;

  function applyTransform() {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    stage.style.cursor = scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'default';
  }
  function clamp() {
    if (scale <= 1) { tx = 0; ty = 0; return; }
    const maxX = (stage.clientWidth  * (scale - 1)) / 2;
    const maxY = (stage.clientHeight * (scale - 1)) / 2;
    tx = Math.max(-maxX, Math.min(maxX, tx));
    ty = Math.max(-maxY, Math.min(maxY, ty));
  }
  function resetZoom() { scale = 1; tx = 0; ty = 0; applyTransform(); }

  async function showItem(index) {
    const item = mediaList[index];
    if (!item) return;
    currentIndex = index;

    prevBtn.style.display = index > 0 ? '' : 'none';
    nextBtn.style.display = index < mediaList.length - 1 ? '' : 'none';
    counter.textContent = `${index + 1} / ${mediaList.length}`;
    caption.textContent = `${item.senderName} · ${formatGalleryDate(item.sentAt)}`;

    img.style.display = 'none';
    vid.style.display = 'none';
    vid.pause();
    vid.src = '';
    resetZoom();

    // Show placeholder while loading
    img.src = '';
    img.style.display = item.type === 'image' ? '' : 'none';
    vid.style.display = item.type === 'video'  ? '' : 'none';
    saveBtn.dataset.fileId = item.fileId;
    saveBtn.dataset.type   = item.type;
    delBtn.dataset.messageId = item.messageId;
    delBtn.dataset.index     = index;

    try {
      const url = await loadBlob(item.fileId);
      if (item.type === 'image') {
        img.src = url;
        img.style.display = '';
        vid.style.display = 'none';
      } else {
        vid.src = url;
        vid.style.display = '';
        img.style.display = 'none';
      }
    } catch { /* silently ignore */ }
  }

  prevBtn.addEventListener('click', (e) => { e.stopPropagation(); if (currentIndex > 0) showItem(currentIndex - 1); });
  nextBtn.addEventListener('click', (e) => { e.stopPropagation(); if (currentIndex < mediaList.length - 1) showItem(currentIndex + 1); });

  // Delete individual item
  delBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const item = mediaList[currentIndex];
    if (!confirm(`Delete this ${item.type}? This cannot be undone.`)) return;
    delBtn.disabled = true;
    try {
      await requestDeleteMessage(item.messageId);
      mediaList.splice(currentIndex, 1);
      if (mediaList.length === 0) { overlay.remove(); }
      else { showItem(Math.min(currentIndex, mediaList.length - 1)); }
      onDelete?.(item.messageId);
    } catch { delBtn.disabled = false; alert('Could not delete. Please try again.'); }
  });

  // Save button
  saveBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const fileId = saveBtn.dataset.fileId;
    const type   = saveBtn.dataset.type;
    saveBtn.textContent = '…'; saveBtn.disabled = true;
    try {
      const url = await loadBlob(fileId);
      const res = await fetch(url);
      const blob = await res.blob();
      const ext = type === 'video'
        ? (blob.type.includes('webm') ? 'webm' : 'mp4')
        : (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      const ts = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `PaVa_${type}_${ts}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 15000);
    } catch { /* ignore */ } finally {
      saveBtn.textContent = '⬇ Save'; saveBtn.disabled = false;
    }
  });

  // Pinch / drag for images
  stage.addEventListener('wheel', (e) => {
    if (vid.style.display !== 'none') return;
    e.preventDefault();
    scale = Math.max(1, Math.min(6, scale * (e.deltaY < 0 ? 1.15 : 0.87)));
    clamp(); applyTransform();
  }, { passive: false });

  stage.addEventListener('mousedown', (e) => {
    if (scale <= 1 || vid.style.display !== 'none') return;
    dragging = true; dragX = e.clientX; dragY = e.clientY; applyTransform();
  });
  const onMouseMove = (e) => {
    if (!dragging) return;
    tx += e.clientX - dragX; ty += e.clientY - dragY;
    dragX = e.clientX; dragY = e.clientY;
    clamp(); applyTransform();
  };
  const onMouseUp = () => { dragging = false; applyTransform(); };
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    } else if (e.touches.length === 1 && scale > 1) {
      dragging = true; dragX = e.touches[0].clientX; dragY = e.touches[0].clientY;
    }
  }, { passive: true });
  stage.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (pinchDist) scale = Math.max(1, Math.min(6, scale * (d / pinchDist)));
      pinchDist = d; clamp(); applyTransform();
    } else if (e.touches.length === 1 && dragging) {
      e.preventDefault();
      tx += e.touches[0].clientX - dragX; ty += e.touches[0].clientY - dragY;
      dragX = e.touches[0].clientX; dragY = e.touches[0].clientY;
      clamp(); applyTransform();
    }
  }, { passive: false });
  stage.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) pinchDist = 0;
    if (e.touches.length === 0) dragging = false;
  }, { passive: true });

  stage.addEventListener('click', (e) => {
    if (e.target !== img && e.target !== stage) return;
    const now = Date.now();
    if (now - lastTap < 280) {
      if (vid.style.display === 'none') { scale = scale > 1 ? 1 : 2.5; clamp(); applyTransform(); }
    } else if (scale <= 1 && e.target === stage) {
      overlay.remove();
    }
    lastTap = now;
  });

  overlay.querySelector('.img-viewer-close').addEventListener('click', () => overlay.remove());

  const onKey = (e) => {
    if (e.key === 'Escape') { overlay.remove(); return; }
    if (e.key === 'ArrowLeft')  { if (currentIndex > 0) showItem(currentIndex - 1); }
    if (e.key === 'ArrowRight') { if (currentIndex < mediaList.length - 1) showItem(currentIndex + 1); }
  };
  window.addEventListener('keydown', onKey);
  new MutationObserver((_, obs) => {
    if (!document.getElementById('pava-img-viewer')) {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKey);
      obs.disconnect();
    }
  }).observe(document.body, { childList: true });

  document.body.appendChild(overlay);
  showItem(startIndex);
}

// ── Main gallery ──────────────────────────────────────────────────────────────

export function openMediaGallery({ chatId, chatTitle, isAdmin = false }) {
  document.getElementById('pava-media-gallery')?.remove();

  let items = [];
  let hasMore = false;
  let nextCursor = null;
  let loadingMore = false;
  let activeTab = 'media';
  let selectMode = false;
  const selected = new Set(); // messageIds

  const overlay = document.createElement('div');
  overlay.id = 'pava-media-gallery';
  overlay.className = 'media-gallery-overlay';

  function mediaItems() { return items.filter(i => i.type === 'image' || i.type === 'video'); }
  function docItems()   { return items.filter(i => i.type === 'document'); }
  function audioItems() { return items.filter(i => i.type === 'audio'); }

  function renderTabs() {
    return [
      { id: 'media', label: 'Media' },
      { id: 'docs',  label: 'Docs' },
      { id: 'audio', label: 'Audio' },
    ].map(t => `
      <button class="mg-tab ${activeTab === t.id ? 'mg-tab-active' : ''}" data-mg-tab="${t.id}">${t.label}</button>
    `).join('');
  }

  function renderMediaGrid(list) {
    if (!list.length) return '<p class="mg-empty">No media in this chat yet.</p>';
    return `<div class="mg-grid">${list.map((item, idx) => {
      const sel = selected.has(item.messageId);
      return `
        <div class="mg-cell ${selectMode && sel ? 'mg-cell-selected' : ''}" data-mg-item="${item.messageId}" data-mg-idx="${idx}" data-mg-type="${item.type}" data-mg-fileid="${item.fileId}" title="${item.senderName} · ${formatGalleryDate(item.sentAt)}">
          <div class="mg-thumb" data-state="idle">
            ${item.type === 'video' ? '<span class="mg-thumb-play">▶</span>' : ''}
            <span class="mg-thumb-icon">${item.type === 'video' ? '🎥' : '📷'}</span>
          </div>
          ${selectMode ? `<span class="mg-sel-check">${sel ? '✓' : ''}</span>` : ''}
        </div>
      `;
    }).join('')}</div>`;
  }

  function renderDocList(list) {
    if (!list.length) return '<p class="mg-empty">No documents in this chat yet.</p>';
    return `<div class="mg-doc-list">${list.map(item => {
      const ext = item.fileId.split('.').pop().toUpperCase();
      const sel = selected.has(item.messageId);
      return `
        <div class="mg-doc-row ${selectMode && sel ? 'mg-cell-selected' : ''}" data-mg-item="${item.messageId}" data-mg-type="document" data-mg-fileid="${item.fileId}">
          ${selectMode ? `<span class="mg-sel-check">${sel ? '✓' : ''}</span>` : ''}
          <span class="mg-doc-icon">📄</span>
          <div class="mg-doc-info">
            <span class="mg-doc-name">${item.fileId}</span>
            <span class="mg-doc-meta">${ext} · ${item.senderName} · ${formatGalleryDate(item.sentAt)}</span>
          </div>
          ${!selectMode ? `<button class="mg-doc-dl" data-mg-dl="${item.fileId}" title="Download">⬇</button>` : ''}
        </div>
      `;
    }).join('')}</div>`;
  }

  function renderAudioList(list) {
    if (!list.length) return '<p class="mg-empty">No voice notes in this chat yet.</p>';
    return `<div class="mg-audio-list">${list.map(item => {
      const sel = selected.has(item.messageId);
      return `
        <div class="mg-audio-row ${selectMode && sel ? 'mg-cell-selected' : ''}" data-mg-item="${item.messageId}">
          ${selectMode ? `<span class="mg-sel-check">${sel ? '✓' : ''}</span>` : ''}
          <span class="mg-audio-icon">🎤</span>
          <div class="mg-audio-info">
            <audio class="mg-audio-player" controls src="" data-mg-audio="${item.fileId}"></audio>
            <span class="mg-audio-meta">${item.senderName} · ${formatGalleryDate(item.sentAt)}</span>
          </div>
          ${!selectMode ? `<button class="mg-doc-dl" data-mg-dl="${item.fileId}" title="Download">⬇</button>` : ''}
        </div>
      `;
    }).join('')}</div>`;
  }

  function renderBody() {
    if (activeTab === 'media') return renderMediaGrid(mediaItems());
    if (activeTab === 'docs')  return renderDocList(docItems());
    if (activeTab === 'audio') return renderAudioList(audioItems());
    return '';
  }

  function paint() {
    const selectCount = selected.size;
    overlay.innerHTML = `
      <div class="mg-sheet">
        <div class="mg-header">
          <button class="mg-close" aria-label="Close">${selectMode ? 'Cancel' : '✕'}</button>
          <h2 class="mg-title">${selectMode
            ? (selectCount > 0 ? `${selectCount} selected` : 'Select items')
            : (chatTitle ? chatTitle + ' · Media' : 'Media')}</h2>
          <div class="mg-header-actions">
            ${selectMode && selectCount > 0
              ? `<button class="mg-bulk-del danger-button" aria-label="Delete selected">🗑 Delete (${selectCount})</button>`
              : ''}
            ${!selectMode && activeTab === 'media' && mediaItems().length > 0
              ? `<button class="mg-select-btn secondary-button" aria-label="Select items">Select</button>`
              : ''}
          </div>
        </div>
        <div class="mg-tabs">${renderTabs()}</div>
        <div class="mg-body" id="mg-body">
          ${items.length === 0 && !hasMore
            ? '<p class="mg-loading mg-empty">Loading…</p>'
            : renderBody()}
        </div>
        ${hasMore ? `<button class="mg-load-more secondary-button" id="mg-load-more">Load more</button>` : ''}
      </div>
    `;
    bindOverlay();
  }

  function bindOverlay() {
    const closeBtn = overlay.querySelector('.mg-close');
    closeBtn?.addEventListener('click', () => {
      if (selectMode) { selectMode = false; selected.clear(); paint(); }
      else { overlay.remove(); }
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.addEventListener('keydown', onKey);

    // Select mode toggle
    overlay.querySelector('.mg-select-btn')?.addEventListener('click', () => {
      selectMode = true; selected.clear(); paint();
    });

    // Bulk delete
    overlay.querySelector('.mg-bulk-del')?.addEventListener('click', async () => {
      if (selected.size === 0) return;
      const n = selected.size;
      if (!confirm(`Delete ${n} item${n > 1 ? 's' : ''}? This cannot be undone.`)) return;
      const btn = overlay.querySelector('.mg-bulk-del');
      if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
      const ids = [...selected];
      let failed = 0;
      for (const messageId of ids) {
        try { await requestDeleteMessage(messageId); items = items.filter(i => i.messageId !== messageId); }
        catch { failed++; }
      }
      selected.clear();
      selectMode = false;
      paint();
      if (failed) alert(`${failed} item(s) could not be deleted.`);
    });

    // Tab switching
    overlay.querySelectorAll('[data-mg-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.mgTab;
        selectMode = false; selected.clear();
        paint();
        loadAudioSrcs();
      });
    });

    const visibleMedia = mediaItems();

    // Media grid — click / long-press
    overlay.querySelectorAll('.mg-cell[data-mg-type="image"], .mg-cell[data-mg-type="video"]').forEach(cell => {
      let pressTimer = null;

      cell.addEventListener('click', async () => {
        const messageId = cell.dataset.mgItem;
        const fileId    = cell.dataset.mgFileid;
        const type      = cell.dataset.mgType;
        const idx       = parseInt(cell.dataset.mgIdx, 10);

        if (selectMode) {
          if (selected.has(messageId)) selected.delete(messageId);
          else selected.add(messageId);
          paint();
          return;
        }

        const thumb = cell.querySelector('.mg-thumb');
        if (thumb.dataset.state === 'loading') return;

        // Open the media viewer with prev/next navigation
        openMediaViewer({
          mediaList: visibleMedia.map(i => ({ ...i })),
          startIndex: idx,
          onDelete: (deletedMessageId) => {
            items = items.filter(i => i.messageId !== deletedMessageId);
            paint();
          },
        });

        // Preload in background so thumb shows on return
        if (thumb.dataset.state === 'idle') {
          loadBlob(fileId).then(url => {
            if (type === 'image') {
              thumb.style.backgroundImage = `url('${url}')`;
              thumb.innerHTML = '<span class="mg-thumb-veil"></span>';
              thumb.dataset.state = 'loaded';
            }
          }).catch(() => {});
        }
      });

      // Long-press to enter select mode
      cell.addEventListener('touchstart', () => {
        pressTimer = setTimeout(() => {
          pressTimer = null;
          selectMode = true; selected.clear();
          selected.add(cell.dataset.mgItem);
          paint();
        }, 600);
      }, { passive: true });
      cell.addEventListener('touchend', () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
      cell.addEventListener('touchcancel', () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
    });

    // Selectability for docs and audio in select mode
    overlay.querySelectorAll('.mg-doc-row[data-mg-item], .mg-audio-row[data-mg-item]').forEach(row => {
      if (!selectMode) return;
      row.addEventListener('click', () => {
        const messageId = row.dataset.mgItem;
        if (selected.has(messageId)) selected.delete(messageId);
        else selected.add(messageId);
        paint();
      });
    });

    // Background-load thumbnails for images (lazy)
    overlay.querySelectorAll('.mg-cell[data-mg-type="image"]').forEach(cell => {
      const thumb = cell.querySelector('.mg-thumb');
      if (thumb.dataset.state !== 'idle') return;
      const fileId = cell.dataset.mgFileid;
      if (blobCache.has(fileId)) {
        thumb.style.backgroundImage = `url('${blobCache.get(fileId)}')`;
        thumb.innerHTML = '<span class="mg-thumb-veil"></span>';
        thumb.dataset.state = 'loaded';
        return;
      }
      const obs = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) {
          obs.disconnect();
          loadBlob(fileId).then(url => {
            thumb.style.backgroundImage = `url('${url}')`;
            thumb.innerHTML = '<span class="mg-thumb-veil"></span>';
            thumb.dataset.state = 'loaded';
          }).catch(() => {});
        }
      }, { threshold: 0.1 });
      obs.observe(cell);
    });

    // Download buttons for docs / audio (non-select mode)
    overlay.querySelectorAll('[data-mg-dl]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const fileId = btn.dataset.mgDl;
        btn.textContent = '…'; btn.disabled = true;
        try {
          const url = await loadBlob(fileId);
          const res = await fetch(url);
          const blob = await res.blob();
          const ext = fileId.split('.').pop();
          const ts = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob); a.download = `PaVa_${ts}.${ext}`; a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 15000);
        } catch { /* ignore */ } finally {
          btn.textContent = '⬇'; btn.disabled = false;
        }
      });
    });

    overlay.querySelector('#mg-load-more')?.addEventListener('click', () => loadMore());
  }

  function loadAudioSrcs() {
    overlay.querySelectorAll('[data-mg-audio]').forEach(async (el) => {
      if (el.src && el.src !== window.location.href) return;
      try { el.src = await loadBlob(el.dataset.mgAudio); }
      catch { /* ignore */ }
    });
  }

  const onKey = (e) => {
    if (e.key === 'Escape') {
      if (selectMode) { selectMode = false; selected.clear(); paint(); }
      else { overlay.remove(); document.removeEventListener('keydown', onKey); }
    }
  };

  async function load(cursor = null) {
    try {
      const fetchFn = isAdmin ? fetchAdminChatMedia : fetchChatMedia;
      const result  = await fetchFn(chatId, cursor);
      items    = cursor ? [...items, ...(result.items || [])] : (result.items || []);
      hasMore  = result.hasMore || false;
      nextCursor = result.nextCursor || null;
    } catch {
      items = [];
    }
    paint();
    if (activeTab === 'audio') loadAudioSrcs();
  }

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    loadingMore = true;
    const btn = overlay.querySelector('#mg-load-more');
    if (btn) { btn.textContent = 'Loading…'; btn.disabled = true; }
    await load(nextCursor);
    loadingMore = false;
  }

  document.body.appendChild(overlay);
  load();
}
