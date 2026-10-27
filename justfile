# InternLM's Intern-Decision-2B in the browser. `just ui` builds everything, the model included, and
# serves the page; `just build` then `just serve` do the same in two steps.

import 'vendor/fusor-ai/just/product.just'

name := "intern-decision"
checkpoint := env_var_or_default("CHECKPOINT", ".cache/checkpoint")
profile := env_var_or_default("PROFILE", "mix")
model_f32 := "dist/model-f32"
goldens := "fixtures/goldens"
images := "fixtures/images"
# The threaded builds' shared memory: the 2.1 GB bundle, the language model's cache and the vision
# activations of the largest image need more than fusor-ai's 2 GB default.
export MAX_MEMORY := "4294967296"
# The reference the goldens come from (vendor/fusor-ai/models/intern-decision/reference): the
# checkpoint's inference.py in transformers, pinned as its requirements.txt pins it.
reference := "uv run --no-project --python 3.12 --with transformers==5.14.1 --with torch==2.9.1 --with torchvision==0.24.1 --with numpy==2.5.4 --with pillow==13.0.0 --with safetensors==0.8.0 python"

host:
    bash -n scripts/fetch-checkpoint.sh
    bash -n scripts/fetch-images.sh
    python3 -m py_compile benchmarks/pytorch.py
    node --check app/web/app.js
    node --check app/engine/worker.js
    node --check scripts/node-smoke.mjs
    node --check scripts/agreement.mjs
    node --check e2e/run.mjs
    node --check scripts/render-images.mjs

# Downloads the pinned checkpoint (4.4 GB, sha256-checked) unless it is already there, then
# compiles the bundle (seconds) with the model's licenses beside it.
model: native
    scripts/fetch-checkpoint.sh {{checkpoint}}
    rm -rf {{model}}
    target/release/intern-decision compile {{checkpoint}} {{model}} --profile {{profile}}
    cp {{checkpoint}}/LICENSE {{checkpoint}}/LICENSE-QWEN {{model}}/

# Try it on localhost. The bundle and the runtimes are rebuilt every time (incremental, seconds
# when nothing changed), so they always come from the same fusor-ai.
ui: model runtimes page serve

# The fixed image the checks read: PaddleOCR's own test file at a pinned commit (sha256-checked),
# with its request in fixtures/requests.json.
images:
    scripts/fetch-images.sh {{images}}

# Every stage against the reference's goldens (vendor/fusor-ai/models/intern-decision/reference),
# with the f32 bundle.
parity: native
    test -f {{goldens}}/golden_f32_seal.safetensors || just goldens
    scripts/fetch-checkpoint.sh {{checkpoint}}
    rm -rf {{model_f32}}
    target/release/intern-decision compile {{checkpoint}} {{model_f32}} --profile f32
    target/release/intern-decision parity {{model_f32}} {{goldens}}/golden_f32_refund.safetensors {{goldens}}/golden_f32_seal.safetensors

# Golden tensors of every request and the reference's responses (fixtures/references.json), from
# the reference in f32 on the CPU (minutes).
goldens: images
    scripts/fetch-checkpoint.sh {{checkpoint}}
    {{reference}} {{fusor_ai}}/models/intern-decision/reference/dump.py {{checkpoint}} fixtures/requests.json {{images}} {{goldens}} fixtures/references.json

bench: native images
    target/release/intern-decision bench {{model}} fixtures/requests.json seal --images {{images}}

# The reference's speed on this CPU (benchmarks/pytorch.py), on the same requests as `just e2e`,
# with as many threads as the page's compute workers.
pytorch threads="8": images
    scripts/fetch-checkpoint.sh {{checkpoint}}
    {{reference}} benchmarks/pytorch.py {{checkpoint}} fixtures/requests.json {{images}} {{threads}}

# Its tensor parts are named by their BLAKE3, so /model/parts/ can be cached as immutable.
# The page, its four runtimes and the bundle beside it, as a static site in target/site.
site: runtimes page
    rm -rf target/site
    mkdir -p target/site
    cp -R {{app}}/dist/. target/site/
    find target/site -name '.fusor-*.json' -delete
    node scripts/site-bundle.mjs {{model}} target/site/model
    cp {{model}}/LICENSE {{model}}/LICENSE-QWEN target/site/model/

# The Space holds at most 1 GB, so it gets the page, the runtimes and the model's licenses, and the
# page loads the bundle from the model repo fusorlabs/intern-decision-2b-web (`just deploy-model`). The Space must
# already exist as a static Space: creating it with the upload makes a Gradio Space, which
# Hugging Face refuses for a free organization.
# The site to the Hugging Face Space fusorlabs/intern-decision-wasm, configured by space/README.md.
deploy-space: site
    #!/usr/bin/env bash
    set -euo pipefail
    rm -rf target/space
    rsync -a --exclude /model target/site/ target/space/
    rsync -a --include '*/' --include 'LICENSE*' --include NOTICE --exclude '*' target/site/model/ target/space/model/
    cp space/README.md target/space/
    uv run --no-project --with huggingface_hub==0.36.2 python - target/space <<'PY'
    import sys
    from huggingface_hub import HfApi

    HfApi().upload_folder(
        repo_id="fusorlabs/intern-decision-wasm",
        repo_type="space",
        folder_path=sys.argv[1],
        delete_patterns="*",
        commit_message="Deploy intern-decision-wasm {{version}}",
    )
    PY

# Deploy it before the Space whenever the bundle changes: the runtime only loads a bundle compiled
# with the same fusor-ai.
# The site's bundle, with space/MODEL.md as its card, to the model repo fusorlabs/intern-decision-2b-web.
deploy-model: site
    #!/usr/bin/env bash
    set -euo pipefail
    cp space/MODEL.md target/site/model/README.md
    uv run --no-project --with huggingface_hub==0.36.2 python - target/site/model <<'PY'
    import sys
    from huggingface_hub import HfApi

    api = HfApi()
    api.create_repo("fusorlabs/intern-decision-2b-web", exist_ok=True)
    api.upload_folder(
        repo_id="fusorlabs/intern-decision-2b-web",
        folder_path=sys.argv[1],
        delete_patterns="*",
        commit_message="Deploy the intern-decision-wasm {{version}} bundle",
    )
    PY

# The fixed inputs the checks read.
fixtures: images
