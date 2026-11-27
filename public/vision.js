/* Pathway experimental visual assistance: read printed text from ONE photo, on this device.
 * - Loaded only after the person chooses "Take a photo of text".
 * - The photo comes from the phone's own camera app (file input with capture), so Pathway never holds a live camera.
 * - Recognition runs locally with Tesseract (WebAssembly). The image is never uploaded or stored; the canvas is cleared.
 * - Output is described as an interpretation that may be incomplete or wrong. No hazard, vehicle, crossing or face detection.
 */
(function (root) {
'use strict';
const BASE = 'vendor/tesseract-5.1.1/';
const abs = p => new URL(p, document.baseURI).href;
let libPromise = null, workerPromise = null;

function loadLibrary() {
  if (root.Tesseract) return Promise.resolve();
  if (libPromise) return libPromise;
  libPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = BASE + 'tesseract.min.js'; s.async = true;
    s.onload = () => resolve(); s.onerror = () => { libPromise = null; reject(new Error('The text-recognition files could not be downloaded.')); };
    document.head.appendChild(s);
  });
  return libPromise;
}
function getWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = loadLibrary().then(() => root.Tesseract.createWorker('eng', 1, {
      workerPath: abs(BASE + 'worker.min.js'), corePath: abs(BASE + 'tesseract-core-simd-lstm.js'), langPath: abs(BASE.replace(/\/$/, '')),
      workerBlobURL: false, // load the worker from vendor/ so the engine finds its .wasm next to it
      logger: m => onProgress && onProgress(m),
    })).catch(e => { workerPromise = null; throw e; });
  }
  return workerPromise;
}
async function toCanvas(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d'); ctx.filter = 'grayscale(1) contrast(1.2)'; ctx.drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close();
  return c;
}
function clean(data) {
  // Short sign text often gets low line confidence even when correct, so keep it but say it's unsure.
  const lines = (data.lines || []).filter(l => l.confidence >= 20)
    .map(l => ({t: l.text.replace(/[|_~^`]+/g, ' ').replace(/\s+/g, ' ').trim(), c: l.confidence}))
    .filter(({t}) => t.length >= 2 && /[A-Za-z0-9]{2}/.test(t) && (t.match(/[A-Za-z0-9]/g) || []).length / t.length > 0.6)
    .map(({t, c}) => c < 50 ? t + ' (unsure)' : t);
  return {lines, text: lines.join('. '), confidence: Math.round(data.confidence || 0)};
}
async function readText(file, onProgress) {
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('Please choose a photo.');
  const worker = await getWorker(onProgress);
  const canvas = await toCanvas(file);
  try { const {data} = await worker.recognize(canvas); return clean(data); }
  finally { canvas.width = canvas.height = 0; } // drop pixels from memory
}
async function stop() { const w = workerPromise; workerPromise = null; if (w) { try { (await w).terminate(); } catch {} } }
root.PathwayVision = {readText, stop, clean};
})(window);
