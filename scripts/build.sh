#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
exec docker buildx build \
  --platform linux/amd64 \
  --load \
  --tag "${JUDGE_IMAGE:-hydrojudge:4.0.6-local}" \
  "$@" \
  "$project_dir"
