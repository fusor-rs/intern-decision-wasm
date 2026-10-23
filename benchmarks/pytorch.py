"""The reference's speed on the CPU, measured as the page measures itself: the time from a request
to its answers (the image processor, the vision tower and the prompt through the language model,
in one forward pass), with the checkpoint's own inference.py in f32.

    python pytorch.py <checkpoint dir> <requests.json> <images dir> <threads>
"""

import importlib.util
import json
import sys
import time
from pathlib import Path

import torch

checkpoint, requests, images, threads = sys.argv[1:5]
torch.set_num_threads(int(threads))
spec = importlib.util.spec_from_file_location("inference", Path(checkpoint) / "inference.py")
inference = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = inference
spec.loader.exec_module(inference)
engine = inference.DecisionEngine(checkpoint, device="cpu", dtype="float32", media_root=images)

for name, request in json.loads(Path(requests).read_text()).items():
    engine.predict(request)
    start = time.perf_counter()
    response = engine.predict(request)
    seconds = time.perf_counter() - start
    tokens = response["usage"]["input_tokens"]
    print(f"{name}: threads {threads}, {tokens} prompt tokens in {seconds:.2f}s ({tokens / seconds:.0f}/s)", flush=True)
