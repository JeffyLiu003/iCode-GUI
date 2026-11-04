"""Package only the explicit source/documentation allowlist, never user data."""
import hashlib
import json
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import zipfile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text())['version']
stamp = datetime.now(ZoneInfo('Asia/Shanghai')).strftime('%Y%m%d-%H%M%S')
output = root / 'releases'
output.mkdir(exist_ok=True)
archive = output / f'iCode-GUI-v{version}-source-{stamp}.zip'
files = []
for folder in ('src', 'scripts', 'tests', 'docs', 'runtime'):
    files.extend(p for p in (root / folder).rglob('*') if p.is_file() and not p.is_symlink()
                 and p.name != '.DS_Store' and '__pycache__' not in p.parts and not p.name.endswith(('.pyc', '.log')))
files.extend(root / f for f in ('.gitignore', 'package.json', 'package-lock.json', 'index.html',
                               'tsconfig.json', 'vite.config.ts', 'README.md', '架构说明书.md', '分发与启动说明.md'))
manifest = {'version': version, 'type': 'source', 'files': []}
with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
    for path in sorted(files):
        data = path.read_bytes()
        name = path.relative_to(root).as_posix()
        bundle.write(path, 'iCode-GUI/' + name)
        manifest['files'].append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    bundle.writestr('iCode-GUI/SOURCE_MANIFEST.json', json.dumps(manifest, ensure_ascii=False, indent=2))
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    for entry in manifest['files']:
        assert hashlib.sha256(bundle.read('iCode-GUI/' + entry['path'])).hexdigest() == entry['sha256']
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix('.zip.sha256').write_text(f'{digest}  {archive.name}\n')
print(json.dumps({'archive': str(archive), 'bytes': archive.stat().st_size,
                  'files': len(manifest['files']) + 1, 'sha256': digest}, ensure_ascii=False))
