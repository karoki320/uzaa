// Reads shop barcodes from camera frames, so a phone can stand in for a handheld scanner.
// 1. Phones that have a built-in barcode reader (Chrome on Android, most of them) use it: fast, reads every common type.
// 2. Others (iPhone, Windows laptops) use the reader below, written here so the app needs no extra package.
//    It reads EAN-13, EAN-8 and UPC-A, the codes printed on almost every product in a shop.

// widths of the 4 bars/spaces of each digit (L code). G code is the same read backwards; R code equals L.
const L = [[3, 2, 1, 1], [2, 2, 2, 1], [2, 1, 2, 2], [1, 4, 1, 1], [1, 1, 3, 2], [1, 2, 3, 1], [1, 1, 1, 4], [1, 3, 1, 2], [1, 2, 1, 3], [3, 1, 1, 2]];
const G = L.map((p) => [...p].reverse());
// which of the first six digits use G, written as L/G, gives the hidden first digit of an EAN-13
const FIRST = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
const MAX_ERR = 0.9;    // how far a digit may be from a perfect print, in modules (summed over its 4 runs)

function matchDigit(runs, at, sets) {
  const a = runs[at], b = runs[at + 1], c = runs[at + 2], d = runs[at + 3];
  const unit = (a + b + c + d) / 7;
  if (!unit) return null;
  let best = null, bestErr = MAX_ERR, second = 9;
  for (const [kind, table] of sets) {
    for (let n = 0; n < 10; n++) {
      const p = table[n];
      const e = Math.abs(a / unit - p[0]) + Math.abs(b / unit - p[1]) + Math.abs(c / unit - p[2]) + Math.abs(d / unit - p[3]);
      if (e < bestErr) { second = bestErr; bestErr = e; best = { n, kind }; } else if (e < second) second = e;
    }
  }
  // two digits nearly as close as each other: too blurred to trust
  if (best && second - bestErr < 0.1) return null;
  return best;
}

const near = (x, unit, n, tol = 0.6) => Math.abs(x / unit - n) <= n * tol;

export function checkDigitOk(code) {
  const d = code.split('').map(Number);
  const last = d.pop();
  let s = 0;
  for (let i = d.length - 1, w = 3; i >= 0; i--, w = 4 - w) s += d[i] * w;
  return (10 - (s % 10)) % 10 === last;
}

// runs alternate white, bar, white, ... (runs[0] is the white margin). Tries every place a start guard could be.
function decodeRuns(runs) {
  for (let i = 1; i + 42 < runs.length; i += 2) {
    const unit = (runs[i] + runs[i + 1] + runs[i + 2]) / 3;
    if (!(near(runs[i], unit, 1) && near(runs[i + 1], unit, 1) && near(runs[i + 2], unit, 1))) continue;
    if (runs[i - 1] < unit * 3) continue;   // a code has a white margin before it
    const r = tryEan13(runs, i, unit) || tryEan8(runs, i, unit);
    if (r) return r;
  }
  return null;
}

function midOk(runs, at, unit) {
  for (let k = 0; k < 5; k++) if (!near(runs[at + k], unit, 1, 0.75)) return false;
  return true;
}

function tryEan13(runs, i, unit) {
  if (i + 59 > runs.length) return null;
  let s = i + 3, digits = '', parity = '';
  for (let k = 0; k < 6; k++, s += 4) {
    // left half digits start with a space; runs[s] is a space here
    const m = matchDigit(runs, s, [['L', L], ['G', G]]);
    if (!m) return null;
    digits += m.n; parity += m.kind;
  }
  if (!midOk(runs, s, unit)) return null;
  s += 5;
  for (let k = 0; k < 6; k++, s += 4) {
    const m = matchDigit(runs, s, [['R', L]]);
    if (!m) return null;
    digits += m.n;
  }
  if (!(near(runs[s], unit, 1, 0.75) && near(runs[s + 1], unit, 1, 0.75) && near(runs[s + 2], unit, 1, 0.75))) return null;
  const first = FIRST.indexOf(parity);
  if (first < 0) return null;
  const code = first + digits;
  return checkDigitOk(code) ? code : null;
}

function tryEan8(runs, i, unit) {
  if (i + 43 > runs.length) return null;
  let s = i + 3, digits = '';
  for (let k = 0; k < 4; k++, s += 4) {
    const m = matchDigit(runs, s, [['L', L]]);
    if (!m) return null;
    digits += m.n;
  }
  if (!midOk(runs, s, unit)) return null;
  s += 5;
  for (let k = 0; k < 4; k++, s += 4) {
    const m = matchDigit(runs, s, [['R', L]]);
    if (!m) return null;
    digits += m.n;
  }
  if (!(near(runs[s], unit, 1, 0.75) && near(runs[s + 1], unit, 1, 0.75) && near(runs[s + 2], unit, 1, 0.75))) return null;
  // the end guard must be followed by white
  if (s + 3 < runs.length && runs[s + 3] < unit * 3) return null;
  return checkDigitOk(digits) ? digits : null;
}

