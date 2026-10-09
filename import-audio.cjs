// Encode the read-only lossless export. Usage: node import-audio.cjs <export-directory>
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const root = __dirname, source = path.resolve(process.argv[2] || '');
if (!process.argv[2] || source === root) throw new Error('Pass a separate export directory');
const exported = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
fs.writeFileSync(path.join(root,'audio.tmp.source.json'),JSON.stringify(exported));
const old = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const metadata = {}, groups = new Map();
for (const c of exported.clips) {
  if (!c.portalName.startsWith('SFX_')) throw new Error('Unexpected non-SFX source');
  if (!c.sampleRate) throw new Error('Missing source sample rate');
  if (!groups.has(c.portalName)) groups.set(c.portalName, []);
  groups.get(c.portalName).push(c);
}
const jobs = [], entries = old.filter(s => s.vo || !groups.has(s.name));
let reused = 0;
for (const s of old.filter(s => !s.vo)) metadata[s.name] = {cat:s.cat, loop:s.loop, silent:s.silent, crash:s.crash, unreliable:s.unreliable, source:groups.has(s.name) ? 'game' : 'recorded'};
let index = 1000;
for (const [name, clips] of groups) {
  clips.sort((a,b) => a.variantIndex - b.variantIndex);
  const prior = old.find(s => s.name === name);
  const folder = prior ? prior.file.split('/')[1] : clips[0].file.split('/')[0];
  const meta = metadata[name] ||= {cat:name.replace(/^SFX_/, '').split('_')[0], loop:/Loop[23]D$/.test(name), silent:false, crash:false, unreliable:false, source:'game'};
  meta.loop ||= clips.some(c => c.loop === true);
  const prefix = prior ? path.basename(prior.file).match(/^\d+/)[0] : String(index++);
  fs.mkdirSync(path.join(root, 'sounds', folder), {recursive:true});
  for (const c of clips) {
    const variant = c.variantIndex + 1;
    const file = `sounds/${folder}/${prefix}_${name}${clips.length > 1 ? `_v${variant}` : ''}.ogg`;
    const input = path.join(source,c.file), output = path.join(root,file);
    const existing = old.find(s => s.file===file && s.source==='game' && s.dur===c.duration);
    if (existing && fs.existsSync(output) && fs.statSync(output).mtimeMs >= fs.statSync(input).mtimeMs) reused++;
    else jobs.push({input,output});
    entries.push({file,name,cat:meta.cat,loop:meta.loop,silent:meta.silent,crash:meta.crash,unreliable:meta.unreliable,dur:c.duration,vo:false,event:'',flag:'',variant:clips.length > 1 ? variant : 0,source:'game'});
  }
}
// Remove obsolete replaced files only after all encoding succeeds.
const soundsRoot = path.join(root,'sounds') + path.sep;
const outputFiles = new Set(entries.map(s=>s.file));
const obsolete = old.filter(s => !s.vo && groups.has(s.name) && !outputFiles.has(s.file));
for (const s of obsolete) {
  const target = path.resolve(root,s.file);
  if (!target.startsWith(soundsRoot)) throw new Error('Unsafe clip path');
}
let next = 0, done = 0;
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    await new Promise((resolve,reject) => {
      const p = spawn(process.env.FFMPEG || 'ffmpeg', ['-nostdin','-v','error','-y','-i',job.input,'-map','0:a:0','-c:a','libvorbis','-q:a','3','-ar','48000',job.output], {windowsHide:true});
      let error = ''; p.stderr.on('data', d => error += d); p.on('error',reject);
      p.on('close', code => code === 0 ? resolve() : reject(new Error(`${job.input}: ${error}`)));
    });
    if (++done % 250 === 0) console.log(`encoded ${done}/${jobs.length}`);
  }
}
Promise.all(Array.from({length:6},worker)).then(() => {
  for (const s of obsolete) fs.unlinkSync(path.resolve(root,s.file));
  fs.writeFileSync(path.join(root,'sound-metadata.json'),JSON.stringify(metadata,null,2)+'\n');
  fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(entries,null,2)+'\n');
  console.log(`Imported ${jobs.length+reused} variants (${reused} reused) for ${groups.size} sounds; retained ${entries.length-jobs.length-reused} recordings`);
}).catch(e => { console.error(e); process.exitCode=1; });
