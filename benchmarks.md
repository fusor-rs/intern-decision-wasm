# Benchmarks

How fast Intern-Decision-2B decides on one machine, in every runtime this project has: the page in
Chrome (eight threads and one), the native `intern-decision` CLI, the single-threaded runtimes in
Node, and the PyTorch reference on the CPU. Everything here was measured on 2026-10-22 on the
machine below; nothing is quoted from elsewhere.

The model writes nothing: a request is one forward pass, so the measure is the time from Decide to
every answer. It grows with the prompt: the request's text and, for each image, the vision tower
over its 16×16 patches and one token per 2×2 of them.

## The machine

| | |
|---|---|
| Computer | Apple M4 Pro, 14 cores (10 performance, 4 efficiency), 24 GB |
| OS | macOS 27.0.1 (Darwin 27.0.0) |
| Native CLI | `intern-decision` 0.1.2, Rust 1.99.0, release build |
| Browser | Chrome headless shell (Playwright), Node 22.16.0 |
| PyTorch | torch 2.9.1, transformers 5.14.1, f32, the checkpoint's `inference.py` (`benchmarks/pytorch.py`) |
| Bundle | `mix`, 2068 MB: 4-bit feed-forwards, every other large matrix 7-bit |

Other work ran on the machine throughout (1-minute load average 4–5.5 on 14 cores). The
eight-thread numbers in Chrome and natively are medians of three runs (the range beside them); the
rest are one run each. Rerun them with `just e2e` (add `--threads 1`), `just smoke`, `just bench`
and `just pytorch`.

## The requests

`fixtures/requests.json`, each decided by the reference into `fixtures/references.json`:

| Request | Questions | Prompt tokens | Of them, an image's |
|---|---:|---:|---:|
| `refund`: a support ticket, the state as JSON | 3 (a choice, a score, a yes-or-no) | 355 | 0 |
| `seal`: a scanned seal (`seal.png`, 640×640, 1600 patches) | 4 | 755 | 400 |

## In Chrome

`just e2e` (threaded, relaxed SIMD, eight compute threads) and `just e2e --threads 1`
(single-threaded, relaxed SIMD). The first request is decided while the model loads, so its time
includes the end of the load.

| Request | Threads | Time to the answers | Prompt tokens per second |
|---|---:|---:|---:|
| refund | 8 | 3.92 s (3.78–4.93, with the load) | 346 |
| seal | 8 | 3.35 s (3.33–3.44) | 378 |
| refund | 1 | 14.03 s (with the load) | 64 |
| seal | 1 | 19.02 s | 66 |

Every run made no network request after the model was ready, and the revisit loaded the 2068 MB
bundle from the browser's storage in about 2 s.

## In Node

`just smoke`, single-threaded SIMD128 (no relaxed SIMD), while the runtimes were building: refund
in 21.4 s, seal in 78.0 s. Read these as an upper bound.

## Native, against PyTorch

Eight threads. `intern-decision bench` (median of three; its stages: the vision tower 1.33 s and
the prompt 2.28 s of the seal's time) and `just pytorch` (one run, after a warm-up request).

| Request | intern-decision | PyTorch |
|---|---:|---:|
| refund | 1.04 s (1.04–1.20) | 4.19 s |
| seal | 3.66 s (3.62–4.01) | 5.13 s |

## Agreement with the reference

Every question of both requests is decided as the reference decides it, in Chrome, in Node and
natively. The calibrated probabilities differ from the reference's by at most:

| Bundle | Size | refund | seal |
|---|---:|---:|---:|
| `f32` | 8870 MB | 2.1·10⁻⁶ | 3.8·10⁻³ |
| `q7`, every large matrix 7-bit | 2521 MB | 0.013 | 0.013 |
| `mix` (shipped), 4-bit feed-forwards | 2068 MB | 0.026 (0.036 in the page) | 0.027 |
| 4-bit language model, 7-bit embeddings | 1834 MB | urgency decided `0`, not `1` | 0.057 |
| 4-bit language model and embeddings | 1580 MB | urgency decided `0`, not `1` | 0.049 |

The urgency question is the fixtures' closest call (the reference gives `1` 0.40 and `0` 0.37):
4-bit mixers move it to the other side. The f32 bundle's difference on the seal comes from the
vision encoder's attention, which runs on int8 kernels in every bundle. `just parity` checks every
stage against the reference's tensors: the language model's states agree within 3·10⁻⁶.

## Download

The 2068 MB bundle against the checkpoint's 4427 MB of bf16 weights (47%).
