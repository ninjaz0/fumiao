#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
COPYFILE_DISABLE=1 tar --no-xattrs --exclude '__pycache__' --exclude '._*' -czf agent.tgz worker.py render.py reference_image.py rocm_attention_patch.py sampler_progress.py video_quality.py job_progress.py install_progress.py bootstrap.py hardware_probe.py breeze_adapter.py breeze.lock.json download_sources.py package_sources.py cache_manager.py storage_platform.py runtime_cache.py limited_runtime.py resource_gate.py h3_service.py concurrent_node.py -C .. node_models.py -C agent/vendor engine
shasum -a 256 agent.tgz > agent.tgz.sha256
