---
title: intern-decision-wasm
short_description: Intern-Decision-2B decisions in the browser, on the CPU
sdk: static
app_file: index.html
pinned: false
license: apache-2.0
models:
  - fusorlabs/intern-decision-2b-web
  - internlm/Intern-Decision-2B
custom_headers:
  cross-origin-embedder-policy: require-corp
  cross-origin-opener-policy: same-origin
  cross-origin-resource-policy: cross-origin
---

Structured decisions with InternLM's [Intern-Decision-2B](https://huggingface.co/internlm/Intern-Decision-2B),
computed on your own CPU in the browser: the model, compiled to WebAssembly with fusor-ai,
downloads once and then runs sealed from the network, answering every question about a
situation, with images if you add them, with calibrated probabilities. The model is Apache-2.0,
from Qwen3.5; both licenses ship beside the bundle as `model/LICENSE` and `model/LICENSE-QWEN`.
The page's code is MIT; its source is
[github.com/fusor-rs/intern-decision-wasm](https://github.com/fusor-rs/intern-decision-wasm).
