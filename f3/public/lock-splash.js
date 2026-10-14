if (localStorage.getItem('pava-app-lock-enabled') === 'true') {
  var s = document.getElementById('app-lock-splash');
  if (s) {
    s.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0d1f16;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;';
    s.innerHTML = '<div style="font-size:52px">🔐</div><p style="color:#7fb89e;margin:0;font:500 13px/1 system-ui,sans-serif;letter-spacing:.08em">PAVA VAK</p>';
  }
}
