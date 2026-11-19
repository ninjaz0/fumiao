"""Flow public catalog snapshot; model variants retain their upstream identities."""
import json
from pathlib import Path
MODELS = json.loads(Path(__file__).with_name('flow_models.json').read_text())
# Keep the full protocol catalog for historical assets and completed tasks.
# Product availability is restricted to the two families selected by the owner.
VISIBLE_PREFIXES = ('flow:veo-3.1-quality', 'flow:omni-1.2-flash')
for model, item in MODELS.items():
    item['hidden'] = not any(model == prefix or model.startswith(prefix + '-') for prefix in VISIBLE_PREFIXES)

def is_flow(model):
    return model in MODELS

def spec(model):
    return MODELS.get(model)
