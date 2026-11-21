"""Downloads Poly Haven assets (CC0) into assets-src/polyhaven/<id>/.

  python3 scripts/assets/polyhaven.py model fir_tree_01 [blend|gltf] [1k]
  python3 scripts/assets/polyhaven.py texture leafy_grass [1k] [diff,nor_gl,arm]
"""
import json, os, sys, urllib.request

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets-src', 'polyhaven')
UA = {'User-Agent': 'airmail-dev'}

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA))

def save(url, path):
    if os.path.exists(path):
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with get(url) as r, open(path + '.part', 'wb') as f:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)
    os.rename(path + '.part', path)

def main():
    kind, aid = sys.argv[1], sys.argv[2]
    files = json.load(get(f'https://api.polyhaven.com/files/{aid}'))
    out = os.path.join(ROOT, aid)
    if kind == 'model':
        fmt = sys.argv[3] if len(sys.argv) > 3 else 'gltf'
        res = sys.argv[4] if len(sys.argv) > 4 else '1k'
        entry = files[fmt][res][fmt]
        save(entry['url'], os.path.join(out, os.path.basename(entry['url'])))
        for rel, inc in entry.get('include', {}).items():
            save(inc['url'], os.path.join(out, rel))
    else:
        res = sys.argv[3] if len(sys.argv) > 3 else '1k'
        maps = (sys.argv[4] if len(sys.argv) > 4 else 'diff,nor_gl').split(',')
        names = {'diff': 'Diffuse', 'nor_gl': 'nor_gl', 'arm': 'arm', 'rough': 'Rough', 'disp': 'Displacement'}
        for m in maps:
            e = files[names[m]][res]['jpg']
            save(e['url'], os.path.join(out, f'{aid}_{m}_{res}.jpg'))
    print('ok', aid)

main()
