// The baby LLM: a German DistilBERT (66M parameters, int8, ~92 MB) run locally
// via transformers.js on WASM. It never writes text. It only ranks candidate
// sentences that the rules produced, so its worst failure is picking the wrong
// one of those candidates.
import { AutoTokenizer, AutoModelForMaskedLM, Tensor, env } from './vendor/transformers.min.js';

export const MODEL = 'onnx-community/distilbert-base-german-cased-ONNX';
const BATCH = 24;

env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL('./vendor/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url).href,
  wasm: new URL('./vendor/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href,
};

let loading = null;

export function load(onProgress = () => {}) {
  loading ??= (async () => {
    const opts = { progress_callback: onProgress };
    const tokenizer = await AutoTokenizer.from_pretrained(MODEL, opts);
    const model = await AutoModelForMaskedLM.from_pretrained(MODEL, { ...opts, dtype: 'q8', device: 'wasm' });
    return { tokenizer, model };
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

// Pseudo-log-likelihood of each text (Salazar et al. 2020): mask each token in
// turn and sum log P(token | rest). Only tokens in and next to the region where
// the candidates differ are scored; the shared rest contributes about equally.
export async function score(texts) {
  const { tokenizer, model } = await load();
  const ids = texts.map(t => Array.from(tokenizer(t).input_ids.data, Number));
  const first = ids[0], minLen = Math.min(...ids.map(a => a.length));
  let pre = 0;
  while (pre < minLen && ids.every(a => a[pre] === first[pre])) pre++;
  let suf = 0;
  while (suf < minLen - pre && ids.every(a => a[a.length - 1 - suf] === first[first.length - 1 - suf])) suf++;

  const jobs = []; // [candidate, position]
  ids.forEach((a, k) => {
    const from = Math.max(1, pre - 1), to = Math.min(a.length - 1, a.length - suf + 1);
    for (let i = from; i < to; i++) jobs.push([k, i]);
  });

  const scores = texts.map(() => 0);
  for (let b = 0; b < jobs.length; b += BATCH) {
    const chunk = jobs.slice(b, b + BATCH);
    const T = Math.max(...chunk.map(([k]) => ids[k].length));
    const input = new BigInt64Array(chunk.length * T), mask = new BigInt64Array(chunk.length * T);
    chunk.forEach(([k, pos], r) => {
      ids[k].forEach((id, i) => {
        input[r * T + i] = BigInt(i === pos ? tokenizer.mask_token_id : id);
        mask[r * T + i] = 1n;
      });
    });
    const { logits } = await model({
      input_ids: new Tensor('int64', input, [chunk.length, T]),
      attention_mask: new Tensor('int64', mask, [chunk.length, T]),
    });
    const V = logits.dims[2], L = logits.data;
    chunk.forEach(([k, pos], r) => {
      const off = (r * T + pos) * V;
      let max = -Infinity;
      for (let j = 0; j < V; j++) if (L[off + j] > max) max = L[off + j];
      let sum = 0;
      for (let j = 0; j < V; j++) sum += Math.exp(L[off + j] - max);
      scores[k] += L[off + ids[k][pos]] - max - Math.log(sum);
    });
  }
  return scores;
}
