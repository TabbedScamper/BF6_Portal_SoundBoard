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
  const store = new C.PageStore((...args) => fetch(...args), base);
  let initialized = false, initializing = false, categories = new Map(), currentCategory = null, currentPage = null;
  let firstPages = new Map(), request = 0, controller, entries = null, globalAvailable = false;
  let shown = [], nextVariants = new Map(), selected = new Map(), ws = null, playingClip = null, playingGroup = null;
  let lastRange = '', savedSpatial = false, savedDock = false;
  const F=window.SoundFeatures;
  let features=null, vocabulary=null, facets=null, focusAsset='';
  const rowHeight=F?380:260;
  if(F){
    features=new window.SoundFeaturePanel('game',q('gameFeatures'),()=>{q('gameSearch').value=features.state.query;q('gameGlobal').checked=!!features.state.context.global;q('gameLanguage').value=features.state.context.language||'';focusAsset='';filter();});
    q('gameSearch').value=features.state.query;q('gameGlobal').checked=!!features.state.context.global;
    features.mapOptions=()=>({section:'game',base:base+'/',key:()=>JSON.stringify([features.state,currentCategory,currentPage?.page,entries?.length,features.vocab]),name:p=>mapEntries.get(p.name)?.name||p.name,matches:p=>{if(features.state.context.category && p.cat!==features.state.context.category)return false;const e=mapEntries.get(p.name),clips=mapClips.get(p.name),state=features.state;if(clips)return clips.some(c=>(!state.context.language||c.lang===state.context.language)&&F.matches(c,state)&&F.score(c,state.query,features.vocab)>0);if(state.context.language||state.pitched||Object.keys(state.ranges).length)return false;return F.matches(e||{},state,false)&&F.score(e||{name:p.name},state.query,features.vocab)>0;},open:p=>openGameAsset(p.name,p.cat,p.page)});
  }
  let mapEntries=new Map(),mapClips=new Map();
  async function featureData(){if(!features)return;[vocabulary,facets]=await Promise.all([F.optional(base+'/index/tags.json'),F.optional(base+'/index/facets.json')]);features.data(vocabulary,currentPage?.clips||[],facets);filter();}
  async function openGameAsset(asset,category,page){q('gameGlobal').checked=false;if(features){features.state=F.empty();features.state.query=asset;}q('gameSearch').value=asset;q('gameLanguage').value='';focusAsset='';await load(category,page);const g=shown.find(g=>g.id===asset||g.name===asset);if(g){q('gameViewport').scrollTop=shown.indexOf(g)*rowHeight;draw(true);if(!q('gameLibrary').hidden&&currentCategory===String(category))play(g);}else message('Sound unavailable on its indexed page.');}
  async function similarGame(asset){
    const bytes=new TextEncoder().encode(asset),hash=new Uint8Array(await crypto.subtle.digest('SHA-1',bytes));
    const shard=Array.from(hash.slice(0,1),b=>b.toString(16).padStart(2,'0')).join('');
    const data=await F.optional(base+'/index/similar/'+shard+'.json');
    features.neighbours((data?.[asset]||[]).filter(r=>categories.has(String(r[2]))).slice(0,20).map(r=>({name:mapEntries.get(r[0])?.name||r[0],asset:r[0],score:r[1],category:r[2],page:r[3],href:F.link(location.href,'game',{...F.empty(),query:r[0],context:{category:String(r[2]),page:r[3]}})})),r=>openGameAsset(r.asset,r.category,r.page));
  }

  function switchSection(game) {
    if (game === !q('gameLibrary').hidden) return;
    if (game) {
      savedSpatial = !q('spatial').hidden; savedDock = q('dock').classList.contains('show');
      engPause(); q('spatial').hidden = true; q('dock').classList.remove('show');
    } else {
      if (ws) ws.pause();
      window.BF6UI?.audition('game', false);
      q('spatial').hidden = !savedSpatial;
      if (savedDock) q('dock').classList.add('show');
    }
    q('portalSection').hidden = game; q('statband').hidden = game; q('gameLibrary').hidden = !game;
    q('portalTab').setAttribute('aria-pressed', String(!game)); q('gameTab').setAttribute('aria-pressed', String(game));
    if(features){const url=new URL(location.href);url.searchParams.set('section',game?'game':'portal');history.replaceState(null,'',url.pathname+url.search+url.hash);}
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
          // `own` = clips directly in this category (the published index pages only those); parents without their own
          // clips just expand. Older indexes without `own` keep the button.
          const own = n.own === undefined || n.own > 0 ? button : '';
          return '<li>' + (n.children.length ? '<details><summary>' + esc(n.name) + '<small>' + Number(n.count || 0).toLocaleString() + ' · ' + duration(n.seconds) + '</small></summary>' + own + html(n.children) + '</details>' : button) + '</li>';
        }).join('') + '</ul>';
      }
      q('gameTree').innerHTML = html(nodes);
      if(features) featureData();
      initialized = true; message(nodes.length ? 'Select a category to load its first page.' : 'No categories have been published yet.');
      try {
        entries = C.searchIndex(await json('index/search.json')); globalAvailable = true; mapEntries=new Map(entries.map(e=>[e.assetPath||e.name,e]));
        q('gameGlobal').disabled = false; if(features?.state.context.category)load(features.state.context.category,features.state.context.page??null); else if(features)filter(); q('gameSearchHelp').textContent = 'Describe sounds using tags or names. Ranges apply to this page. Global search uses tags and names (up to 100 results).';
      } catch (_) { q('gameSearchHelp').textContent = 'Global search index unavailable. Search works on the loaded page.'; }
    } catch (error) { message('Game Library unavailable: ' + error.message + '. Switch sections or use Retry.'); }
    finally { initializing = false; }
  }
  q('gameRetry').onclick = () => currentCategory ? load(currentCategory, currentPage ? currentPage.page : null) : init();
  q('gameTree').onclick = e => {
    const b = e.target.closest('[data-category]');
    if (b) { q('gameGlobal').checked = false; if(features)delete features.state.context.global; focusAsset=''; load(b.dataset.category); }
  };
  async function load(category, number = null, target = '') {
    category = String(category);
    if (!categories.has(category)) { message('Search result refers to an unavailable category.'); return; }
    const ticket = ++request;
    if (controller) controller.abort();
    controller = new AbortController();
    currentCategory = category; currentPage = null; mapClips.clear();
    const node = categories.get(category);
    q('gameCategoryTitle').textContent = node.name;
    q('gameCategoryPath').textContent = node.path || node.name;
    q('gameCategoryHero').dataset.art = /tungsten/i.test(node.path || node.name) ? 'tungsten' : /aftermath/i.test(node.path || node.name) ? 'aftermath' : 'limestone';
    shown = []; selected.clear(); nextVariants.clear();
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
      currentPage = loaded; mapClips=new Map();for(const c of loaded.clips){const key=c.assetPath||c.name;if(!mapClips.has(key))mapClips.set(key,[]);mapClips.get(key).push(c);}
      const langs = [...new Set(currentPage.clips.map(c => c.lang).filter(Boolean))].sort();
      const previousLang = features?.state.context.language || q('gameLanguage').value;
      q('gameLanguage').innerHTML = '<option value="">All languages / SFX</option>' + langs.map(l => '<option>' + esc(l) + '</option>').join('');
      if (langs.includes(previousLang)) q('gameLanguage').value = previousLang;
      if (target) { q('gameSearch').value = target; q('gameLanguage').value = ''; }
      if(features) {features.state.context.category=category;features.state.context.page=loaded.page;features.state.query=q('gameSearch').value;history.replaceState(null,'',F.write(location.href,'game',features.state));features.data(vocabulary,currentPage.clips,facets);}
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
      const matches = features ? F.ranked(entries,{...features.state,query:q('gameSearch').value},features.vocab,false).slice(0,100) : C.search(entries, q('gameSearch').value);
      q('gameResults').innerHTML = matches.map((e, i) => '<button class="game-result" data-result="' + i + '">' + esc(e.name) + '<small>' + esc(categories.get(String(e.category))?.name || e.category) + '</small></button>').join('');
      q('gameResults').onclick = e => {
        const b = e.target.closest('[data-result]');
        if (b) { const hit = matches[Number(b.dataset.result)]; q('gameGlobal').checked = false; if(features){features.state=F.empty();features.state.query=hit.name;focusAsset='';} load(hit.category, hit.page ?? null, hit.name); }
      };
      message(matches.length ? matches.length + ' global matches (maximum 100). Select a name to load its page.' : 'Enter a name to search the global index.');
      return;
    }
    if(features){
      const clips=focusAsset?(currentPage?.clips||[]).filter(c=>(c.assetPath||c.name)===focusAsset):F.ranked(currentPage?.clips||[],{...features.state,query:q('gameSearch').value},features.vocab);
      shown=C.groups(clips,'',q('gameLanguage').value);
      features.map?.draw();
    }else shown = C.groups(currentPage ? currentPage.clips : [], q('gameSearch').value, q('gameLanguage').value);
    q('gameViewport').scrollTop = 0; draw(true);
    if (currentPage) message(categories.get(currentCategory).name + ': ' + shown.length + ' sounds / ' + currentPage.clips.length + ' clips on this page. Variants shown belong to this page.');
  }
  q('gameSearch').oninput = () => {if(features){focusAsset='';features.state.query=q('gameSearch').value;features.commit();}else filter();}; q('gameLanguage').onchange = () => {if(features){if(q('gameLanguage').value)features.state.context.language=q('gameLanguage').value;else delete features.state.context.language;features.commit();}else filter();}; q('gameGlobal').onchange = () => {if(features){if(q('gameGlobal').checked)features.state.context.global=true;else delete features.state.context.global;features.commit();}else filter();};
  function clipFor(g) { return g.takes.find(c => c.file === selected.get(g.id)) || g.takes[0]; }
  function draw(force = false) {
    const view = q('gameViewport');
    const r = C.windowRange(shown.length, view.scrollTop, view.clientHeight || 600,rowHeight);
    const range = r.start + ':' + r.end;
    if (!force && range === lastRange) return;
    lastRange = range;
    // Keep the one live waveform container outside the DOM being recycled.
    q('gamePlayerWave').appendChild(q('gameWaveHost'));
    q('gameList').style.height = shown.length * rowHeight + 'px';
    q('gameList').innerHTML = shown.slice(r.start, r.end).map((g, i) => {
      const c = clipFor(g);
      return '<article class="game-card" data-group="' + (r.start + i) + '" style="top:' + ((r.start + i) * rowHeight) + 'px"><h3>' + esc(g.name) + '</h3><code title="' + esc(c.assetPath) + '">' + esc(c.assetPath || c.name) + '</code><div class="card-tags"><span class="tag">' + g.takes.length + ' variants on page</span><span class="tag">v' + esc(c.variant) + ' · ' + duration(c.duration) + '</span><span class="tag">' + esc(c.lang || 'SFX') + ' · ' + esc(c.channels) + 'ch · ' + esc(c.rate) + 'Hz · ' + esc(c.codec) + '</span>' + (c.loop ? '<span class="tag tag-loop">Loop</span>' : '') + '</div>' + (c.portalName ? '<a class="game-portal tag" href="#portal=' + encodeURIComponent(c.portalName) + '" data-portal="' + esc(c.portalName) + '">Portal · ' + esc(c.portalName) + '</a>' : '') + '<div class="game-wave" data-wave-group="' + esc(g.id) + '">Waveform appears on play</div><div class="game-actions"><button class="btn" data-game-play>Play next variant</button><button class="btn" data-game-download>Download v' + esc(c.variant) + '</button></div>' + (features ? F.card(c,'game') : '') + '</article>';
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
    else if (features && e.target.closest('[data-feature-tag]')) features.tag(e.target.closest('[data-feature-tag]').dataset.featureTag);
    else if (features && e.target.closest('[data-similar]')) similarGame(e.target.closest('[data-similar]').dataset.similar).catch(()=>features.neighbours([],()=>{}));
    else if (e.target.closest('[data-game-play]')) play(g);
    else if (e.target.closest('[data-game-download]')) download(clipFor(g));
  };
  function stop() {
    window.BF6UI?.audition('game', false);
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
    window.BF6UI?.audition('game', true);
    q('gamePlayer').hidden = false; q('gamePlayingName').textContent = clip.name + ' · v' + clip.variant;
    q('gameLoop').checked = !!clip.loop;
    try {
      ws = WaveSurfer.create({ container: q('gameWaveHost'), url: audioUrl(clip), height: 64, waveColor: '#AEC0CC', progressColor: '#BFCAD1', barWidth: 2, normalize: true });
      const player = ws;
      ws.setVolume(Number(q('gameVolume').value)); ws.getMediaElement().loop = !!clip.loop;
      ws.on('error', error => { if (ws === player) { window.BF6UI?.audition('game', false); message('Audio unavailable: ' + error.message); } });
      ws.on('ready', () => { if (ws === player && !q('gameLibrary').hidden) player.play().catch(error => { if (ws === player) { window.BF6UI?.audition('game', false); message('Playback failed: ' + error.message); } }); });
      ws.on('finish', () => { if (ws === player) window.BF6UI?.audition('game', false); });
      ws.on('play', () => { if (ws === player) { window.BF6UI?.audition('game', true); q('gamePause').textContent = 'Pause'; } });
      ws.on('pause', () => { if (ws === player) { window.BF6UI?.audition('game', false); q('gamePause').textContent = 'Resume'; } });
      draw(true);
    } catch (error) { window.BF6UI?.audition('game', false); message('Playback failed: ' + error.message); }
  }
  q('gamePause').onclick = () => {
    if (!ws) return;
    const player = ws;
    if (!player.isPlaying?.()) window.BF6UI?.audition('game', true);
    player.playPause().catch(error => { if (ws === player) { window.BF6UI?.audition('game', false); message(error.message); } });
  };
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
    history.replaceState(null, '', location.pathname + (location.search || '') + '#portal=' + encodeURIComponent(name));
  }
  if(features && new URLSearchParams(location.search).get('section')==='game')switchSection(true);
})();
