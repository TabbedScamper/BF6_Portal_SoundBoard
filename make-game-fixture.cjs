'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, 'notes', 'fixture');
const ffmpeg = process.env.FFMPEG || 'C:\\Tools\\ffmpeg\\ffmpeg-9.0.2-essentials_build\\bin\\ffmpeg.exe';
fs.mkdirSync(path.join(root, 'index'), { recursive: true });
fs.mkdirSync(path.join(root, 'audio'), { recursive: true });
function write(name, data) { fs.writeFileSync(path.join(root, 'index', name), JSON.stringify(data, null, 2) + '\n'); }
function clip(id, name, assetPath, variant, frequency, lang = null, portalName = null) {
  const file = id + '.opus';
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=0.12:sample_rate=48000`, '-c:a', 'libopus', '-b:a', '24k', path.join(root, 'audio', file)]);
  return { id, name, assetPath, variant, duration: 0.12, channels: 1, rate: 48000, codec: 'opus', portalName, loop: null, file, bytes: fs.statSync(path.join(root, 'audio', file)).size, lang };
}
const portal = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8')).find(c => !c.vo).name;
const weapons = [clip('shot-1', 'Fixture Rifle Shot', 'Weapons/Rifle/Shot', 1, 440, null, portal), clip('shot-2', 'Fixture Rifle Shot', 'Weapons/Rifle/Shot', 2, 660, null, portal), clip('reload', 'Fixture Reload', 'Weapons/Rifle/Reload', 1, 220)];
const page2 = [clip('impact', 'Fixture Impact', 'Weapons/Impact', 1, 880)];
const vo = [clip('vo-en', 'Fixture Move Out', 'VO/MoveOut', 1, 330, 'en'), clip('vo-fr', 'Fixture Move Out', 'VO/MoveOut', 2, 550, 'fr')];
write('tree.json', [{ id: 'weapons', name: 'Weapons', path: 'Weapons', count: 3, seconds: 0.48, children: [] }, { id: 'vo', name: 'Voice Over', path: 'VO', count: 1, seconds: 0.24, children: [] }]);
write('weapons.json', { category: 'weapons', page: 0, pages: 2, clips: weapons });
write('weapons.1.json', { category: 'weapons', page: 1, pages: 2, clips: page2 });
write('vo.json', { category: 'vo', page: 0, pages: 1, clips: vo });
write('search.json', [{ name: weapons[0].name, category: 'weapons', page: 0, assetPath: weapons[0].assetPath }, { name: weapons[2].name, category: 'weapons', page: 0 }, { name: page2[0].name, category: 'weapons', page: 1 }, { name: vo[0].name, category: 'vo', page: 0 }]);
console.log('Generated two-category fixture with six synthetic Opus clips.');
