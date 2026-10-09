/* Independent Game Library player and UI; Portal keeps its original engine. */
(() => {
  'use strict';
  const C = window.GameLibraryCore, cfg = window.SB_CONFIG.gameLibrary;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const fixture = local && (cfg.useFixture || new URLSearchParams(location.search).get('gameFixture') === '1');
  const base = (fixture ? cfg.fixtureBaseUrl : cfg.baseUrl).replace(/\/$/, '');
  const q = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const duration = seconds => seconds < 60 ? Number(seconds || 0).toFixed(2) + 's' : Math.floor(seconds / 60) + 'm ' + Math.floor(seconds % 60) + 's';
  const audioUrl = c => base + '/audio/' + C.relativePath(c.file);
  const store = new C.PageStore(fetch, base);
  let initialized = false, initializing = false, categories = new Map(), currentCategory = null, currentPage = null;
  let firstPages = new Map(), request = 0, controller, entries = null, globalAvailable = false;
  let shown = [], nextVariants = new Map(), selected = new Map(), ws = null, playingClip = null, playingGroup = null;
  let lastRange = '', savedSpatial = false, savedDock = false;

  function switchSection(game) {
    if (game === !q('gameLibrary').hidden) return;
    if (game) {
      savedSpatial = !q('spatial').hidden; savedDock = q('dock').classList.contains('show');
      engPause(); q('spatial').hidden = true; q('dock').classList.remove('show');
    } else {
      if (ws) ws.pause();
      q('spatial').hidden = !savedSpatial;
      if (savedDock) q('dock').classList.add('show');
    }
    q('portalSection').hidden = game; q('statband').hidden = game; q('gameLibrary').hidden = !game;
    q('portalTab').setAttribute('aria-pressed', String(!game)); q('gameTab').setAttribute('aria-pressed', String(game));
    if (game) { init(); requestAnimationFrame(() => draw(true)); }
  }
  q('portalTab').onclick = () => switchSection(false);
  q('gameTab').onclick = () => switchSection(true);
  function message(text) { q('gameStatus').textContent = text; }
  async function json(path) {
    const r = await fetch(base + '/' + path);
    if (!r.ok) throw new Error('Index request failed (' + r.status + ')');
    return r.json();
  }
  async function init() {
    if (initialized || initializing) return;
    initializing = true; message('Loading categories…');
    try {
      const nodes = C.tree(await json('index/tree.json'));
      function html(nodes) {
        return '<ul>' + nodes.map(n => {
          categories.set(n.id, n);
          const button = '<button data-category="' + esc(n.id) + '" title="' + esc(n.path || n.name) + '">' + esc(n.name) + '<small>' + Number(n.count || 0).toLocaleString() + ' · ' + duration(n.seconds) + '</small></button>';
          return '<li>' + (n.children.length ? '<details><summary>' + esc(n.name) + '<small>' + Number(n.count || 0).toLocaleString() + ' · ' + duration(n.seconds) + '</small></summary>' + button + html(n.children) + '</details>' : button) + '</li>';
        }).join('') + '</ul>';
      }
      q('gameTree').innerHTML = html(nodes);
      initialized = true; message(nodes.length ? 'Select a category to load its first page.' : 'No categories have been published yet.');
      try {
        entries = C.searchIndex(await json('index/search.json')); globalAvailable = true;
        q('gameGlobal').disabled = false; q('gameSearchHelp').textContent = 'Search this page, or enable global name search (up to 100 results).';
      } catch (_) { q('gameSearchHelp').textContent = 'Global name index unavailable. Search works on the loaded page.'; }
    } catch (error) { message('Game Library unavailable: ' + error.message + '. Switch sections or use Retry.'); }
    finally { initializing = false; }
  }
  q('gameRetry').onclick = () => currentCategory ? load(currentCategory, currentPage ? currentPage.page : null) : init();
  q('gameTree').onclick = e => {
    const b = e.target.closest('[data-category]');
    if (b) { q('gameGlobal').checked = false; load(b.dataset.category); }
  };
  async function load(category, number = null, target = '') {
    category = String(category);
    if (!categories.has(category)) { message('Search result refers to an unavailable category.'); return; }
    const ticket = ++request;
    if (controller) controller.abort();
    controller = new AbortController();
    currentCategory = category; currentPage = null; shown = []; selected.clear(); nextVariants.clear();
    stop(); q('gameViewport').scrollTop = 0; draw(true); paging();
    message('Loading ' + categories.get(category).name + '…');
    q('gameTree').querySelectorAll('[data-category]').forEach(b => b.setAttribute('aria-current', String(b.dataset.category === category)));
    try {
      // The unsuffixed page declares whether this export numbers pages from zero or one.
      let loaded = null;
      if (!firstPages.has(category)) {
        const first = await store.load(C.pagePath(category, 0), controller.signal);
        if (ticket !== request) return;
        firstPages.set(category, first.page);
        if (number == null || number === first.page) loaded = first;
      }
      if (!loaded) loaded = await store.load(C.pagePath(category, number == null ? firstPages.get(category) : number, firstPages.get(category)), controller.signal);
      if (ticket !== request) return;
      currentPage = loaded;
      const langs = [...new Set(currentPage.clips.map(c => c.lang).filter(Boolean))].sort();
      const previousLang = q('gameLanguage').value;
      q('gameLanguage').innerHTML = '<option value="">All languages / SFX</option>' + langs.map(l => '<option>' + esc(l) + '</option>').join('');
      if (langs.includes(previousLang)) q('gameLanguage').value = previousLang;
      if (target) { q('gameSearch').value = target; q('gameLanguage').value = ''; }
      paging(); filter();
    } catch (error) { if (ticket === request && error.name !== 'AbortError') message('Could not load category page: ' + error.message + '. Use Retry.'); }
  }
  function paging() {
    const first = firstPages.get(currentCategory) || 0;
    q('gamePrev').disabled = !currentPage || currentPage.page <= first;
    q('gameNext').disabled = !currentPage || currentPage.page >= first + currentPage.pages - 1;
    q('gamePage').textContent = currentPage ? 'Page ' + (currentPage.page - first + 1) + ' / ' + currentPage.pages : '';
  }
  q('gamePrev').onclick = () => load(currentCategory, currentPage.page - 1);
  q('gameNext').onclick = () => load(currentCategory, currentPage.page + 1);
  function filter() {
    const global = q('gameGlobal').checked && globalAvailable;
    q('gameResults').hidden = !global; q('gameViewport').hidden = global; q('gamePaging').hidden = global;
    q('gameLanguage').disabled = global;
    if (global) {
      const matches = C.search(entries, q('gameSearch').value);
      q('gameResults').innerHTML = matches.map((e, i) => '<button class="game-result" data-result="' + i + '">' + esc(e.name) + '<small>' + esc(categories.get(String(e.category))?.name || e.category) + '</small></button>').join('');
      q('gameResults').onclick = e => {
        const b = e.target.closest('[data-result]');
        if (b) { const hit = matches[Number(b.dataset.result)]; q('gameGlobal').checked = false; load(hit.category, hit.page ?? null, hit.name); }
      };
      message(matches.length ? matches.length + ' global matches (maximum 100). Select a name to load its page.' : 'Enter a name to search the global index.');
      return;
    }
    shown = C.groups(currentPage ? currentPage.clips : [], q('gameSearch').value, q('gameLanguage').value);
    q('gameViewport').scrollTop = 0; draw(true);
    if (currentPage) message(categories.get(currentCategory).name + ': ' + shown.length + ' sounds / ' + currentPage.clips.length + ' clips on this page. Variants shown belong to this page.');
  }
  q('gameSearch').oninput = filter; q('gameLanguage').onchange = filter; q('gameGlobal').onchange = filter;
  function clipFor(g) { return g.takes.find(c => c.file === selected.get(g.id)) || g.takes[0]; }
  function draw(force = false) {
    const view = q('gameViewport');
    const r = C.windowRange(shown.length, view.scrollTop, view.clientHeight || 600);
    const range = r.start + ':' + r.end;
    if (!force && range === lastRange) return;
    lastRange = range;
    // Keep the one live waveform container outside the DOM being recycled.
    q('gamePlayerWave').appendChild(q('gameWaveHost'));
    q('gameList').style.height = shown.length * 260 + 'px';
    q('gameList').innerHTML = shown.slice(r.start, r.end).map((g, i) => {
      const c = clipFor(g);
      return '<article class="game-card" data-group="' + (r.start + i) + '" style="top:' + ((r.start + i) * 260) + 'px"><h3>' + esc(g.name) + '</h3><code title="' + esc(c.assetPath) + '">' + esc(c.assetPath || c.name) + '</code><div class="card-tags"><span class="tag">' + g.takes.length + ' variants on page</span><span class="tag">v' + esc(c.variant) + ' · ' + duration(c.duration) + '</span><span class="tag">' + esc(c.lang || 'SFX') + ' · ' + esc(c.channels) + 'ch · ' + esc(c.rate) + 'Hz · ' + esc(c.codec) + '</span>' + (c.loop ? '<span class="tag tag-loop">Loop</span>' : '') + '</div>' + (c.portalName ? '<a class="game-portal tag" href="#portal=' + encodeURIComponent(c.portalName) + '" data-portal="' + esc(c.portalName) + '">Portal · ' + esc(c.portalName) + '</a>' : '') + '<div class="game-wave" data-wave-group="' + esc(g.id) + '">Waveform appears on play</div><div class="game-actions"><button class="btn" data-game-play>Play next variant</button><button class="btn" data-game-download>Download v' + esc(c.variant) + '</button></div></article>';
    }).join('');
    if (ws && playingGroup) {
      const host = [...q('gameList').querySelectorAll('[data-wave-group]')].find(el => el.dataset.waveGroup === playingGroup);
      if (host) { host.textContent = ''; host.appendChild(q('gameWaveHost')); }
      else q('gamePlayerWave').appendChild(q('gameWaveHost'));
    }
  }
  q('gameViewport').onscroll = () => draw();
  q('gameList').onclick = e => {
    const article = e.target.closest('[data-group]'); if (!article) return;
    const g = shown[Number(article.dataset.group)];
    const badge = e.target.closest('[data-portal]');
    if (badge) { e.preventDefault(); openPortal(badge.dataset.portal); }
    else if (e.target.closest('[data-game-play]')) play(g);
    else if (e.target.closest('[data-game-download]')) download(clipFor(g));
  };
  function stop() {
    if (ws) ws.destroy(); ws = null; playingClip = null; playingGroup = null;
    q('gamePlayer').hidden = true;
    q('gamePlayerWave').appendChild(q('gameWaveHost'));
    q('gameWaveHost').textContent = '';
  }
  async function play(g) {
    const { clip, next } = C.cycle(g.takes, nextVariants.get(g.id) || 0);
    nextVariants.set(g.id, next); selected.set(g.id, clip.file);
    stop(); playingClip = clip; playingGroup = g.id;
    engPause();
    q('gamePlayer').hidden = false; q('gamePlayingName').textContent = clip.name + ' · v' + clip.variant;
    q('gameLoop').checked = !!clip.loop;
    try {
      ws = WaveSurfer.create({ container: q('gameWaveHost'), url: audioUrl(clip), height: 64, waveColor: '#827a6c', progressColor: '#ff6b1a', barWidth: 2, normalize: true });
      const player = ws;
      ws.setVolume(Number(q('gameVolume').value)); ws.getMediaElement().loop = !!clip.loop;
      ws.on('error', error => message('Audio unavailable: ' + error.message));
      ws.on('ready', () => { if (ws === player) player.play().catch(error => message('Playback failed: ' + error.message)); });
      ws.on('play', () => { q('gamePause').textContent = 'Pause'; });
      ws.on('pause', () => { q('gamePause').textContent = 'Resume'; });
      draw(true);
    } catch (error) { message('Playback failed: ' + error.message); }
  }
  q('gamePause').onclick = () => { if (ws) ws.playPause().catch(error => message(error.message)); };
  q('gameLoop').onchange = () => { if (ws) ws.getMediaElement().loop = q('gameLoop').checked; };
  q('gameVolume').oninput = () => { if (ws) ws.setVolume(Number(q('gameVolume').value)); };
  q('gamePlayingDownload').onclick = () => { if (playingClip) download(playingClip); };
  async function download(clip) {
    try {
      const r = await fetch(audioUrl(clip)); if (!r.ok) throw new Error('HTTP ' + r.status);
      const url = URL.createObjectURL(await r.blob()), a = document.createElement('a');
      a.href = url; a.download = clip.name.replace(/[<>:"/\\|?*]/g, '_') + '_v' + clip.variant + '.opus'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (error) { message('Download failed: ' + error.message); }
  }
  function openPortal(name) {
    switchSection(false);
    curCat = 'All'; curType = 'all'; curTerm = name.toLowerCase();
    q('search').value = name; document.querySelector('.search').classList.add('has-text');
    document.querySelectorAll('#chips .chip').forEach(b => b.classList.toggle('active', b.dataset.cat === 'All'));
    document.querySelectorAll('.tpill').forEach(b => b.classList.toggle('active', b.dataset.type === 'all'));
    render();
    const card = [...q('grid').querySelectorAll('[data-name]')].find(el => el.dataset.name === name);
    if (card) { card.id = 'portal-' + name; card.scrollIntoView({ block: 'center' }); card.tabIndex = -1; card.focus({ preventScroll: true }); }
    else toast('Portal card unavailable: ' + name);
    history.replaceState(null, '', '#portal=' + encodeURIComponent(name));
  }
})();
