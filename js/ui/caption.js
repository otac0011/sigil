// Caption bar, settings panel, about dialog and one-time hints.

const $ = (sel, root = document) => root.querySelector(sel);

export function setCaption({ name, ward, blurb, extra = '' }) {
  const root = $('#caption');
  root.classList.add('swap');
  setTimeout(() => {
    $('#cap-name').textContent = name;
    $('#cap-ward').textContent = ward;
    $('#cap-blurb').textContent = blurb;
    $('#cap-extra').textContent = extra;
    root.classList.remove('swap');
  }, 160);
}

export function formatDistance(m) {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

let hintTimer = 0;
export function showHint(text, ms = 5000) {
  const el = $('#hint');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => el.classList.remove('on'), ms);
}
export const hideHint = () => $('#hint').classList.remove('on');

export function bindSettings({ atmosphere, heightMode, onHeight, quality, onQuality }) {
  const panel = $('#settings'), btn = $('#settings-btn');
  btn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    btn.setAttribute('aria-expanded', String(!panel.hidden));
  });
  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
  });

  const heights = panel.querySelectorAll('[data-height]');
  const markHeight = (mode) => heights.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.height === mode)));
  heights.forEach((b) => b.addEventListener('click', () => { markHeight(b.dataset.height); onHeight(b.dataset.height); }));
  markHeight(heightMode);

  const time = $('#time'), auto = $('#time-auto'), label = $('#time-label');
  const describe = (p) => {
    const br = 0.5 - 0.5 * Math.cos(Math.PI * 2 * p);
    return br > 0.85 ? 'Peak' : br < 0.15 ? 'Antipeak' : p < 0.5 ? 'Brightening' : 'Dimming';
  };
  const syncTime = () => { time.value = String(Math.round(atmosphere.phase * 1000)); label.textContent = describe(atmosphere.phase); };
  time.addEventListener('input', () => { atmosphere.setPhase(Number(time.value) / 1000); auto.checked = false; atmosphere.auto = false; label.textContent = describe(atmosphere.phase); });
  auto.addEventListener('change', () => { atmosphere.auto = auto.checked; });
  syncTime();

  const qualityBtns = panel.querySelectorAll('[data-quality]');
  qualityBtns.forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.quality === quality));
    b.addEventListener('click', () => { if (b.dataset.quality !== quality) onQuality(b.dataset.quality); });
  });

  return { syncTime, markHeight };
}

export function bindAbout() {
  const dlg = $('#about');
  $('#about-btn').addEventListener('click', () => dlg.showModal());
  $('#about-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}
