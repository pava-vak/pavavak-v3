// Runs synchronously before any JS module loads.
// Stamps data-locked on <html> so CSS hides #app before the first paint.
// app.js removes the attribute after successful auth.
(function () {
  if (localStorage.getItem('pava-app-lock-enabled') !== 'true') return;

  // CSS-level guard: html[data-locked] #app { visibility: hidden }
  document.documentElement.setAttribute('data-locked', '1');

  // Visual splash overlay
  var s = document.getElementById('app-lock-splash');
  if (s) {
    s.className = 'app-lock-splash-cover';
    s.innerHTML = '<div style="font-size:52px;line-height:1">🔐</div>' +
                  '<p class="app-lock-splash-label">Pava Vak</p>';
  }
}());
