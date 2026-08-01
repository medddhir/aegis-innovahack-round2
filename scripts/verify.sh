#!/usr/bin/env bash
set -euo pipefail
node --check public/app.js
npm run build
python3 - <<'PY'
from pathlib import Path
from html.parser import HTMLParser
import re
html = Path('dist/index.html').read_text(encoding='utf-8')
js = Path('dist/app.js').read_text(encoding='utf-8')
css = Path('dist/styles.css').read_text(encoding='utf-8')
class Parser(HTMLParser):
    def __init__(self):
        super().__init__(); self.ids=[]
    def handle_starttag(self, tag, attrs):
        attrs=dict(attrs)
        if 'id' in attrs: self.ids.append(attrs['id'])
p=Parser(); p.feed(html)
ids=set(p.ids)
refs=set(re.findall(r"\$\(['\"]#([A-Za-z0-9_-]+)['\"]", js))
missing=sorted(refs-ids)
assert not missing, f'Missing DOM IDs: {missing}'
assert len(p.ids)==len(ids), 'Duplicate DOM IDs detected'
assert css.count('{')==css.count('}'), 'Unbalanced CSS braces'
print(f'Verified {len(ids)} DOM IDs, {len(refs)} JS ID references, and balanced CSS.')
PY
