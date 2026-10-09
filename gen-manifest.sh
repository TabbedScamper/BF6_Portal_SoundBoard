#!/usr/bin/env bash
# Scan sounds/<Category>/*.ogg; Node preserves name-based behaviour/provenance metadata.
set -euo pipefail
SB="$(cd "$(dirname "$0")" && pwd)"
node "$SB/gen-manifest.cjs"
