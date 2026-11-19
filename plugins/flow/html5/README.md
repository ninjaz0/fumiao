# HTML5 entity data

`html5-entities.json` is the sorted `html.entities.html5` mapping from CPython 3.12.16, matching the pinned original runtime's HTML decoding. `PYTHON-LICENSE.txt` contains the accompanying Python license. The TypeScript decoder is used only for Flow's captured media URLs, not for rendering provider HTML.

Regenerate with the project's original Python runtime:

```python
import html.entities, json
from pathlib import Path
Path('plugins/flow/html5/html5-entities.json').write_text(
    json.dumps(html.entities.html5, ensure_ascii=True, sort_keys=True, separators=(',', ':')) + '\n'
)
```
