"""Build aski Art Mono, the self-hosted face for rendered lettering.

It is JuliaMono Regular subset to the characters the bundled FIGlet fonts can produce. JuliaMono's OFL
reserves its name, so the subset is renamed. Run from the repository root:

  uv run --with fonttools==4.60.1 --with brotli==1.1.0 python scripts/art-font.py --source JuliaMono-Regular.ttf --license LICENSE
  ... add --check to verify the committed files instead of writing them.

The source is the JuliaMono-Regular.ttf and LICENSE from JuliaMono-ttf.tar.gz in the release named in
SOURCE; its SHA-256 must match.
"""
import argparse, glob, hashlib, io, json, pathlib, sys
from fontTools import subset
from fontTools.ttLib import TTFont

SOURCE = {
    'name': 'JuliaMono', 'version': 'v0.63.2',
    'url': 'https://github.com/cormullion/juliamono/releases/download/v0.63.2/JuliaMono-ttf.tar.gz',
    'file': 'JuliaMono-Regular.ttf',
    'sha256': '40a07da0d1601215eb6b89312eb44128a3e2f36675d3e1f518264bd391fc7023',
    'archiveSha256': 'be6517295198ec5c92bdbaad42f4f6f8d83f921d80512b79f54fe036add95c0c',
}
FAMILY = 'aski Art Mono'
FONT = pathlib.Path('public/fonts/art/aski-art-mono.woff2')
LICENSE = pathlib.Path('public/fonts/art/OFL.txt')
MANIFEST = pathlib.Path('shared/art-font.json')
sha = lambda data: hashlib.sha256(data).hexdigest()


def figlet_characters():
    """Every non-space character any bundled FIGlet font can draw, plus printable ASCII."""
    chars = {chr(code) for code in range(0x21, 0x7F)}
    for path in sorted(glob.glob('public/fonts/*.flf')):
        lines = pathlib.Path(path).read_text(encoding='utf-8').split('\n')
        header = lines[0].split()
        hardblank, comments = header[0][-1], int(header[5])
        for line in lines[1 + comments:]:
            body = line.rstrip()
            if not body: continue
            for char in body.rstrip(body[-1]):
                if char != hardblank and not char.isspace(): chars.add(char)
    return chars


def build(source: bytes):
    font = TTFont(io.BytesIO(source))
    cmap = font.getBestCmap()
    wanted = figlet_characters()
    covered = sorted((c for c in wanted if ord(c) in cmap), key=ord)
    missing = sorted((c for c in wanted if ord(c) not in cmap), key=ord)
    options = subset.Options()
    options.flavor = 'woff2'
    options.layout_features = []
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    options.notdef_outline = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=[ord(c) for c in covered] + [0x20, 0xA0])
    subsetter.subset(font)
    names = font['name']
    version = names.getDebugName(5) or ''
    copyright = names.getDebugName(0) or ''
    for record in list(names.names):
        if record.nameID in (1, 2, 3, 4, 6, 16, 17): names.removeNames(nameID=record.nameID)
    names.setName(FAMILY, 1, 3, 1, 0x409)
    names.setName('Regular', 2, 3, 1, 0x409)
    names.setName(f'{FAMILY} Regular; {version}', 3, 3, 1, 0x409)
    names.setName(f'{FAMILY} Regular', 4, 3, 1, 0x409)
    names.setName('askiArtMono-Regular', 6, 3, 1, 0x409)
    assert not any('juliamono' in str(record).lower() for record in names.names if record.nameID != 0), 'reserved name left in font'
    out = io.BytesIO()
    font.flavor = 'woff2'
    font.save(out, reorderTables=False)
    return out.getvalue(), covered, missing, copyright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--license', required=True)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    source = pathlib.Path(args.source).read_bytes()
    if sha(source) != SOURCE['sha256']: sys.exit(f'{args.source} does not match the recorded {SOURCE["file"]} SHA-256')
    woff2, covered, missing, copyright = build(source)
    upstream = pathlib.Path(args.license).read_text(encoding='utf-8')
    license_text = (f'{FAMILY} is a renamed subset of {SOURCE["name"]} {SOURCE["version"]} ({SOURCE["url"]}),\n'
                    f'distributed under the SIL Open Font License 1.1 below. "{SOURCE["name"]}" is a Reserved Font Name\n'
                    f'of the original, so this modified version uses a different name.\n\n{copyright}\n\n{upstream}')
    manifest = {
        'family': FAMILY, 'path': '/' + str(FONT.relative_to('public')), 'sha256': sha(woff2),
        'licensePath': '/' + str(LICENSE.relative_to('public')), 'licenseSha256': sha(license_text.encode()), 'license': 'OFL-1.1',
        'source': SOURCE, 'covered': ''.join(covered),
        'uncovered': 'Fullwidth forms and CJK/Hangul characters fall back to system fonts; no permissively licensed monospace face covers them at a practical size.',
        'uncoveredCodePoints': [f'U+{ord(c):04X}' for c in missing],
    }
    rendered = json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'
    if args.check:
        problems = [str(p) for p, data in ((FONT, woff2), (LICENSE, license_text.encode()), (MANIFEST, rendered.encode())) if not p.exists() or p.read_bytes() != data]
        if problems: sys.exit('Out of date: ' + ', '.join(problems))
        print(f'{FAMILY} matches its source: {len(covered)} characters, {len(woff2)} bytes.')
        return
    FONT.parent.mkdir(parents=True, exist_ok=True)
    FONT.write_bytes(woff2); LICENSE.write_text(license_text, encoding='utf-8'); MANIFEST.write_text(rendered, encoding='utf-8')
    print(f'Wrote {FONT} ({len(woff2)} bytes, {len(covered)} characters; {len(missing)} left to system fonts).')


if __name__ == '__main__':
    main()
