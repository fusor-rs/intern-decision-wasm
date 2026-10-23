#!/usr/bin/env bash
# Downloads the fixed images the checks read into $1, from PaddleOCR's own test files (Apache-2.0)
# at a pinned commit, each checked by sha256 (files already present are only checked). Each image
# goes with its request in `fixtures/requests.json`.
set -euo pipefail
DIR="$1"
REPO="https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf"
FILES="
be29cb91999450742958c62ead08f93825b92e5fa4290c063cc7991259da6c24  tests/test_files/seal.png
"
mkdir -p "$DIR"
while read -r _ path; do
  file="$(basename "$path")"
  if [ -z "$path" ] || [ -s "$DIR/$file" ]; then continue; fi
  curl -fsSL --retry 3 -o "$DIR/$file.part" "$REPO/$path"
  mv "$DIR/$file.part" "$DIR/$file"
done <<< "$FILES"
(cd "$DIR" && awk 'NF { n = split($2, parts, "/"); print $1 "  " parts[n] }' <<< "$FILES" | shasum -a 256 -c --quiet -)
