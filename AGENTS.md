# AGENTS.md

Rules for coding agents in this repository that are its own. fusor-ai's
`vendor/fusor-ai/AGENTS.md` is the standard and binds here too (`CLAUDE.md`
imports both); this file adds what is particular to this product.

intern-decision-wasm is InternLM's Intern-Decision-2B (internlm/Intern-Decision-2B)
structured decision model: the model, a 2B multimodal model (a NaViT vision
encoder and Qwen3.5 2B, gated delta rule and gated attention), running in the
browser on the CPU, sealed from the network, answering a request's questions
about a state and images in one pass with calibrated probabilities. The README
describes what it does; don't invent scope, features or options beyond the task.

## Repository

- `vendor/fusor-ai/models/intern-decision/runtime`: the wasm-bindgen surface of
  the model (bundle parts, the request's JSON and its images' RGBA pixels in, the
  response's JSON out), built as four browser runtimes.
- `vendor/fusor-ai/models/intern-decision/cli`: the native CLI `intern-decision`
  (`compile`, `decide`, `bench`, `parity`).
- `app/`: the page, a [fusor](https://github.com/fusor-rs/fusor) app with its own
  Cargo workspace (fusor pins wasm-bindgen 0.2.117, the runtime 0.2.129): the
  request, deciding it and the live measurements as Rust signals in
  `src/app.rs`, the response drawn as each question's options' probabilities in
  `src/answer.rs`, the example requests in `src/examples.rs` and `examples/`, the
  template in `web/index.html`, the engine bridge and the image decoding in
  `web/app.js`, and in `engine/` the engine worker, beside the runtimes
  `just runtimes` builds.
- `scripts/`: the checkpoint and image downloads (pinned, sha256-checked), the
  Node smoke test and the agreement with the reference; `e2e/run.mjs`: the
  headless Chrome run; `fixtures/`: the requests and the reference's responses;
  `benchmarks/pytorch.py`: the reference's speed.
- [fusor-ai](https://github.com/fusor-rs/fusor-ai): the model
  (`intern-decision`), its compiler (`intern-decision-compile`), the kernels,
  blocks and bundle format come from `vendor/fusor-ai`, a git submodule pinned to
  a commit pushed to fusor-ai, with the browser loader and compute pool, the
  runtime build, the import check and the dev server.

What belongs where: model code (dimensions, tensor names, wiring, the image
preprocessing, the prompt and its JSON, the calibration) and anything another
model could reuse go to fusor-ai, following its `AGENTS.md`. This repository
holds what turns the model into an app: the page, the checks against the
reference and the deployment. A change to fusor-ai lands there first; this
repository never patches it.

Constraints that hold everywhere:

- fusor-ai comes only from `vendor/fusor-ai`, never a crates.io version, a
  `[patch]` table or a sibling checkout. The submodule moves to another pushed
  fusor-ai commit in a change of its own, with the parity numbers and the e2e
  result it gave. No copies of fusor-ai code here.
- The reference is the checkpoint's own `inference.py` (`DecisionEngine`) in
  transformers at the version its `requirements.txt` pins, with its torchvision
  image processor. The prompt's ids must stay the reference's one for one: the
  questions keep their order, and the state's JSON is written as Python's
  `json.dumps` writes it.
- The page owns every capability: decoding the images (files, drops or pastes)
  to RGBA pixels, caching the bundle (OPFS) and measuring itself. The runtime
  receives the request and pixels and does no I/O. Nothing is fetched while
  deciding.
- The model is under Apache-2.0, derived from Qwen3.5: the page and the README
  credit InternLM and Qwen with links, and the bundle ships both licenses beside
  it (`model/LICENSE`, `model/LICENSE-QWEN`). Don't remove either.

## Checks

A change is done only when this passes:

```sh
just check
```

It runs formatting and Clippy on the page and syntax checks of the scripts;
fusor-ai's `just check` covers the runtime and the CLI. A change to the runtime,
the page, the CLI or fusor-ai also needs `just runtimes`, `just smoke`, `just
parity` (the same numbers as before unless the change is meant to move them) and
`just e2e`, which must decide every fixed request as the reference does, its
probabilities within 0.05; a change meant to move speed also needs `just bench`.
The model is checked stage by stage against the reference goldens by
`intern-decision parity`; extend it rather than adding a parallel harness.

## Measuring

A speed change is judged on the page (`web-threaded-relaxed`, 8 workers, headless
Chrome through `just e2e`): the time from Decide to the answers first, the
prompt's tokens per second second. Medians of at least three fresh-profile runs
with their spread and the machine's load average; a change smaller than the
spread is not a result, and nothing else runs on the machine during a
measurement. `intern-decision bench` explains where the time went, stage by
stage. Numerically every accepted change is bit-exact unless it is meant to move
the numbers: the fixed requests get the same responses, `just parity` prints the
same digits. fusor-ai's `knowledge.md` records what the measurements taught
about V8, the kernels and their stores.

## Commits

- Don't commit, push, tag, release or deploy unless asked.
- Git runs as `andreespirela` here: the local config pins the author, the
  credential user and the remote URL, as in the other fusor repositories. Don't
  change it, and clone fusor repositories with
  `https://andreespirela@github.com/fusor-rs/<name>.git`.