// darkest (or lightest) value within r points of each point, in one pass
function slide(line, r, better) {
  const n = line.length, out = new Uint8Array(n), q = new Int32Array(n);
  let head = 0, tail = 0;
  for (let j = 0; j < n + r; j++) {
    if (j < n) {
      while (tail > head && better(line[j], line[q[tail - 1]])) tail--;
      q[tail++] = j;
    }
    const i = j - r;
    if (i < 0) continue;
    while (q[head] < i - r) head++;
    out[i] = line[q[head]];
  }
  return out;
}

// one line of grey values (0 dark .. 255 light) -> widths of white, bar, white, bar ... (starts with white)
function toRuns(line) {
  const n = line.length;
  let lo = 255, hi = 0;
  for (let i = 0; i < n; i++) { if (line[i] < lo) lo = line[i]; if (line[i] > hi) hi = line[i]; }
  if (hi - lo < 40) return null;   // no contrast: nothing printed here
  // the cut-off between ink and paper follows the local light, so shadows and glare across the code do not break it:
  // halfway between the darkest and lightest point nearby
  const r = Math.max(12, Math.round(n / 16));
  const runs = [];
  let dark = false, len = 0;
  const mins = slide(line, r, (x, y) => x <= y), maxs = slide(line, r, (x, y) => x >= y);
  for (let i = 0; i < n; i++) {
    const a = mins[i], b = maxs[i];
    // too little contrast nearby: plain paper (or a plain dark area)
    const d = b - a < (hi - lo) * 0.35 ? line[i] < (lo + hi) / 2 : line[i] < (a + b) / 2;
    if (d === dark) len++;
    else { runs.push(len); dark = d; len = 1; }
  }
  runs.push(len);
  return runs;
}

function readLine(line) {
  const runs = toRuns(line);
  if (!runs || runs.length < 44) return null;
  // a code read backwards (held upside down) is the same runs reversed; put a white run first again
  const back = runs.length % 2 ? [...runs].reverse() : [...runs, 0].reverse();
  return decodeRuns(runs) || decodeRuns(back);
}

// a line of n points; each point averages get(i, d) for d in -spread..spread
function band(n, get, spread = 1) {
  const line = new Uint8Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let d = -spread; d <= spread; d++) s += get(i, d); line[i] = s / (2 * spread + 1); }
  return line;
}

// Reads a whole frame (ImageData). Looks along many rows, and columns too for codes held sideways.
// Gives a code only when two lines agree, which keeps misreads out.
export function decodeImage(img) {
  const { width: w, height: h, data } = img;
  const grey = (x, y) => { const k = (y * w + x) * 4; return (data[k] * 77 + data[k + 1] * 150 + data[k + 2] * 29) >> 8; };
  const seen = {};
  const tally = (c) => { if (!c) return null; seen[c] = (seen[c] || 0) + 1; return seen[c] >= 2 ? c : null; };
  const rows = 24;
  for (let k = 0; k < rows; k++) {
    // start from the middle (where people aim) and work outwards
    const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2);
    const y = Math.round(h / 2 + off * (h * 0.8) / rows);
    if (y < 0 || y >= h) continue;
    // a thin band of rows averaged evens out sensor noise; a single row copes better with a tilted code
    const c = tally(readLine(band(w, (x, d) => grey(x, Math.min(h - 1, Math.max(0, y + d)))))) || tally(readLine(band(w, (x) => grey(x, y), 0)));
    if (c) return c;
  }
  const cols = 12;
  for (let k = 0; k < cols; k++) {
    const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2);
    const x = Math.round(w / 2 + off * (w * 0.6) / cols);
    if (x < 0 || x >= w) continue;
    const c = tally(readLine(band(h, (y, d) => grey(Math.min(w - 1, Math.max(0, x + d)), y)))) || tally(readLine(band(h, (y) => grey(x, y), 0)));
    if (c) return c;
  }
  return null;
}

// Phone's own reader, if it has one. Returns a function frame -> Promise<code|null>, or null.
export async function nativeReader() {
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return null;
  try {
    const want = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code', 'data_matrix'];
    const have = await window.BarcodeDetector.getSupportedFormats();
    const formats = want.filter((f) => have.includes(f));
    if (!formats.length) return null;
    const det = new window.BarcodeDetector({ formats });
    return async (source) => {
      const found = await det.detect(source);
      return found.length ? found[0].rawValue : null;
    };
  } catch {
    return null;
  }
}

// Same product, different ways of writing it: UPC-A (12 digits) is EAN-13 with a 0 in front.
export function barcodeKeys(code) {
  const c = String(code || '').trim();
  if (!c) return [];
  const keys = [c];
  if (/^\d{12}$/.test(c)) keys.push('0' + c);
  if (/^0\d{12}$/.test(c)) keys.push(c.slice(1));
  return keys;
}
export function findByBarcode(products, code) {
  const keys = barcodeKeys(code);
  return products.find((p) => p.barcode && keys.includes(String(p.barcode).trim())) || null;
}
