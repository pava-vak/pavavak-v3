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
      <form class="people-search" data-role="people-search">
        <input name="query" type="search" placeholder="Search people…" autocomplete="off" value="${escapeHtml(state.query || '')}" />
        <button type="submit">Go</button>
      </form>
      ${state.error ? `<p style="padding: 4px 16px; margin: 0; font-size: 12px; color: var(--v3-danger);">${escapeHtml(state.error)}</p>` : ''}
      <div class="people-list">
        ${state.status === 'loading' ? '<p style="padding: 8px 16px; margin: 0; font-size: 13px; color: var(--v3-muted);">Searching…</p>' : ''}
        ${state.status !== 'loading' && !state.items.length ? '<p style="padding: 8px 16px; margin: 0; font-size: 13px; color: var(--v3-muted);">No people found.</p>' : ''}
        ${state.items.map(renderPerson).join('')}
      </div>
    </section>
  `;
}

export function bindPeopleView(root, { onSearch, onStartChat }) {
  const form = root.querySelector('[data-role="people-search"]');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    onSearch(String(formData.get('query') || ''));
  });

  root.querySelectorAll('[data-user-id]').forEach((button) => {
    button.addEventListener('click', () => onStartChat(Number(button.dataset.userId)));
  });
}
