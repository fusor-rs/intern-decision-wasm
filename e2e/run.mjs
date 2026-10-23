// End-to-end run in headless Chrome, in a fresh profile, of the page deciding the fixed requests.
//
// 1. Open the page, write the first request (text only) into the editors and press Decide while
//    the model is still loading: it is decided the moment the model is ready. Check every
//    question is decided as the reference decides it, its probabilities close to the reference's,
//    the answers drawn, and that nothing was requested after the model was ready.
// 2. Decide the request with an image (`seal.png`), and check the same.
// 3. Reload: the revisit must load every part from OPFS.
//
//   PORT=8787 node e2e/run.mjs [--threads 8] [--build web-threaded] [--max-delta 0.05]
//   node e2e/run.mjs --url https://example.org    # a deployed page, no local server
//
// Results (JSON, responses, screenshots) go to e2e/results/<timestamp>-*, or to `--out <dir>`.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetched, flags, log, run, STAMP } from '../vendor/fusor-ai/packages/e2e/kit.mjs';
import { agreement } from '../scripts/agreement.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const values = flags({
  'max-delta': { type: 'string', default: '0.05' },
});
const DEADLINE_MS = 10 * 60 * 1000;

const requests = JSON.parse(readFileSync(join(ROOT, 'fixtures/requests.json'), 'utf8'));
const references = JSON.parse(readFileSync(join(ROOT, 'fixtures/references.json'), 'utf8'));
const maxDelta = Number(values['max-delta']);

// The page's state machine is `main[data-phase]`: idle, deciding, broken.
const idle = () => /^(idle|broken)$/.test(document.querySelector('main')?.dataset.phase ?? '');
const loadedOrBroken = () => document.querySelector('main')?.dataset.loaded === 'true' || document.querySelector('main')?.dataset.phase === 'broken';

/** The response, the answers drawn and the metric tiles, as the page shows them. */
async function readPage(page) {
  const tiles = ['time', 'speed', 'tokens', 'image-tokens', 'requests'];
  const shown = await Promise.all(tiles.map((id) => page.textContent(`#${id}`)));
  return {
    response: await page.textContent('#response'),
    drawn: await page.$$eval('#answers .question', (questions) => questions.length),
    status: await page.textContent('#status'),
    ...Object.fromEntries(tiles.map((id, i) => [id, shown[i]])),
  };
}

/** Writes request `name` into the page, adds its images and presses Decide; resolves once the
 * answers are drawn, with the requests made after the model was ready. */
async function decide(page, name, requestsSeen) {
  const { images = [], state, questions } = requests[name];
  if ((await page.$$('canvas[data-picture]')).length) await page.click('#clear');
  if (images.length) {
    await page.setInputFiles('#file', images.map((file) => join(ROOT, 'fixtures/images', file)));
    await page.waitForFunction((count) => document.querySelectorAll('canvas[data-picture]').length === count, images.length, { timeout: DEADLINE_MS });
  }
  await page.fill('#state', typeof state === 'string' ? state : JSON.stringify(state, null, 2));
  await page.fill('#questions', JSON.stringify(questions, null, 2));
  const t0 = Date.now();
  await page.click('#decide');
  await page.waitForFunction(loadedOrBroken, null, { timeout: DEADLINE_MS, polling: 250 });
  const mark = requestsSeen.length;
  await page.waitForFunction(idle, null, { timeout: DEADLINE_MS, polling: 250 });
  return { ...(await readPage(page)), wallMs: Date.now() - t0, fetched: fetched(requestsSeen, mark) };
}

function checkAnswer(check, name, decided) {
  const questions = Object.keys(requests[name].questions).length;
  check(decided.status === 'Done.', `${name}: ${decided.tokens} prompt tokens (${decided['image-tokens']} of images) in ${decided.time}, ${decided.speed}; ${(decided.wallMs / 1000).toFixed(1)} s in all`);
  const response = JSON.parse(decided.response || '{"answers": {}}');
  const { differing, maxDelta: delta } = agreement(references[name], response);
  decided.maxDelta = delta;
  decided.decisions = Object.fromEntries(Object.entries(response.answers).map(([question, answer]) => [question, answer.decision]));
  check(differing.length === 0, `${name}: decided as the reference${differing.length ? `, but not ${differing.join(', ')}` : ''}`);
  check(delta <= maxDelta, `${name}: probabilities within ${delta.toFixed(4)} of the reference's (at most ${maxDelta})`);
  check(decided.drawn === questions, `${name}: ${decided.drawn} of ${questions} answers drawn`);
  check(decided.fetched.length === 0 && decided.requests === '0', `${name}: requests while deciding: ${decided.fetched.length} seen, page counts ${decided.requests}`);
}

const launch = {
  root: ROOT,
  name: 'intern-decision',
  values,
  fields: { cases: {} },
};
await run(launch, async ({ page, requests: requestsSeen, query, base, runDir, results, check, revisit }) => {
  await page.goto(`${base}/${query}`);
  await page.waitForSelector('main[data-phase]');
  results.decidedWhileLoading = (await page.getAttribute('main', 'data-loaded')) !== 'true';
  log(`page open, the model ${results.decidedWhileLoading ? 'still loading' : 'loaded'}`);
  for (const name of Object.keys(requests)) {
    const decided = await decide(page, name, requestsSeen);
    results.runtime ??= await page.textContent('#runtime');
    checkAnswer(check, name, decided);
    results.cases[name] = decided;
    writeFileSync(join(runDir, `${STAMP}-${name}.response.json`), `${decided.response}\n`);
    await page.screenshot({ path: join(runDir, `${STAMP}-${name}.png`), fullPage: true });
  }

  await revisit(loadedOrBroken, DEADLINE_MS);
});
