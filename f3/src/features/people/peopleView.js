import { escapeHtml } from '../../shared/html.js';

function renderPerson(user) {
  return `
    <button class="person-row" type="button" data-user-id="${escapeHtml(user.userId)}">
      <span class="chat-avatar">${escapeHtml((user.displayName || user.username || '?').slice(0, 1).toUpperCase())}</span>
      <span class="chat-copy">
        <strong>${escapeHtml(user.displayName)}</strong>
        <small>@${escapeHtml(user.username)}</small>
      </span>
    </button>
  `;
}

export function renderPeopleView(state) {
  return `
    <section class="people-panel">
      <div class="sidebar-section-label">People</div>
      <div class="people-search-wrap">
        <input class="people-search-input" data-role="people-search-input" type="search"
               placeholder="Search people…" autocomplete="off"
               value="${escapeHtml(state.query || '')}" />
      </div>
      ${state.error ? `<p class="people-status people-status--error">${escapeHtml(state.error)}</p>` : ''}
      <div class="people-list">
        ${state.status === 'loading' ? '<p class="people-status">Searching…</p>' : ''}
        ${state.status === 'idle' && !state.items.length ? '<p class="people-status">Type a name to search.</p>' : ''}
        ${state.status === 'ready' && !state.items.length ? '<p class="people-status">No people found.</p>' : ''}
        ${state.items.map(renderPerson).join('')}
      </div>
    </section>
  `;
}

export function bindPeopleView(root, { onSearch, onStartChat }) {
  const input = root.querySelector('[data-role="people-search-input"]');
  if (input) {
    let debounceTimer = null;
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const q = input.value.trim();
      if (!q) { onSearch(''); return; }
      debounceTimer = setTimeout(() => onSearch(q), 300);
    });
    // Still support Enter for instant search
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(debounceTimer);
        onSearch(input.value.trim());
      }
    });
  }

  root.querySelectorAll('[data-user-id]').forEach((button) => {
    button.addEventListener('click', () => onStartChat(Number(button.dataset.userId)));
  });
}
