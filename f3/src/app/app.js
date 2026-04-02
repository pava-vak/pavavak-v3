export function renderAppShell(root) {
  root.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <h1>PaVa-V3</h1>
        <p>Clean-room messenger scaffold.</p>
      </aside>
      <main class="content">
        <h2>Ready for V3</h2>
        <p>The UI scaffold is in place. Next we wire auth, chats, thread, and realtime.</p>
      </main>
    </div>
  `;
}
