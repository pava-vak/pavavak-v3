import './styles.css';
import { initTheme } from './shared/themeStore.js';
import { setServiceWorkerRegistration } from './shared/pushClient.js';

initTheme();

const app = document.querySelector('#app');

if (window.location.pathname.startsWith('/admin')) {
  import('./admin/adminPanel.js').then(({ renderAdminPanel }) => renderAdminPanel(app));
} else {
  import('./app/app.js').then(({ renderAppShell }) => renderAppShell(app));
}

// Register service worker after first paint
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      setServiceWorkerRegistration(reg);
    }).catch(() => {});

    // Listen for SW messages (notification click → open chat)
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'OPEN_CHAT' && event.data.chatId) {
        window.dispatchEvent(new CustomEvent('pava:open-chat', { detail: { chatId: event.data.chatId } }));
      }
    });
  });
}
