let _canvas = null;
let _ctx = null;
let _baseImg = null;
let _baseLoaded = false;
let _lastCount = -1;

function getCanvas() {
  if (!_canvas) {
    _canvas = document.createElement('canvas');
    _canvas.width = 32;
    _canvas.height = 32;
    _ctx = _canvas.getContext('2d');
  }
  return { canvas: _canvas, ctx: _ctx };
}

function loadBase() {
  return new Promise((resolve) => {
    if (_baseLoaded) { resolve(); return; }
    const img = new Image();
    img.onload = () => { _baseImg = img; _baseLoaded = true; resolve(); };
    img.onerror = () => { _baseLoaded = true; resolve(); };
    img.src = '/icon.png';
  });
}

function applyFavicon(dataUrl) {
  let link = document.querySelector("link[rel~='icon'][data-badge]");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.setAttribute('data-badge', '1');
    document.head.appendChild(link);
  }
  link.href = dataUrl;
}

export async function updateFaviconBadge(count) {
  if (count === _lastCount) return;
  _lastCount = count;

  const title = 'PaVa Vak';
  document.title = count > 0 ? `(${count > 99 ? '99+' : count}) ${title}` : title;

  await loadBase();
  const { canvas, ctx } = getCanvas();
  ctx.clearRect(0, 0, 32, 32);

  if (_baseImg) ctx.drawImage(_baseImg, 0, 0, 32, 32);

  if (count > 0) {
    const label = count > 99 ? '99+' : String(count);
    const badgeR = label.length > 2 ? 11 : 9;
    const cx = 32 - badgeR;
    const cy = badgeR;

    ctx.beginPath();
    ctx.arc(cx, cy, badgeR, 0, 2 * Math.PI);
    ctx.fillStyle = '#e53935';
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${label.length > 2 ? 8 : 11}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy + 0.5);
  }

  applyFavicon(canvas.toDataURL('image/png'));
}
