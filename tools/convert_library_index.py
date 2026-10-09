"""Convert the SDK library exporter's index (sound-library/index) into the Game Library site contract.

Site contract (see game-library-core.js):
  index/tree.json                 [{id, name, path, count, seconds, own, children:[...]}]
  index/<id>.json, <id>.<n>.json  {category, page, pages, clips:[{id, name, assetPath, variant, duration, channels, rate,
                                   codec, portalName, loop, file (relative to audio/), bytes, lang}]}
  index/search.json               [{name, category, page, assetPath}] one entry per sound (asset)
Usage: python convert_library_index.py <sound-library dir> <output index dir>
"""
import json
import re
import sys
from pathlib import Path

PAGE = 2000


def category_id(path):
    return path.replace('/', '--') if path else 'all'


def pretty(asset_path):
    base = asset_path.rsplit('/', 1)[-1]
    base = re.sub(r'^bf0\d_', '', base)
    base = re.sub(r'_(markers|wave|config|prefab|gem|patch|mixer)_\d+$', '', base)
    words = [w for w in re.split(r'[_\-]+', base) if w]
    return ' '.join(w if any(c.isdigit() for c in w) else w.capitalize() for w in words) or base


def load_leaf_pages(index_dir, node):
    clips = []
    for page in node.get('pages') or []:
        clips.extend(json.loads((index_dir.parent / page).read_text(encoding='utf-8')))
    return clips


def convert(library, out):
    index_dir = library / 'index'
    tree = json.loads((index_dir / 'tree.json').read_text(encoding='utf-8'))
    out.mkdir(parents=True, exist_ok=True)
    search = []
    pages_written = 0

    def site_clip(c):
        file = c['file'][len('audio/'):] if c['file'].startswith('audio/') else c['file']
        portal = (c.get('portalNames') or [None])[0]
        return {'id': f"{c['assetPath']}#{c['variantIndex']}", 'name': pretty(c['assetPath']), 'assetPath': c['assetPath'],
                'variant': c['variantIndex'], 'duration': c['duration'], 'channels': c.get('channels'),
                'rate': c.get('rate'), 'codec': 'opus', 'portalName': portal,
                'loop': c.get('loop'), 'file': file, 'bytes': c.get('bytes'), 'lang': c.get('language')}

    def visit(node):
        nonlocal pages_written
        own = [site_clip(c) for c in load_leaf_pages(index_dir, node)]
        own.sort(key=lambda c: (c['name'].lower(), c['assetPath'], c['variant']))
        cid = category_id(node['path'])
        pages = max(1, -(-len(own) // PAGE)) if own else 0
        for n in range(pages):
            chunk = own[n * PAGE:(n + 1) * PAGE]
            name = f'{cid}.json' if n == 0 else f'{cid}.{n}.json'
            (out / name).write_text(json.dumps({'category': cid, 'page': n, 'pages': pages, 'clips': chunk},
                                               separators=(',', ':')), encoding='utf-8')
            pages_written += 1
            seen = set()
            for c in chunk:
                if c['assetPath'] not in seen:
                    seen.add(c['assetPath'])
                    search.append({'name': c['name'], 'category': cid, 'page': n, 'assetPath': c['assetPath']})
        children = [visit(child) for child in sorted(node.get('children', {}).values(), key=lambda x: x['name'].lower())]
        return {'id': cid, 'name': node['name'], 'path': node['path'], 'count': node['count'],
                'seconds': round(node.get('duration', 0), 2), 'own': len(own), 'children': children}

    root = visit(tree)
    top = root['children'] if not root['own'] else [root]
    (out / 'tree.json').write_text(json.dumps(top, separators=(',', ':')), encoding='utf-8')
    (out / 'search.json').write_text(json.dumps(search, separators=(',', ':')), encoding='utf-8')
    return pages_written, len(search), root['count']


if __name__ == '__main__':
    written, sounds, clips = convert(Path(sys.argv[1]), Path(sys.argv[2]))
    print(f'pages {written}, searchable sounds {sounds}, clips {clips}')
