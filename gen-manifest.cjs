'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = __dirname;
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'sound-metadata.json'), 'utf8'));
const previous = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const byFile = new Map(previous.map(s => [s.file, s]));
const entries = [];
for (const folder of fs.readdirSync(path.join(root, 'sounds')).sort()) {
  const dir = path.join(root, 'sounds', folder);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const filename of fs.readdirSync(dir).sort()) {
    if (!filename.endsWith('.ogg')) continue;
    const file = `sounds/${folder}/${filename}`;
    const asset = filename.replace(/^\d+_/, '').replace(/_SILENT(?=\.ogg$)/, '').replace(/\.ogg$/, '');
    const vo = asset.startsWith('VO_');
    const variant = Number(asset.match(/_v(\d+)$/)?.[1] || 0);
    const name = vo ? asset : asset.replace(/_v\d+$/, '');
    const rest = asset.replace(/^VO_/, '').replace(/_v\d+$/, '');
    const flag = vo ? (rest.match(/_([A-I])$/)?.[1] || '') : '';
    const meta = metadata[name] || {};
    const old = byFile.get(file);
    let dur = old?.dur;
    if (dur == null || process.argv.includes('--probe-all')) {
      const probe = spawnSync(process.env.FFPROBE || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path.join(root, file)], { encoding: 'utf8' });
      if (probe.status !== 0) throw new Error(`Cannot probe ${file}: ${probe.stderr}`);
      dur = Number(probe.stdout.trim());
    }
    if (!Number.isFinite(dur) || dur <= 0) throw new Error(`Invalid duration: ${file}`);
    entries.push({file, name, cat: meta.cat || (vo ? 'Announcer' : folder === 'CrashSounds' ? 'Crash Sounds' : name.replace(/^SFX_/, '').split('_')[0]),
      loop: meta.loop ?? (/loop/i.test(name) || name === 'SFX_Alarm' || name.includes('Switchblade_Engine_Propellar')),
      silent: meta.silent ?? filename.endsWith('_SILENT.ogg'), crash: meta.crash ?? folder === 'CrashSounds',
      unreliable: meta.unreliable ?? vo, dur, vo, event: vo ? rest.replace(/_[A-I]$/, '') : '', flag, variant,
      ...(vo ? {} : {source: meta.source || 'recorded'})});
  }
}
fs.writeFileSync(path.join(root, 'manifest.json'), '[\n' + entries.map(s => '  ' + JSON.stringify(s)).join(',\n') + '\n]\n');
console.log(`wrote manifest.json (${entries.length} entries)`);
