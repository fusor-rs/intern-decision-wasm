// Runs a single-threaded wasm runtime build in Node against a bundle: pushes every part the way
// the browser loader does, then decides each request of fixtures/requests.json (its PNG images
// decoded here), step by step as the page does, and prints its time, the prompt's tokens per
// second and its agreement with the reference's response (fixtures/references.json). With
// `--out`, each response is written to `<dir>/<request>.response.json`.
//
//   node scripts/node-smoke.mjs dist/model --build web-single [--images fixtures/images] [--out dir]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { inflateSync } from 'node:zlib';
import { agreement } from './agreement.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    build: { type: 'string', default: 'web-single' },
    images: { type: 'string', default: 'fixtures/images' },
    out: { type: 'string' },
  },
});
// A response whose options' probabilities differ from the reference's by more than this, or that
// decides a question otherwise, fails the run. The quantized bundle moves them by up to 0.03.
const MAX_DELTA = 0.05;

const bundle = positionals[0] ?? 'dist/model';
const dist = new URL(`../app/engine/dist/${values.build}/`, import.meta.url);
const glue = await import(new URL('intern_decision_runtime.js', dist));
glue.initSync({ module: readFileSync(new URL('intern_decision_runtime_bg.wasm', dist)) });

const CHUNK = 8 << 20;
const t0 = performance.now();
const manifest = readFileSync(join(bundle, 'manifest.json'), 'utf8');
const runtime = new glue.Runtime(manifest);
let ready = false;
JSON.parse(manifest).parts.forEach((part, index) => {
  const bytes = readFileSync(join(bundle, part.file));
  for (let o = 0; o < bytes.length; o += CHUNK) runtime.write_part(index, bytes.subarray(o, o + CHUNK));
  ready = runtime.end_part(index);
});
if (!ready) throw new Error('engine not ready after every part');
console.log(`${values.build}: load ${((performance.now() - t0) / 1000).toFixed(2)}s`);

const requests = JSON.parse(readFileSync('fixtures/requests.json', 'utf8'));
const references = JSON.parse(readFileSync('fixtures/references.json', 'utf8'));
let failed = false;
if (values.out) mkdirSync(values.out, { recursive: true });
for (const [name, { images = [], ...request }] of Object.entries(requests)) {
  const pictures = images.map((file) => readPng(readFileSync(join(values.images, file))));
  const rgba = new Uint8Array(pictures.reduce((sum, picture) => sum + picture.rgba.length, 0));
  let at = 0;
  for (const picture of pictures) {
    rgba.set(picture.rgba, at);
    at += picture.rgba.length;
  }
  const sizes = new Uint32Array(pictures.flatMap(({ width, height }) => [width, height]));
  const start = performance.now();
  const plan = JSON.parse(runtime.start(JSON.stringify(request), rgba, sizes));
  let progress = JSON.parse(runtime.step());
  while (!progress.response) progress = JSON.parse(runtime.step());
  const seconds = (performance.now() - start) / 1000;
  const { differing, maxDelta } = agreement(references[name], progress.response);
  const decisions = Object.values(progress.response.answers).map((answer) => answer.decision).join(', ');
  console.log(`  ${name}: ${plan.prompt_tokens} prompt tokens (${plan.image_tokens} of images) in ${seconds.toFixed(2)}s (${(plan.prompt_tokens / seconds).toFixed(1)}/s); decided ${decisions}; ${differing.length ? `differs from the reference on ${differing.join(', ')}` : 'as the reference'}, probabilities within ${maxDelta.toFixed(4)}`);
  failed ||= differing.length > 0 || maxDelta > MAX_DELTA;
  if (values.out) writeFileSync(join(values.out, `${name}.response.json`), `${JSON.stringify(progress.response, null, 2)}\n`);
}
if (failed) process.exit(1);

/** The pixels of an 8-bit, non-interlaced PNG (grey, grey and alpha, RGB or RGBA), as RGBA. */
function readPng(bytes) {
  const CHANNELS = { 0: 1, 4: 2, 2: 3, 6: 4 };
  let width = 0;
  let height = 0;
  let channels = 0;
  const data = [];
  for (let at = 8; at < bytes.length; ) {
    const size = bytes.readUInt32BE(at);
    const type = bytes.toString('ascii', at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + size);
    if (type === 'IHDR') {
      [width, height] = [body.readUInt32BE(0), body.readUInt32BE(4)];
      if (body[8] !== 8 || body[12] !== 0 || !(body[9] in CHANNELS)) throw new Error('an 8-bit, non-interlaced PNG expected');
      channels = CHANNELS[body[9]];
    }
    if (type === 'IDAT') data.push(body);
    at += 12 + size;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const corner = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      pixels[y * stride + x] = (line[x] + predict(filter, left, up, corner)) & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const pixel = pixels.subarray(i * channels, (i + 1) * channels);
    const [r, g, b] = channels >= 3 ? pixel : [pixel[0], pixel[0], pixel[0]];
    rgba.set([r, g, b, channels % 2 === 0 ? pixel[channels - 1] : 255], i * 4);
  }
  return { width, height, rgba };
}

/** PNG's filter predictor of a byte from its left, upper and upper-left neighbours. */
function predict(filter, left, up, corner) {
  if (filter === 0) return 0;
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return (left + up) >> 1;
  const estimate = left + up - corner;
  const [toLeft, toUp, toCorner] = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - corner)];
  return toLeft <= toUp && toLeft <= toCorner ? left : toUp <= toCorner ? up : corner;
}
