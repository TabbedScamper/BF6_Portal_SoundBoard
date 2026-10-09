/* No code or map data loads until a section opens its map. */
export function decodeMap(buffer,meta) {
  if(!Number.isInteger(meta.count)||meta.count<0||buffer.byteLength!==meta.count*8||!Array.isArray(meta.categories)||!Array.isArray(meta.assets)||meta.assets.length!==meta.count)throw Error('Invalid map');
  const v=new DataView(buffer);return Array.from({length:meta.count},(_,i)=>{const cat=v.getUint16(i*8+4,true);if(!meta.categories[cat])throw Error('Invalid map category');return {name:meta.assets[i],x:v.getUint16(i*8,true)/65535,y:v.getUint16(i*8+2,true)/65535,cat:meta.categories[cat],page:v.getUint16(i*8+6,true)};});
}
export async function loadPoints(options,fetcher=fetch) {
  const json=async path=>{const r=await fetcher(options.base+path);if(!r.ok)throw Error('Map unavailable');return r.json();};
  if(options.section==='portal'){const data=await json('portal-map.json');if(!Array.isArray(data.sounds)||data.sounds.some(p=>typeof p.name!=='string'||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1))throw Error('Invalid Portal map');return data.sounds;}
  const meta=await json('index/map.json');
  if(!meta.assets){meta.assets=[];for(let i=0;i<Math.ceil(meta.count/20000);i++){const shard=await json('index/map-assets-'+i+'.json');meta.assets.push(...(Array.isArray(shard)?shard:shard.assets));}}
  const r=await fetcher(options.base+'index/map.bin');if(!r.ok)throw Error('Map unavailable');return decodeMap(await r.arrayBuffer(),meta);
}
export function boxPoints(points,a,b){return points.filter(p=>p.x>=Math.min(a.x,b.x)&&p.x<=Math.max(a.x,b.x)&&p.y>=Math.min(a.y,b.y)&&p.y<=Math.max(a.y,b.y));}
export async function open(host,options) {
  const points=await loadPoints(options),F=window.SoundFeatures,colors=['#59BFF8','#FFBD44','#8EED6C','#FB694D','#BFCAD1','#BB9DEB','#65D4C0'];
  const cats=[...new Set(points.map(p=>p.cat))], palette=new Map(cats.map((c,i)=>[c,colors[i%colors.length]]));
  host.innerHTML='<p>Click a point to play and open. Drag a box to list sounds. Filters dim other points.</p><div class="map-legend">'+cats.map(c=>'<span style="border-left:6px solid '+palette.get(c)+'">'+F.escape(c)+'</span>').join('')+'</div><canvas tabindex="0" aria-label="Sound map. Use the selection list or search to access sounds by name."></canvas><p class="map-hover" aria-live="polite">'+points.length.toLocaleString()+' sounds</p><div class="map-selection"></div>';
  const canvas=host.querySelector('canvas'),ctx=canvas.getContext('2d'),hover=host.querySelector('.map-hover'),list=host.querySelector('.map-selection');
  let start=null,end=null,pending=false,selected=points,offset=0,buckets=null,bucketKey=null;
  function position(e){const r=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};}
  function draw(){if(host.hidden||!host.clientWidth)return;const width=host.clientWidth,height=420,dpr=Math.min(devicePixelRatio||1,2);canvas.width=width*dpr;canvas.height=height*dpr;canvas.style.height=height+'px';ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#07090a';ctx.fillRect(0,0,width,height);
    const key=options.key?.();
    if(!buckets||key===undefined||key!==bucketKey){options.prepare?.();buckets=new Map([['dim',[]],...cats.map(c=>[c,[]])]);for(const p of points)buckets.get(options.matches(p)?p.cat:'dim').push(p);bucketKey=key;}
    for(const [cat,bucket]of buckets){ctx.fillStyle=cat==='dim'?'#252b30':palette.get(cat);ctx.beginPath();for(const p of bucket)ctx.rect(p.x*(width-8)+4,p.y*(height-8)+4,cat==='dim'?2:3,cat==='dim'?2:3);ctx.fill();}
    if(start&&end){ctx.strokeStyle='#BFCAD1';ctx.strokeRect(start.x*width,start.y*height,(end.x-start.x)*width,(end.y-start.y)*height);}
  }
  function queue(){if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;draw();});}
  function showList(){const visible=selected.slice(offset,offset+100);list.innerHTML='<p>'+selected.length+' selected. Showing '+(selected.length?offset+1:0)+' to '+Math.min(offset+100,selected.length)+'.</p>'+visible.map((p,i)=>'<button class="tag" data-point="'+(offset+i)+'">Play and open '+F.escape(options.name?.(p)||p.name)+'</button>').join('')+'<div><button class="btn" data-map-prev '+(offset===0?'disabled':'')+'>Previous</button><button class="btn" data-map-next '+(offset+100>=selected.length?'disabled':'')+'>Next</button></div>';}
  canvas.onpointerdown=e=>{start=position(e);end=start;canvas.setPointerCapture(e.pointerId);};
  canvas.onpointermove=e=>{const p=position(e);if(start){end=p;queue();return;}let best=null,dist=100;const r=canvas.getBoundingClientRect();for(const point of points){const d=((point.x-p.x)*r.width)**2+((point.y-p.y)*r.height)**2;if(d<dist){dist=d;best=point;}}hover.textContent=best?(options.name?.(best)||best.name):points.length.toLocaleString()+' sounds';};
  canvas.onpointerup=e=>{if(!start)return;end=position(e);const r=canvas.getBoundingClientRect();if(Math.hypot((end.x-start.x)*r.width,(end.y-start.y)*r.height)<5){let best=null,distance=100;for(const p of points){const d=((p.x-end.x)*r.width)**2+((p.y-end.y)*r.height)**2;if(d<distance){distance=d;best=p;}}if(best)options.open(best);}else{selected=boxPoints(points,start,end);offset=0;showList();}start=end=null;queue();};
  canvas.onpointercancel=()=>{start=end=null;queue();};list.onclick=e=>{const b=e.target.closest('[data-point]');if(b)options.open(selected[Number(b.dataset.point)]);if(e.target.closest('[data-map-prev]')){offset=Math.max(0,offset-100);showList();}if(e.target.closest('[data-map-next]')){offset+=100;showList();}};
  new ResizeObserver(queue).observe(host);showList();queue();return {draw:queue,points};
}
