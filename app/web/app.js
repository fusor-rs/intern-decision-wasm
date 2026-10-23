import { ComputePool, SPAWN_COMPUTE } from '../../vendor/fusor-ai/packages/host/compute.js';

// The engine bridge. The page's state lives in Rust (src/app.rs); this module owns the engine
// worker and, in threaded builds, its compute workers (fusor-ai's ComputePool), and the images:
// files chosen, dropped or pasted are decoded here to RGBA pixels and drawn as thumbnails, then
// handed to the engine worker with the request when Decide is pressed. It measures each decision
// and reports back with `engine` events.

const params = new URLSearchParams(location.search);
const cores = navigator.hardwareConcurrency || 4;
// One compute worker per core minus two (the page and the engine worker), at most 8; `?threads=1`
// forces the single-threaded build. Never more than the cores: the barriers spin.
const requestedThreads = Number.parseInt(params.get('threads') ?? '', 10);
const THREADS = Math.min(cores, requestedThreads > 0 ? requestedThreads : Math.max(1, Math.min(8, cores - 2)));
// The bundle served next to the page (`just serve` mounts dist/model there); `?model=<url>` loads
// another one, `?build=web-single` pins a runtime build.
const MODEL_URL = new URL(params.get('model') ?? 'model/', document.baseURI).href;
// The runtime's limit (`intern_decision::session::MAX_IMAGES`).
const MAX_IMAGES = 8;

const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

