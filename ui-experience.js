/* Quiet, gesture-only cues. Both audition engines own their own mute locks. */
(() => {
  'use strict';
  const key = 'bf6-ui-sounds', toggle = document.getElementById('uiSoundToggle');
  const locks = new Set(), voices = new Set();
  const cues = ['hover', 'select', 'back', 'tab_switch', 'toggle_on', 'toggle_off', 'slider_tick'];
  let enabled = false, lastHover = -Infinity, lastSlider = -Infinity;
  try { enabled = localStorage.getItem(key) === 'on'; } catch (_) {}
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function updateMotion() { document.documentElement.classList.toggle('reduced-motion', motion.matches); }
  updateMotion(); motion.addEventListener('change', updateMotion);
  function silence() {
    for (const voice of voices) { voice.pause(); voice.currentTime = 0; }
    voices.clear();
  }
  function cue(name) {
    if (!enabled || locks.size || !cues.includes(name)) return;
    // Preserve small cue polyphony, while keeping repeated pointer events bounded.
    if (voices.size >= 4) return;
    const voice = new Audio('assets/ui/' + name + '.wav');
    voice.volume = 0.12; voices.add(voice);
    const done = () => voices.delete(voice);
    voice.addEventListener('ended', done, { once: true });
    voice.addEventListener('error', done, { once: true });
    voice.play().catch(done);
  }
  function paint() {
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.textContent = 'UI sounds: ' + (enabled ? 'ON' : 'OFF');
  }
  paint();
  toggle.addEventListener('click', () => {
    enabled = !enabled;
    try { localStorage.setItem(key, enabled ? 'on' : 'off'); } catch (_) {}
    silence(); paint(); if (enabled) cue('toggle_on');
  });
  window.BF6UI = {
    audition(owner, busy) { if (busy) { locks.add(owner); silence(); } else locks.delete(owner); },
    get reducedMotion() { return motion.matches; }
  };
  const control = target => target.closest('button, a[href], summary, input[type="checkbox"], select');
  document.addEventListener('pointerover', e => {
    const el = control(e.target);
    if (!e.isTrusted || !el || el.disabled || (e.relatedTarget && el.contains(e.relatedTarget))) return;
    const now = performance.now(); if (now - lastHover < 100) return;
    lastHover = now; cue('hover');
  });
  document.addEventListener('click', e => {
    const el = control(e.target);
    if (!e.isTrusted || !el || el.disabled || el === toggle) return;
    // Starting/resuming a clip is intentionally silent, including keyboard activation.
    if (el.matches('.play-btn, [data-game-play], #dockPlay, #spPlay, #gamePause')) return;
    if (el.matches('#portalTab, #gameTab')) cue('tab_switch');
    else if (el.matches('.about-close, #spClose')) cue('back');
    else if (el.matches('input[type="checkbox"]')) cue(el.checked ? 'toggle_on' : 'toggle_off');
    else cue('select');
  });
  document.addEventListener('input', e => {
    if (!e.isTrusted || !e.target.matches('input[type="range"]')) return;
    const now = performance.now(); if (now - lastSlider < 100) return;
    lastSlider = now; cue('slider_tick');
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) silence(); });
})();
