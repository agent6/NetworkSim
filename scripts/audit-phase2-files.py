#!/usr/bin/env python3
"""Compare bytes against the immutable continuation baseline without extracting it."""
import hashlib
import json
import tarfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

root = Path.cwd()
archive = root / '.cache/fidelity/phase2/pre-source.tar.gz'
sha = lambda data: hashlib.sha256(data).hexdigest()
before = {}
excluded_metadata = []
def in_scope(name):
    parts = Path(name).parts
    return not any(part.startswith('._') or part == '__MACOSX' for part in parts) and (parts[0] in ('src', 'tests', 'scripts') or name in ('package.json', 'package-lock.json', 'tsconfig.json'))

with tarfile.open(archive, 'r:gz') as saved:
    for member in saved.getmembers():
        if member.isfile():
            name = member.name.removeprefix('./')
            if not in_scope(name):
                excluded_metadata.append(name)
                continue
            before[name] = {'sha256': sha(saved.extractfile(member).read()), 'bytes': member.size}

after = {}
for directory in ('src', 'tests', 'scripts'):
    for file in sorted((root / directory).rglob('*')):
        if file.is_file() and in_scope(str(file.relative_to(root))):
            after[str(file.relative_to(root))] = {'sha256': sha(file.read_bytes()), 'bytes': file.stat().st_size}
for name in ('package.json', 'package-lock.json', 'tsconfig.json'):
    file = root / name
    if file.exists():
        after[name] = {'sha256': sha(file.read_bytes()), 'bytes': file.stat().st_size}

changes = []
for name in sorted(before.keys() | after.keys()):
    old, new = before.get(name), after.get(name)
    if old == new:
        continue
    kind = 'added' if old is None else 'removed' if new is None else 'modified'
    changes.append({'path': name, 'change': kind, 'before': old, 'after': new})

result = {
    'schemaVersion': 1,
    'generatedAt': datetime.now(timezone.utc).isoformat(),
    'scope': 'Exact byte changes in src/tests/scripts/package/tsconfig since this continuation began. Shared edits are included; this is not authorship attribution or a historical pre-project diff.',
    'baseline': {'archive': str(archive.relative_to(root)), 'sha256': sha(archive.read_bytes()), 'files': len(before), 'excludedArchiveMetadataEntries': len(excluded_metadata), 'metadataPolicy': 'AppleDouble ._ entries and __MACOSX metadata are not product source files; excluded symmetrically from byte-change counts.'},
    'currentFiles': len(after),
    'counts': dict(Counter(row['change'] for row in changes)),
    'byDirectory': dict(Counter(row['path'].split('/')[0] for row in changes)),
    'changes': changes,
    'standalone': {'path': 'index.html', 'sha256': sha((root / 'index.html').read_bytes()), 'bytes': (root / 'index.html').stat().st_size},
}
output = root / 'docs/audits/phase2-changed-files.json'
output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'file': str(output.relative_to(root)), 'counts': result['counts'], 'byDirectory': result['byDirectory']}))
