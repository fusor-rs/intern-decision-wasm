---
license: apache-2.0
base_model:
  - internlm/Intern-Decision-2B
pipeline_tag: image-text-to-text
library_name: fusor-ai
tags:
  - webassembly
  - wasm
  - on-device
---

# Intern-Decision-2B, compiled for the browser

InternLM's [Intern-Decision-2B](https://huggingface.co/internlm/Intern-Decision-2B) compiled into a
[fusor-ai](https://github.com/fusor-rs/fusor-ai) bundle: the weights the browser runtime of
[intern-decision-wasm](https://github.com/fusor-rs/intern-decision-wasm) loads to answer questions
with calibrated probabilities on the device's CPU. Try it in the Space
[fusorlabs/intern-decision-wasm](https://huggingface.co/spaces/fusorlabs/intern-decision-wasm).

- **Source:** `internlm/Intern-Decision-2B` at revision
  `85c5657708a09884ff9fd8d7f57789b410a97b33`, compiled with the `mix` profile: 4-bit
  feed-forwards, everything else 7-bit (2068 MB).
- **Format:** `manifest.json` lists every tensor and part; each part is named by its BLAKE3 hash,
  which the runtime checks as it loads.
- **Reproduce it:** `just model` in intern-decision-wasm downloads the checkpoint and compiles the
  same bundle.

This is not a PyTorch or safetensors checkpoint: it only loads in the intern-decision-wasm runtime.

The model is Apache-2.0 ([LICENSE](LICENSE)), built on Qwen3.5 ([LICENSE-QWEN](LICENSE-QWEN)).
