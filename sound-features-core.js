/* Feature contract helpers. Each section owns its own state and vocabulary. */
(function(root) {
  'use strict';
  const fields = {len:['Length','s',0,600,.01], pitch:['Pitch','Hz',20,20000,1], bright:['Brightness','Hz',0,24000,1], lufs:['Loudness','LUFS',-80,0,.1], attack:['Attack','ms',0,10000,1], tonal:['Tonality (0 noise, 1 tone)','tone',0,1,.01], width:['Stereo width','wide',0,1,.01], seam:['Loop seam','seamless',0,1,.01]};
  const empty = () => ({ranges:{},tags:[],pitched:false,query:'',context:{}});
  const escape = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function matches(clip,state,numeric=true) {
    const tags=clip.tags || clip.t || [];
    if (!state.tags.every(t=>tags.includes(t))) return false;
    if (!numeric) return true;
    if (state.pitched && !Number.isFinite(clip.f?.pitch)) return false;
    return Object.entries(state.ranges).every(([k,[lo,hi]])=>Number.isFinite(clip.f?.[k]) && clip.f[k]>=lo && clip.f[k]<=hi);
  }
  function score(clip,query,vocab={}) {
    const words=query.toLowerCase().match(/[\p{L}\p{N}_]+/gu)||[];
    if (!words.length) return 1;
    const name=[clip.name,clip.assetPath,clip.label,clip.description].filter(Boolean).join(' ').toLowerCase(), tags=clip.tags || clip.t || [];
    let total=0;
    for (const word of words) {
      const ids=new Set([word,...(vocab.synonyms?.[word]||[]),...(vocab.tags||[]).filter(t=>t.label.toLowerCase()===word).map(t=>t.id)]);
      const tag=tags.some(t=>ids.has(t)), named=name.includes(word);
      if (!tag && !named) return 0;
      total+=(tag?4:0)+(named?2:0);
    }
    if(name.includes(query.trim().toLowerCase())) total+=3;
    return total;
  }
  function ranked(clips,state,vocab,numeric=true) {return clips.filter(c=>matches(c,state,numeric)).map(c=>({c,s:score(c,state.query,vocab)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).map(x=>x.c);}
  function read(search,section) {
    try {const value=new URLSearchParams(search).get(section+'Filters'); if(!value)return empty(); const raw=JSON.parse(value), out=empty();
      out.query=typeof raw.query==='string'?raw.query:''; out.pitched=raw.pitched===true; out.tags=Array.isArray(raw.tags)?raw.tags.filter(t=>typeof t==='string'):[];
      for(const [k,v] of Object.entries(raw.ranges||{})) if(fields[k] && Array.isArray(v)&&v.length===2&&v.every(Number.isFinite)&&v[0]<=v[1])out.ranges[k]=v;
      if(raw.context && typeof raw.context==='object') { for(const k of ['category','type','language'])if(typeof raw.context[k]==='string')out.context[k]=raw.context[k];if(Number.isInteger(raw.context.page))out.context.page=raw.context.page;if(raw.context.global===true)out.context.global=true; }
      return out;
    }catch(_){return empty();}
  }
  function write(url,section,state) {const u=new URL(url);u.searchParams.delete('sound'); if(state.query||state.pitched||state.tags.length||Object.keys(state.ranges).length||Object.keys(state.context||{}).length)u.searchParams.set(section+'Filters',JSON.stringify(state));else u.searchParams.delete(section+'Filters');return u.pathname+u.search+u.hash;}
  function link(url,section,state){const u=new URL(write(url,section,state),url);u.searchParams.set('section',section);return u.pathname+u.search+u.hash;}
  function soundLink(url,section,name){const u=new URL(url);return u.origin+u.pathname+'?'+(section==='game'?'section=game&':'')+'sound='+encodeURIComponent(name);}
  function shareButton(section,name){return '<button class="icon-btn copy-link" data-sound-link="'+escape(soundLink(location.href,section,name))+'">Copy link</button>';}
  function note(hz) {if(!Number.isFinite(hz)||hz<=0)return 'Unpitched';const n=Math.round(69+12*Math.log2(hz/440));return ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][(n%12+12)%12]+(Math.floor(n/12)-1);}
  function details(c) {const f=c.f;if(!f)return '<p class="feature-readout">Measurements unavailable</p>';const val=(k,unit)=>Number.isFinite(f[k])?Number(f[k].toFixed(2))+' '+unit:'Unknown';return '<p class="feature-readout">Pitch '+escape(f.note||note(f.pitch))+' / '+val('pitch','Hz')+' | Length '+val('len','s')+' | Loudness '+val('lufs','LUFS')+' | Brightness '+val('bright','Hz')+' | Attack '+val('attack','ms')+'</p>';}
  function card(c,owner) {return '<div class="sound-details">'+details(c)+(c.tags||[]).map(t=>'<button class="tag" data-feature-tag="'+escape(t)+'" data-owner="'+owner+'">'+escape(t)+'</button>').join('')+' <button class="tag" data-similar="'+escape(c.assetPath||c.name)+'" data-owner="'+owner+'">Similar</button></div>';}
  async function optional(url) {try{const r=await fetch(url);if(!r.ok)return null;return await r.json();}catch(_){return null;}}
  const api={fields,empty,escape,matches,score,ranked,read,write,link,soundLink,shareButton,note,details,card,optional};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SoundFeatures=api;
})(typeof window==='undefined'?globalThis:window);