export function onMount({ root, inputs, onCleanup }) {
  const report = (detail) => root.dispatchEvent(new CustomEvent('engine', { detail: JSON.stringify(detail) }));
  const engine = new Worker(new URL('engine/worker.js', document.baseURI), { type: 'module', name: 'intern-decision-engine' });
  const computePool = new ComputePool(crash);
  let build = null;
  let notice = '';
  let loaded = false;
  let broken = false;
  let jobs = 0;
  let job = null;
  let pictures = [];
  let added = 0;
  let readyAt = Infinity;

  const handlers = {
    [SPAWN_COMPUTE]: (message) => computePool.spawn(message),
    runtime: (message) => (build = message),
    warning: ({ message }) => {
      console.warn(message);
      notice = ` (${message})`;
    },
    progress: ({ done, total, network, cache }) => {
      const source = cache && !network ? 'from this device' : cache ? `${mb(network)} downloaded, ${mb(cache)} cached` : 'downloading';
      report({ type: 'loading', fraction: done / total, detail: `${mb(done)} / ${mb(total)} · ${source}` });
    },
    ready: ({ ms, cache, total }) => {
      loaded = true;
      readyAt = performance.now();
      const loadedInfo = { build: `${build.build}${notice}`, threads: build.threads, bundle_bytes: total, load_ms: ms, from_device: cache === total };
      report({ type: 'ready', loaded: loadedInfo });
    },
    started: (message) => {
      if (message.job !== job?.id) return;
      job.startedAt = performance.now();
      job.plan = message.plan;
      const images = message.plan.images.length;
      const status = images ? `Looking at ${images === 1 ? 'the image' : `${images} images`}…` : 'Reading the prompt…';
      report({ type: 'progress', status, fraction: 0, metrics: metrics() });
    },
    step: (message) => {
      if (message.job !== job?.id) return;
      if (message.stage === 'merge') job.seenAt = performance.now();
      const fraction = message.read / message.rows;
      const status = message.stage === 'merge' ? 'Looking at the images…' : `Reading the prompt · ${message.read} of ${message.rows} tokens`;
      report({ type: 'progress', status, fraction, metrics: metrics(message) });
    },
    done: (message) => {
      if (message.job !== job?.id) return;
      job.doneAt = performance.now();
      const response = message.stopped ? '' : JSON.stringify(message.response, null, 2);
      report({ type: 'done', response, status: message.stopped ? 'Stopped.' : 'Done.', metrics: metrics(message) });
      job = null;
    },
    error: ({ message }) => {
      if (!loaded) return fail(message);
      job = null;
      report({ type: 'error', message });
    },
    fatal: ({ message }) => fail(message),
  };

  engine.onmessage = ({ data }) => {
    if (!broken) handlers[data.type]?.(data);
  };
  engine.onerror = (event) => crash(event.message || 'the engine worker failed');
  engine.postMessage({ type: 'load', modelUrl: MODEL_URL, threads: THREADS, build: params.get('build') });

  /** Decodes `files` to RGBA pixels, as stored (no color conversion), and adds them. */
  async function add(files) {
    if (job) return;
    for (const file of files) {
      if (pictures.length === MAX_IMAGES) return report({ type: 'error', message: `at most ${MAX_IMAGES} images` });
      try {
        const bitmap = await createImageBitmap(file, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
        const { width, height } = bitmap;
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
        context.drawImage(bitmap, 0, 0);
        const rgba = context.getImageData(0, 0, width, height, { colorSpace: 'srgb' }).data;
        pictures.push({ index: added++, name: file.name || 'pasted image', width, height, rgba, bitmap });
      } catch (error) {
        report({ type: 'error', message: `could not read ${file.name || 'the image'} (${error?.message ?? error})` });
      }
    }
    listPictures();
  }

  function listPictures() {
    report({ type: 'pictures', pictures: pictures.map(({ index, name, width, height }) => ({ index, name, width, height })) });
  }

  /** Draws each picture into its thumbnail once the page has drawn the canvas for it. */
  function drawThumbnails() {
    for (const canvas of root.querySelectorAll('canvas[data-picture]')) {
      const picture = pictures.find((entry) => String(entry.index) === canvas.dataset.picture);
      if (!picture || canvas.dataset.drawn === canvas.dataset.picture) continue;
      canvas.dataset.drawn = canvas.dataset.picture;
      const scale = Math.min(1, (96 * devicePixelRatio) / picture.height);
      canvas.width = Math.round(picture.width * scale);
      canvas.height = Math.round(picture.height * scale);
      canvas.getContext('2d').drawImage(picture.bitmap, 0, 0, canvas.width, canvas.height);
    }
  }

  function decide() {
    job = { id: ++jobs, t0: performance.now(), startedAt: null, seenAt: null, doneAt: null, plan: null };
    const rgba = new Uint8Array(pictures.reduce((sum, picture) => sum + picture.rgba.length, 0));
    let at = 0;
    for (const picture of pictures) {
      rgba.set(picture.rgba, at);
      at += picture.rgba.length;
    }
    const sizes = new Uint32Array(pictures.flatMap(({ width, height }) => [width, height]));
    engine.postMessage({ type: 'decide', job: job.id, request: inputs.request.get(), rgba, sizes }, [rgba.buffer, sizes.buffer]);
  }

  function stop() {
    if (job) engine.postMessage({ type: 'stop', job: job.id });
  }

  function clear() {
    for (const picture of pictures) picture.bitmap.close();
    pictures = [];
    listPictures();
  }

  async function copy() {
    const text = root.querySelector('#response')?.textContent ?? '';
    await navigator.clipboard.writeText(text).catch(() => {}); // a refused clipboard has nothing to report
  }

  function metrics(message = {}) {
    const ownRequests = performance.getEntriesByType('resource').filter((entry) => entry.startTime >= readyAt).length;
    const plan = job?.plan;
    const readFrom = job?.seenAt ?? job?.startedAt;
    return {
      total_ms: job?.doneAt ? job.doneAt - job.t0 : null,
      prompt_tokens: plan?.prompt_tokens ?? 0,
      image_tokens: plan?.image_tokens ?? 0,
      reading_ms: job?.doneAt && readFrom ? job.doneAt - readFrom : 0,
      requests: ownRequests + (message.networkRequests ?? 0),
    };
  }

  /** The model could not load, or the engine or a compute thread died. */
  function fail(message) {
    broken = true;
    engine.terminate();
    computePool.terminate();
    report({ type: 'broken', message });
  }

  function crash(message) {
    fail(`The engine stopped: ${message}.`);
  }

  const file = root.querySelector('#file');
  const onFile = () => {
    add([...file.files]);
    file.value = '';
  };
  const onDrop = (event) => {
    event.preventDefault();
    add([...(event.dataTransfer?.files ?? [])].filter((entry) => entry.type.startsWith('image/')));
  };
  const onDragOver = (event) => event.preventDefault();
  const onPaste = (event) => {
    const items = [...(event.clipboardData?.items ?? [])].filter((entry) => entry.type.startsWith('image/'));
    if (items.length) add(items.map((item) => item.getAsFile()));
  };
  const thumbnails = new MutationObserver(drawThumbnails);
  thumbnails.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-picture'] });
  file.addEventListener('change', onFile);
  root.addEventListener('drop', onDrop);
  root.addEventListener('dragover', onDragOver);
  document.addEventListener('paste', onPaste);
  onCleanup(onClicks(inputs.decides, decide));
  onCleanup(onClicks(inputs.stops, stop));
  onCleanup(onClicks(inputs.clears, clear));
  onCleanup(onClicks(inputs.copies, copy));
  onCleanup(() => {
    file.removeEventListener('change', onFile);
    root.removeEventListener('drop', onDrop);
    root.removeEventListener('dragover', onDragOver);
    document.removeEventListener('paste', onPaste);
    thumbnails.disconnect();
    engine.terminate();
    computePool.terminate();
  });
}

/** Runs `action` once per click a click counter counts, clicks before this module loaded included. */
function onClicks(counter, action) {
  let seen = 0;
  return counter.subscribe((count) => {
    for (; seen < count; seen++) action();
  });
}
