#!/usr/bin/env bash
# Downloads what `intern-decision compile` and the golden harness read into $1, each file pinned by
# revision and checked by sha256 (files already present are only checked): InternLM's
# Intern-Decision-2B weights (vision, projector, language), tokenizer, configuration, reference
# code and licenses.
set -euo pipefail
DIR="$1"
MODEL="https://huggingface.co/internlm/Intern-Decision-2B/resolve/85c5657708a09884ff9fd8d7f57789b410a97b33"
FILES="
c27d4b53f2965a962819c0ab91a4717aec2848d58a5163c19f1343b85f59ff7c  LICENSE
bbedc3fda3305820b977265f01b8619d87570a6739de3a5582c3464840f1e57a  LICENSE-QWEN
273d8e0e683b885071fb17e08d71e5f2a5ddfb5309756181681de4f5a1822d80  chat_template.jinja
ed1c1723241f23f7f4e23430759cbd7dcfb4103cbdfe052bfe7626b57c2615b4  config.json
2918862f34770c6db57cf3f86666cbd7cff1139b24f300fef01d9146584d4fd8  inference.py
27225450ac9c6529872ee1924fcb0962ff5634834f817040f444118116f4e516  preprocessor_config.json
94a639c4b33b192cc5a22cd3d7f0aaf6d97efa9577957a0382b55292ca4f0f00  tokenizer.json
f26d55ed6da1fc0de69fbaefae7b855f762e36d0052c05f4fdec312f72a22ae1  tokenizer_config.json
ca0e18ef7b32cab7d52f27f4b52a9907bce9eb8e7b0d46c26bbddecb1d10b812  model-vision-0001-save_rank0.safetensors
26e6a8056dce97e33101fffab7f41a829546771326bbc03a42696c8bbed09ac3  model-projector-0001-save_rank0.safetensors
81ee251c9280fd8f0eb6472fd79b638bffbf3b46a8729fad353e053c8891bdf5  model-language-0001-save_rank0.safetensors
"
mkdir -p "$DIR"
while read -r _ file; do
  if [ -z "$file" ] || [ -s "$DIR/$file" ]; then continue; fi
  echo "downloading $file"
  curl -fsSL --retry 3 -o "$DIR/$file.part" "$MODEL/$file"
  mv "$DIR/$file.part" "$DIR/$file"
done <<< "$FILES"
(cd "$DIR" && awk 'NF { print $1 "  " $2 }' <<< "$FILES" | shasum -a 256 -c --quiet -)
