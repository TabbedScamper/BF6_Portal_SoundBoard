'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const F=require('./sound-features-core.js');
async function main(){
 const vocab=JSON.parse(fs.readFileSync('notes/fixture/index/tags.json'));
 const page=JSON.parse(fs.readFileSync('notes/fixture/index/weapons.json')), index=JSON.parse(fs.readFileSync('notes/fixture/index/search.json'));
 let state=F.empty();state.query='bang';assert.equal(F.ranked(index,state,vocab,false)[0].name,'Fixture Rifle Shot');assert.equal(F.ranked(page.clips,state,vocab).length,2);
 state.tags=['metal'];state.ranges={attack:[0,20]};state.pitched=true;assert.equal(F.ranked(page.clips,state,vocab).length,1);state.ranges.bright=[2000,3000];assert.equal(F.ranked(page.clips,state,vocab).length,0);
 for(const k of Object.keys(F.fields)){state=F.empty();const sample={...page.clips[0],f:{...page.clips[0].f,width:.4}},value=sample.f[k];state.ranges[k]=[value,value];assert(F.matches(sample,state),k);state.ranges[k]=[value+1,value+2];assert(!F.matches(sample,state),k);}
 assert(!F.matches({tags:['metal']},{...F.empty(),pitched:true}));assert(F.matches({},F.empty()));assert.equal(F.score({name:'Rifle Shot'},'rifle',{} )>0,true);assert.equal(F.score(page.clips[0],'bang speech',vocab),0);
 assert(F.score({name:'Clip',description:'Distant metallic rattle'},'metallic rattle',{})>0,'Description search');
 assert.equal(F.note(440),'A4');assert.equal(F.note(null),'Unpitched');
 assert.equal(F.soundLink('http://localhost:8000/?portalFilters=old#anchor','portal','VO_Objective_A'),'http://localhost:8000/?sound=VO_Objective_A');
 assert.equal(F.soundLink('http://localhost:8000/?gameFilters=old','game','common/sound/a b&c'),'http://localhost:8000/?section=game&sound=common%2Fsound%2Fa%20b%26c');
 const portal=JSON.parse(fs.readFileSync('notes/feature-fixture/portal/portal-features.json'));assert.equal(portal.version,1);const manifest=JSON.parse(fs.readFileSync('manifest.json'));for(const [file,c]of Object.entries(portal.clips)){assert(manifest.some(m=>m.file===file));assert.equal(Object.keys(c.f).length,10);assert(c.tags.every(t=>vocab.tags.some(v=>v.id===t)));}
 state={...F.empty(),query:'metallic',tags:['metal'],ranges:{len:[0,1]},context:{category:'weapons',page:1}};let url='http://localhost/?gameFixture=1#anchor';url='http://localhost'+F.write(url,'game',state);url='http://localhost'+F.write(url,'portal',{...F.empty(),query:'alert'});assert.deepEqual(F.read(new URL(url).search,'game'),state);assert.equal(F.read(new URL(url).search,'portal').query,'alert');assert.equal(new URL(url).hash,'#anchor');assert.deepEqual(F.read('?gameFilters=bad','game'),F.empty());
 const {loadPoints,decodeMap,boxPoints}=await import('./sound-map.mjs');const requests=[];
 const fetcher=async url=>{requests.push(url);const data=fs.readFileSync(url);return {ok:true,json:async()=>JSON.parse(data),arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)};};
 const gp=await loadPoints({section:'game',base:'notes/fixture/'},fetcher);assert.equal(gp.length,4);assert.deepEqual(requests,['notes/fixture/index/map.json','notes/fixture/index/map.bin']);assert.equal(gp[2].page,1);assert.equal(gp[3].cat,'vo');assert.equal(boxPoints(gp,{x:0,y:0},{x:1,y:1}).length,4);
 requests.length=0;const pp=await loadPoints({section:'portal',base:'notes/feature-fixture/portal/'},fetcher);assert.equal(requests.length,1);assert(pp.every(p=>manifest.some(c=>c.name===p.name)));assert(!gp.some(p=>pp.some(q=>p.name===q.name)));await assert.rejects(loadPoints({section:'game',base:''},async()=>({ok:false})));assert.throws(()=>decodeMap(new ArrayBuffer(2),{count:1,categories:[],assets:['x']}));
 const assets=index.map(e=>e.assetPath);for(const asset of assets){const hash=require('node:crypto').createHash('sha1').update(asset).digest('hex').slice(0,2),data=JSON.parse(fs.readFileSync('notes/fixture/index/similar/'+hash+'.json'));assert(data[asset].every(r=>assets.includes(r[0])&&r.length===4));}
 const count=16000,bin=new ArrayBuffer(count*8);const map=decodeMap(bin,{count,categories:['test'],assets:Array.from({length:count},(_,i)=>'asset/'+i)});assert.equal(map.length,count);assert.equal(boxPoints(map,{x:0,y:0},{x:1,y:1}).length,count);
 console.log('Sound features: every range, combined filters, pitched/null values, synonym ranking, separate URL state, both fixture contracts, SHA-1 similarity shards, lazy map requests, missing files and 16,000-point decoding passed.');
}
module.exports=main;if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
