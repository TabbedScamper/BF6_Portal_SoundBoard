/* Section-owned controls. Maps are dynamically imported only on demand. */
(() => {
  'use strict';
  const F=window.SoundFeatures;
  class Panel {
    constructor(section,host,onchange) {
      this.section=section;this.host=host;this.change=onchange;this.state=F.read(location.search,section);this.vocab={tags:[],synonyms:{}};this.clips=[];this.bounds={};
      host.innerHTML='<details class="feature-panel"><summary>Sound filters</summary><p class="feature-availability"></p><div class="feature-ranges"></div><label><input type="checkbox" data-pitched> Pitched only</label><div class="feature-tags"></div></details><div class="feature-toolbar"><button class="btn" data-clear>Clear all</button><button class="btn" data-share>Copy filter link</button><button class="btn" data-map aria-pressed="false">Sound map</button></div><p class="feature-active" aria-live="polite"></p><div class="sound-map" hidden></div><div class="feature-neighbours" hidden></div>';
      this.makeRanges();this.refresh();
      host.addEventListener('input',e=>{if(e.target.dataset.range){const k=e.target.dataset.range, inputs=[...host.querySelectorAll('[data-range="'+k+'"]')];let lo=Number(inputs[0].value),hi=Number(inputs[1].value);if(lo>hi){if(e.target===inputs[0])hi=lo;else lo=hi;}const b=this.bounds[k];if(lo===b[0]&&hi===b[1])delete this.state.ranges[k];else this.state.ranges[k]=[lo,hi];this.commit();}else if(e.target.matches('[data-pitched]')){this.state.pitched=e.target.checked;this.commit();}});
      host.addEventListener('click',async e=>{
        if(e.target.closest('[data-clear]')){this.state=F.empty();this.commit();}
        if(e.target.closest('[data-share]')){try{history.replaceState(null,'',F.link(location.href,this.section,this.state));await navigator.clipboard.writeText(location.href);toast('Filter link copied');}catch(_){toast('Copy the address from your browser');}}
        if(e.target.closest('[data-feature-tag]'))this.tag(e.target.closest('[data-feature-tag]').dataset.featureTag);
        if(e.target.closest('[data-map]'))await this.toggleMap();
      });
      window.addEventListener('popstate',()=>{this.state=F.read(location.search,section);this.refresh();this.change();});
    }
    makeRanges(facets={}) {
      this.host.querySelector('.feature-ranges').innerHTML=Object.entries(F.fields).map(([k,[label,unit,min,max,step]])=>{
        const values=this.clips.map(c=>c.f?.[k]).filter(Number.isFinite), facet=facets[k]||facets.features?.[k];
        if(facet&&Number.isFinite(facet.min)&&Number.isFinite(facet.max)){min=facet.min;max=facet.max;}else if(values.length){min=Math.min(min,...values);max=Math.max(max,...values);}
        this.bounds[k]=[min,max];return '<fieldset><legend>'+label+' <output data-output="'+k+'"></output></legend>'+['Minimum','Maximum'].map((end,i)=>'<label>'+end+'<input type="range" data-range="'+k+'" data-end="'+i+'" min="'+min+'" max="'+max+'" step="'+step+'" aria-label="'+label+' '+end.toLowerCase()+'"></label>').join('')+'</fieldset>';
      }).join('');
    }
    data(vocab,clips,facets=null) {this.vocab=vocab||{tags:[],synonyms:{}};this.clips=clips;this.makeRanges(facets||{});const counts={};for(const c of clips)for(const t of c.tags||c.t||[])counts[t]=(counts[t]||0)+1;const allCounts=facets?.tags||facets?.tagCounts||counts;
      this.host.querySelector('.feature-tags').innerHTML=['source','material','character'].map(g=>'<fieldset><legend>'+g+'</legend>'+this.vocab.tags.filter(t=>t.group===g).map(t=>'<button class="tag" data-feature-tag="'+F.escape(t.id)+'">'+F.escape(t.label)+' ('+(allCounts[t.id]||0)+')</button>').join('')+'</fieldset>').join('');
      this.host.querySelector('.feature-availability').textContent=clips.some(c=>c.f)?(this.section==='game'?'Ranges apply to the loaded page. Global search uses tags and names.':'Measurements apply to individual clips. A card matches when any variant matches.'):'Measurements unavailable. Name search and playback still work. Global search uses available tags.';const available=clips.some(c=>c.f);this.host.querySelectorAll('[data-range],[data-pitched]').forEach(el=>el.disabled=!available);this.refresh();
    }
    tag(id){if(this.state.tags.includes(id))this.state.tags=this.state.tags.filter(t=>t!==id);else this.state.tags.push(id);this.commit();}
    commit(){history.replaceState(null,'',F.write(location.href,this.section,this.state));this.refresh();this.change();this.map?.draw();}
    refresh(){for(const [k,b]of Object.entries(this.bounds)){const v=this.state.ranges[k]||b;this.host.querySelectorAll('[data-range="'+k+'"]').forEach((el,i)=>el.value=v[i]);this.host.querySelector('[data-output="'+k+'"]').textContent=v.map(n=>Number(n.toFixed(2))).join(' to ')+' '+F.fields[k][1]+(k==='pitch'?' ('+F.note(v[0])+' to '+F.note(v[1])+')':'');}this.host.querySelector('[data-pitched]').checked=this.state.pitched;this.host.querySelectorAll('[data-feature-tag]').forEach(b=>b.setAttribute('aria-pressed',String(this.state.tags.includes(b.dataset.featureTag))));this.host.querySelector('.feature-active').textContent='Active: '+[this.state.query&&'Search '+this.state.query,this.state.pitched&&'Pitched only',...this.state.tags,...Object.entries(this.state.context||{}).map(([k,v])=>k+' '+v),...Object.entries(this.state.ranges).map(([k,v])=>F.fields[k][0]+' '+v.join(' to '))].filter(Boolean).join(' | ') || 'Active: none';if(this.host.querySelector('.feature-active').textContent==='Active: ')this.host.querySelector('.feature-active').textContent='Active: none';}
    async toggleMap(){const host=this.host.querySelector('.sound-map'),button=this.host.querySelector('[data-map]');host.hidden=!host.hidden;button.setAttribute('aria-pressed',String(!host.hidden));if(host.hidden)return;if(this.map){this.map.draw();return;}if(this.loadingMap)return;this.loadingMap=true;host.textContent='Loading sound map...';try{const M=await import('./sound-map.mjs');this.map=await M.open(host,this.mapOptions());}catch(_){host.textContent='Sound map unavailable. Close and reopen to retry.';}finally{this.loadingMap=false;}}
    neighbours(rows,open){const host=this.host.querySelector('.feature-neighbours');host.hidden=false;host.innerHTML='<div class="feature-toolbar"><b>Similar sounds</b><button class="btn" data-close-similar>Close</button></div>'+(!rows.length?'<p>Similarity data unavailable for this sound.</p>':rows.slice(0,20).map((r,i)=>'<div><a class="tag" href="'+F.escape(r.href||'#')+'" data-neighbour="'+i+'">Play and open '+F.escape(r.name)+'</a><span> '+Number(r.score).toFixed(3)+'</span></div>').join(''));host.onclick=e=>{if(e.target.closest('[data-close-similar]'))host.hidden=true;const b=e.target.closest('[data-neighbour]');if(b&&!e.ctrlKey&&!e.metaKey){e.preventDefault();open(rows[Number(b.dataset.neighbour)]);}};}
  }
  window.SoundFeaturePanel=Panel;
})();
