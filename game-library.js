/* Game Library paging and section-owned state. Presentation and playback are shared with Portal. */
(() => {
  'use strict';
  const C = window.GameLibraryCore, F = window.SoundFeatures, player = window.LibraryPlayer;
  const cfg = Object.assign({ baseUrl: 'https://pub-1da528aa57f643bc9e8c257d3ab2d853.r2.dev', fixtureBaseUrl: 'notes/fixture', useFixture: false }, (window.SB_CONFIG || {}).gameLibrary);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const fixture = local && (cfg.useFixture || new URLSearchParams(location.search).get('gameFixture') === '1');
  const base = (fixture ? cfg.fixtureBaseUrl : cfg.baseUrl).replace(/\/$/, '');
  const q = id => document.getElementById(id), esc = F.escape;
  // Turned off: Portal Sounds only. Local fixture runs keep it on for the tests.
  if (cfg.enabled === false && !fixture) {
    q('librarySwitch')?.remove(); q('gameLibrary')?.remove();
    document.querySelectorAll('[data-game-library]').forEach(e => e.remove());
    return;
  }
  const store = new C.PageStore((...args) => fetch(...args), base);
  const categories = new Map(), parents = new Map(), firstPages = new Map();
  let roots = [], initialized = false, initializing = false, currentCategory = null, currentPage = null;
  let entries = [], indexAvailable = false, request = 0, controller, shown = [], hits = [];
  let vocabulary = null, facets = null, focusAsset = '', playingClip = null;
  let mapEntries = new Map(), mapClips = new Map();
  let linkedAsset = '';
  const selected = new Map(), nextVariants = new Map();
  const resultMetadata = new Map(), pendingIndexPages = new Map();
  let resultObserver, resultController, resultTicket = 0, resultKey = '';
  const features = new window.SoundFeaturePanel('game', q('gameFeatures'), stateChanged);
  delete features.state.context.global;
  features.contextLabel=(key,value)=>key==='category'?(categories.get(value)?.name || 'Category'):key==='page'?'Page '+(value-(firstPages.get(currentCategory)||0)+1):key==='language'?(value==='sfx'?'SFX':value):key+' '+value;
  q('gameSearch').value = features.state.query;
  function stateChanged() {
    q('gameSearch').value = features.state.query; focusAsset = ''; linkedAsset = '';
    const context = features.state.context;
    if ((context.category || null) !== currentCategory || (currentPage && context.page != null && context.page !== currentPage.page)) {
      if (context.category) navigate(context.category, context.page ?? null);
      else resetCategory();
    }
    languageChips(); filter();
  }
  features.mapOptions = () => ({section:'game', base:base+'/',
    key:()=>JSON.stringify([features.state,currentCategory,currentPage?.page,entries.length,features.vocab]),
    name:p=>mapEntries.get(p.name)?.name || p.name,
    matches:p=> {
      const state = features.state, clips = mapClips.get(p.name), e = mapEntries.get(p.name);
      if (state.context.category && p.cat !== state.context.category) return false;
      if (clips) return clips.some(c=>languageMatch(c,state.context.language) && F.matches(c,state) && F.score(c,state.query,features.vocab)>0);
      if (state.context.language || state.pitched || Object.keys(state.ranges).length) return false;
      return F.matches(e || {},state,false) && F.score(e || {name:p.name},state.query,features.vocab)>0;
    }, open:p=>openGameAsset(p.name,p.cat,p.page)});
  function switchSection(game,preserveSound=false) {
    if (game === !q('gameLibrary').hidden) return;
    player.section(game ? 'game' : 'portal');
    q('portalSection').hidden = game; q('statband').hidden = game; q('gameLibrary').hidden = !game;
    q('portalTab').setAttribute('aria-pressed', String(!game)); q('gameTab').setAttribute('aria-pressed', String(game));
    const url = new URL(location.href); url.searchParams.set('section',game?'game':'portal');
    if(!preserveSound)url.searchParams.delete('sound');
    history.replaceState(null,'',url.pathname+url.search+url.hash);
    if (game) {if(initialized){languageChips();filter();}else init();}
    else {resultController?.abort();resultObserver?.disconnect();resultTicket++;}
  }
  q('portalTab').onclick = () => switchSection(false);
  q('gameTab').onclick = () => switchSection(true);
  window.addEventListener('popstate',()=>switchSection(new URLSearchParams(location.search).get('section')==='game',true));
  function message(text, error = false) {q('gameStatus').textContent = text; q('gameRetry').hidden = !error;}
  async function json(path) {const r = await fetch(base+'/'+path); if (!r.ok) throw Error('Index request failed ('+r.status+')'); return r.json();}
  async function init() {
    if (initialized || initializing) return;
    initializing = true; message('Loading categories...');
    try {
      roots = C.tree(await json('index/tree.json'));
      function visit(nodes,parent=null) {for(const n of nodes){categories.set(n.id,n);parents.set(n.id,parent);visit(n.children,n.id);}}
      visit(roots); initialized = true; categoryChips(); languageChips();
      message('Select a category or search the library.');
      // Optional search and feature indexes never block browsing or playback.
      const data = await Promise.allSettled([json('index/search.json'),F.optional(base+'/index/tags.json'),F.optional(base+'/index/facets.json')]);
      if(data[0].status==='fulfilled') {
        entries=C.searchIndex(data[0].value).map(e=>{
          const path=categories.get(String(e.category))?.path || e.assetPath || '';
          const language=path.match(/(?:^|\/)vo\/events\/([a-z]{2}(?:-[a-z]{2})?)(?:\/|$)/i)?.[1];
          return language && !e.lang ? {...e,lang:language} : e;
        });
        indexAvailable=true;mapEntries=new Map(entries.map(e=>[e.assetPath||e.name,e]));
      }
      vocabulary=data[1].status==='fulfilled'?data[1].value:null;facets=data[2].status==='fulfilled'?data[2].value:null;
      features.data(vocabulary,currentPage?.clips||[],facets);languageChips();
      const params = new URLSearchParams(location.search);
      if (params.get('section') === 'game' && params.has('sound')) {
        await openSoundLink(params.get('sound'));
        return;
      }
      if(features.state.context.category) {
        focusAsset = features.state.query;
        await navigate(features.state.context.category,features.state.context.page??null);
        if (currentPage && focusAsset && !mapClips.has(focusAsset)) {focusAsset='';filter();}
      }
      else filter();
      if(!indexAvailable) message('Library search unavailable. Search works on the loaded page.');
    } catch(error) {initialized=false;message('Game Library unavailable: '+error.message,true);}
    finally {initializing=false;}
  }
  function chip(n,active=false,label=n.name,count=n.count) {
    return '<button class="chip'+(active?' active':'')+'" data-category="'+esc(n.id)+'" aria-pressed="'+active+'">'+esc(label)+' <span class="cnt">'+Number(count||0).toLocaleString()+'</span></button>';
  }
  function categoryChips() {
    let top=currentCategory;while(parents.get(top))top=parents.get(top);
    q('gameTree').innerHTML='<button class="chip'+(!currentCategory?' active':'')+'" data-category="" aria-pressed="'+!currentCategory+'">All <span class="cnt">'+roots.reduce((sum,n)=>sum+Number(n.count||0),0).toLocaleString()+'</span></button>'+roots.map(n=>chip(n,n.id===top)).join('');
    const node=categories.get(currentCategory), trail=[];
    for(let id=currentCategory;id;id=parents.get(id))trail.unshift(categories.get(id));
    q('gameBreadcrumb').hidden=!node;
    q('gameBreadcrumb').innerHTML='<button data-category="">Game Library</button>'+trail.map(n=>'<span aria-hidden="true">/</span><button data-category="'+esc(n.id)+'" aria-current="'+(n.id===currentCategory?'page':'false')+'">'+esc(n.name)+'</button>').join('');
    q('gameChildren').hidden=!node?.children.length;
    q('gameChildren').innerHTML=node?.children.length?(node.own===undefined||node.own>0?'<button class="chip'+(currentPage?' active':'')+'" data-own="'+esc(node.id)+'">In this folder <span class="cnt">'+Number(node.own??node.count??0).toLocaleString()+'</span></button>':'')+node.children.map(n=>chip(n)).join(''):'';
  }
  function resetCategory() {
    ++request;controller?.abort();currentCategory=null;currentPage=null;mapClips.clear();shown=[];selected.clear();nextVariants.clear();player.release();playingClip=null;q('gameDownload').disabled=true;
    features.data(vocabulary,[],facets);categoryChips();paging();draw();
  }
  async function navigate(category,number=null,own=false) {
    if(!category){resetCategory();filter();return;}
    const node=categories.get(String(category));if(!node){message('Sound category unavailable.');return;}
    if(node.children.length && !own && number==null) {
      resetCategory();currentCategory=node.id;features.state.context.category=node.id;delete features.state.context.page;
      history.replaceState(null,'',F.write(location.href,'game',features.state));features.refresh();categoryChips();message('Select a subcategory'+(node.own>0?' or In this folder.':'.'));return;
    }
    await load(node.id,number);
  }
  function categoryClick(e) {
    const b=e.target.closest('[data-category],[data-own]');if(!b)return;
    linkedAsset='';
    features.state.query='';q('gameSearch').value='';focusAsset='';delete features.state.context.page;
    if(b.dataset.category)features.state.context.category=b.dataset.category;else delete features.state.context.category;
    history.replaceState(null,'',F.write(location.href,'game',features.state));features.refresh();
    navigate(b.dataset.own||b.dataset.category,null,!!b.dataset.own);
  }
  q('gameTree').onclick=categoryClick;q('gameChildren').onclick=categoryClick;q('gameBreadcrumb').onclick=categoryClick;
  q('gameRetry').onclick=()=>currentCategory?load(currentCategory,currentPage?.page??null):init();
  async function load(category,number=null) {
    category=String(category);if(!categories.has(category))return;
    const ticket=++request;controller?.abort();controller=new AbortController();
    currentCategory=category;currentPage=null;mapClips.clear();shown=[];selected.clear();nextVariants.clear();player.release();playingClip=null;q('gameDownload').disabled=true;
    draw();paging();categoryChips();message('Loading '+categories.get(category).name+'...');
    try {
      let loaded=null;
      if(!firstPages.has(category)) {
        const first=await store.load(C.pagePath(category,0),controller.signal);if(ticket!==request)return;
        firstPages.set(category,first.page);if(number==null||number===first.page)loaded=first;
      }
      if(!loaded)loaded=await store.load(C.pagePath(category,number==null?firstPages.get(category):number,firstPages.get(category)),controller.signal);
      if(ticket!==request)return;
      currentPage=loaded;
      for(const c of loaded.clips){const key=c.assetPath||c.name;if(!mapClips.has(key))mapClips.set(key,[]);mapClips.get(key).push(c);}
      features.state.context.category=category;features.state.context.page=loaded.page;
      if (!linkedAsset) history.replaceState(null,'',F.write(location.href,'game',features.state));
      features.data(vocabulary,loaded.clips,facets);
      categoryChips();languageChips();filter();
    }catch(error){if(ticket===request&&error.name!=='AbortError')message('Could not load category page: '+error.message,true);}
  }
  function paging() {
    const first=firstPages.get(currentCategory)||0;
    for(const suffix of ['', 'Bottom']) {
      q('gamePaging'+suffix).hidden=!currentPage;
      q('gamePrev'+suffix).disabled=!currentPage||currentPage.page<=first;
      q('gameNext'+suffix).disabled=!currentPage||currentPage.page>=first+currentPage.pages-1;
      q('gamePage'+suffix).textContent=currentPage?'Page '+(currentPage.page-first+1)+' of '+currentPage.pages:'';
    }
  }
  for(const suffix of ['', 'Bottom']) {
    q('gamePrev'+suffix).onclick=()=>{linkedAsset='';focusAsset='';load(currentCategory,currentPage.page-1);};
    q('gameNext'+suffix).onclick=()=>{linkedAsset='';focusAsset='';load(currentCategory,currentPage.page+1);};
  }
  function languageMatch(c,language) {return !language || (language==='sfx'?!c.lang:c.lang===language);}
  function languageChips() {
    const langs=[...new Set([...entries,...(currentPage?.clips||[])].flatMap(c=>c.langs||c.languages||c.lang||[]).filter(Boolean))].sort();
    const active=features.state.context.language||'';
    if(active&&active!=='sfx'&&!langs.includes(active))langs.push(active);
    q('gameLanguage').innerHTML='<span class="tf-label">Language</span>'+[['','All'],['sfx','SFX'],...langs.map(l=>[l,l])].map(([id,label])=>'<button class="tpill'+(active===id?' active':'')+'" data-language="'+esc(id)+'" aria-pressed="'+(active===id)+'">'+esc(label)+'</button>').join('');
  }
  q('gameLanguage').onclick=e=>{const b=e.target.closest('[data-language]');if(!b)return;if(b.dataset.language)features.state.context.language=b.dataset.language;else delete features.state.context.language;features.commit();};
  function filter() {
    const state=features.state,query=q('gameSearch').value;state.query=query;
    if(!linkedAsset)q('gameList').querySelectorAll('.sound-link-focus').forEach(card=>card.classList.remove('sound-link-focus'));
    resultObserver?.disconnect();resultController?.abort();const ticket=++resultTicket;
    q('gameSearchBox').classList.toggle('has-text',!!query);
    // Description, tags and names use the complete index by default. Numerical measurements are page-owned.
    const global=indexAvailable&&!focusAsset&&!state.pitched&&!Object.keys(state.ranges).length&&(!!query.trim()||state.tags.length>0);
    q('gameResults').hidden=!global;q('gameViewport').hidden=global;
    if(global) {
      const key=JSON.stringify([query,state.tags,state.context.language]);
      if(key!==resultKey){resultMetadata.clear();resultKey=key;}
      hits=F.ranked(entries,{...state,query},features.vocab,false).filter(e=>{
        const language=state.context.language;if(!language)return true;
        const known=mapClips.get(e.assetPath||e.name);
        const langs=e.langs||e.languages||(e.lang?[e.lang]:known?.map(c=>c.lang).filter(Boolean)||[]);
        return language==='sfx'?!langs.length:langs.includes(language);
      }).slice(0,100);
      q('gameResults').innerHTML=hits.map((e,i)=>resultCard(e,i)).join('');
      hydrateResults(ticket);
      q('gamePaging').hidden=true;q('gamePagingBottom').hidden=true;
      message(hits.length?hits.length+' library matches'+(hits.length===100?' (first 100)':'')+'.':'No sounds match this search.');
    }else {
      resultMetadata.clear();resultKey='';
      const clips=focusAsset?(currentPage?.clips||[]).filter(c=>(c.assetPath||c.name)===focusAsset):F.ranked(currentPage?.clips||[],state,features.vocab);
      shown=C.groups(clips.filter(c=>languageMatch(c,state.context.language)));
      draw();paging();
      if(currentPage)message(shown.length+' sounds, '+currentPage.clips.length+' clips on this page.');
      else if(initialized)message('Select a category or search the library.');
    }
    features.map?.draw();
  }
  q('gameSearch').oninput=()=>{focusAsset='';features.state.query=q('gameSearch').value;features.commit();};
  q('gameSearchClear').onclick=()=>{q('gameSearch').value='';features.state.query='';features.commit();q('gameSearch').focus();};
  function clipFor(g){return g.takes.find(c=>c.file===selected.get(g.id))||g.takes[0];}
  function sound(c,g,category=currentCategory) {return {...c, clip:c,library:'game',source:'game',file:c.file?base+'/audio/'+C.relativePath(c.file):'',dur:c.duration||0,cat:esc(categories.get(String(category))?.name||'Game Library'),takes:g.takes,downloadName:c.name.replace(/[<>:"/\\|?*]/g,'_')+'_v'+(c.variant||0)+'.opus'};}
  function resultCard(e,i) {
    const group=resultMetadata.get(e.assetPath||e.name);
    if(group)return player.card(sound(group.takes[0],group,e.category)).replace('<article ', '<article data-result="'+i+'" ');
    // The index carries names and tags. Visible results acquire clip metadata without fetching audio.
    const c={...e,tags:e.tags||e.t||[],channels:2,rate:0,codec:'',duration:0};
    return player.card(sound(c,{takes:[c]})).replace('Measurements unavailable','Loading measurements...').replace('<article ', '<article data-result="'+i+'" ').replace(/<span class="tag tag-2d">2D<\/span>/,'').replace(/<span class="tag tag-dur">[^<]*<\/span>/,'').replace(/<p class="card-technical">.*?<\/p>/,'<p class="card-technical">'+esc(categories.get(String(e.category))?.name||'Game Library')+'</p>');
  }
  function hydrateResults(ticket) {
    if(typeof IntersectionObserver==='undefined')return;
    resultController=new AbortController();const signal=resultController.signal,queue=[];let running=0;
    async function indexedPage(e) {
      const key=e.category+':'+(e.page??'first');
      const pending=pendingIndexPages.get(key);
      if(pending && !pending.signal.aborted)return pending.promise;
      const promise=(async()=>{
        let first=null;const category=String(e.category);
        if(!firstPages.has(category)) {first=await store.load(C.pagePath(category,0),signal);firstPages.set(category,first.page);}
        const start=firstPages.get(category),number=e.page??start;
        return first&&first.page===number?first:store.load(C.pagePath(category,number,start),signal);
      })();
      pendingIndexPages.set(key,{promise,signal});
      try{return await promise;}finally{if(pendingIndexPages.get(key)?.promise===promise)pendingIndexPages.delete(key);}
    }
    function pump() {
      while(running<2&&queue.length&&ticket===resultTicket) {
        const card=queue.shift(),i=Number(card.dataset.result),e=hits[i];running++;
        if(resultMetadata.has(e.assetPath||e.name)){running--;continue;}
        indexedPage(e).then(page=>{
          if(ticket!==resultTicket||signal.aborted)return;
          const groups=new Map(C.groups(page.clips.filter(c=>languageMatch(c,features.state.context.language))).map(g=>[g.id,g]));
          // One visible card fetches the page. Reuse its measurements for every result on that page.
          for(const target of q('gameResults').querySelectorAll('[data-result]')) {
            const j=Number(target.dataset.result),hit=hits[j],key=hit.assetPath||hit.name;
            if(String(hit.category)!==String(e.category)||(hit.page??firstPages.get(String(hit.category)))!==page.page)continue;
            const group=groups.get(key);
            if(group){resultMetadata.set(key,group);resultObserver?.unobserve(target);target.outerHTML=resultCard(hit,j);}
            else {const readout=target.querySelector('.feature-readout');if(readout)readout.textContent='That sound was not found';}
          }
        }).catch(()=>{if(ticket===resultTicket&&!signal.aborted){const readout=card.querySelector('.feature-readout');if(readout)readout.textContent='Could not load measurements';}}).finally(()=>{running--;pump();});
      }
    }
    resultObserver=new IntersectionObserver(rows=>{
      for(const row of rows)if(row.isIntersecting){resultObserver.unobserve(row.target);queue.push(row.target);}
      pump();
    },{rootMargin:'100px'});
    q('gameResults').querySelectorAll('[data-result]').forEach(card=>{if(!resultMetadata.has(hits[Number(card.dataset.result)].assetPath||hits[Number(card.dataset.result)].name))resultObserver.observe(card);});
  }
  function draw() {
    q('gameList').innerHTML=shown.map((g,i)=>player.card(sound(clipFor(g),g)).replace('<article ','<article data-group="'+i+'" ')).join('');
    if (linkedAsset && focusAsset === linkedAsset) q('gameList').querySelector('.card')?.classList.add('sound-link-focus');
    for(const card of q('gameList').querySelectorAll('.card'))if(player.isCurrent(card.dataset.file))player.attach(card);
  }
  async function play(g,another=false) {
    let clip=clipFor(g);
    if(another||!player.canToggle(sound(clip,g).file)) {const cycled=C.cycle(g.takes,nextVariants.get(g.id)||0);clip=cycled.clip;nextVariants.set(g.id,cycled.next);selected.set(g.id,clip.file);draw();}
    playingClip=clip;q('gameDownload').disabled=false;
    const card=q('gameList').querySelector('[data-group="'+shown.indexOf(g)+'"]');
    player.play(sound(clip,g),card,another);
  }
  async function openGameAsset(asset,category,page,action='play') {
    linkedAsset='';
    const ticket=request+1;
    focusAsset=asset;features.state.query=asset;q('gameSearch').value=asset;
    await load(category,page??null);
    if(request!==ticket||q('gameLibrary').hidden)return;
    focusAsset=asset;filter();
    const g=shown.find(g=>g.id===asset||g.name===asset);
    if(!g){message('Sound unavailable on its indexed page.');return;}
    const card=q('gameList').querySelector('[data-group="'+shown.indexOf(g)+'"]');card?.scrollIntoView({block:'nearest'});
    if(action==='download')download(clipFor(g));else play(g);
  }
  async function openSoundLink(asset) {
    features.state=F.empty();features.refresh();q('gameSearch').value='';
    let entry=mapEntries.get(asset);
    if (!entry && !indexAvailable) {
      // Map points already in memory include category and page. Otherwise only the assets list is needed for lookup.
      entry=features.map?.points?.find(p=>p.name===asset);
      if (entry) entry={category:entry.cat,page:entry.page};
      else {
        const meta=await F.optional(base+'/index/map.json');
        if (meta) {
          let i=meta.assets?.indexOf(asset)??-1;
          if(!meta.assets)for(let shard=0;shard<Math.ceil(meta.count/20000);shard++) {
            const data=await F.optional(base+'/index/map-assets-'+shard+'.json');
            const offset=(Array.isArray(data)?data:data?.assets||[]).indexOf(asset);
            if(offset>=0){i=shard*20000+offset;break;}
          }
          if(i>=0){const r=await fetch(base+'/index/map.bin');if(r.ok){const v=new DataView(await r.arrayBuffer());entry={category:meta.categories[v.getUint16(i*8+4,true)],page:v.getUint16(i*8+6,true)};}}
        }
      }
    }
    if (!entry) {resetCategory();filter();message('That sound was not found');return;}
    linkedAsset=asset;focusAsset=asset;
    await load(entry.category,entry.page??null);
    if (!shown.some(g=>g.id===asset)) {linkedAsset='';focusAsset='';resetCategory();filter();message('That sound was not found');return;}
    const card=q('gameList').querySelector('.card');
    if(card){card.tabIndex=-1;card.scrollIntoView({block:'center'});card.focus({preventScroll:true});}
  }
  async function similarGame(asset) {
    const bytes=new TextEncoder().encode(asset),hash=new Uint8Array(await crypto.subtle.digest('SHA-1',bytes));
    const shard=Array.from(hash.slice(0,1),b=>b.toString(16).padStart(2,'0')).join('');
    const data=await F.optional(base+'/index/similar/'+shard+'.json');
    features.neighbours((data?.[asset]||[]).filter(r=>categories.has(String(r[2]))).slice(0,20).map(r=>({name:mapEntries.get(r[0])?.name||r[0],asset:r[0],score:r[1],category:r[2],page:r[3],href:F.link(location.href,'game',{...F.empty(),query:r[0],context:{category:String(r[2]),page:r[3]}})})),r=>openGameAsset(r.asset,r.category,r.page));
  }
  function cardClick(e) {
    const card=e.target.closest('[data-group],[data-result]');if(!card)return;
    const result=card.dataset.result!==undefined,entry=result?hits[Number(card.dataset.result)]:null,g=result?null:shown[Number(card.dataset.group)],c=result?entry:clipFor(g);
    if(e.target.closest('[data-copy]')) {navigator.clipboard.writeText(c.assetPath||c.name).then(()=>toast('Asset path copied')).catch(()=>toast('Copy failed'));}
    else if(e.target.closest('[data-feature-tag]'))features.tag(e.target.closest('[data-feature-tag]').dataset.featureTag);
    else if(e.target.closest('[data-similar]'))similarGame(c.assetPath||c.name).catch(()=>features.neighbours([],()=>{}));
    else if(e.target.closest('[data-sfx-dl]')){e.preventDefault();if(result)openGameAsset(c.assetPath||c.name,c.category,c.page,'download');else download(c);}
    else if(e.target.closest('[data-play],[data-next-variant]')) {if(result)openGameAsset(c.assetPath||c.name,c.category,c.page);else play(g,!!e.target.closest('[data-next-variant]'));}
  }
  q('gameList').onclick=cardClick;q('gameResults').onclick=cardClick;
  q('gameDownload').onclick=()=>{if(playingClip)download(playingClip);};
  async function download(clip) {
    try {const r=await fetch(base+'/audio/'+C.relativePath(clip.file));if(!r.ok)throw Error('HTTP '+r.status);const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=sound(clip,{takes:[clip]}).downloadName;a.click();setTimeout(()=>URL.revokeObjectURL(url),4000);}catch(error){message('Download failed: '+error.message);}
  }
  player.download=download;
  player.replay=card=>{const group=shown[Number(card.dataset.group)];if(group)play(group);};
  if(new URLSearchParams(location.search).get('section')==='game')switchSection(true,true);
})();
