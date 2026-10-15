// Runs synchronously before any JS module or stylesheet loads.
// Stamps data-locked on <html> and styles the cover inline, so the very first
// paint is the lock cover rather than a white or unstyled page.
(function () {
  if (localStorage.getItem('pava-app-lock-enabled') !== 'true') return;

  document.documentElement.setAttribute('data-locked', '1');

  var css = 'html[data-locked] #app{visibility:hidden}' +
    'html[data-locked],html[data-locked] body{background:#0b1326}' +
    '#app-lock-splash.app-lock-splash-cover{position:fixed;inset:0;z-index:9999;background:#0b1326;' +
    'display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px}' +
    '#app-lock-splash .app-lock-splash-label{color:#8f9097;margin:0;font:600 12px/1 system-ui,sans-serif;' +
    'letter-spacing:.12em;text-transform:uppercase}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var s = document.getElementById('app-lock-splash');
  if (s) {
    s.className = 'app-lock-splash-cover';
    s.innerHTML = '<div style="font-size:52px;line-height:1">🔐</div>' +
                  '<p class="app-lock-splash-label">Pava Vak</p>';
  }
}());
