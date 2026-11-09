// A small PDF writer with no dependencies, enough for agreements and certificates:
// A4 pages, Helvetica (regular, bold, italic), wrapped paragraphs, lines, boxes, JPEG images,
// and page numbers. Text is limited to the Windows-1252 characters the standard fonts carry.

const W = 595.28; const H = 841.89;

// Advance widths (1/1000 em) for character codes 32..126, from the Adobe core font metrics.
const REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const FONTS = { R: ['F1', REG], B: ['F2', BOLD], I: ['F3', REG] };

/** Keep only characters the standard fonts can draw. Curly quotes and dashes become plain ones. */
export function clean(s) {
  return String(s ?? '')
    .replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/[   ]/g, ' ')
    .replace(/•/g, '\x95').replace(/·/g, '\xB7')
    .replace(/[\r\t]/g, ' ')
    .replace(/[^\x20-\x7E\n\x95\xB7]/g, '?');
}
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

export function textWidth(s, size = 10, font = 'R') {
  const w = FONTS[font][1];
  let t = 0;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    t += c >= 32 && c <= 126 ? w[c - 32] : c === 0x95 ? 350 : 278;
  }
  return (t / 1000) * size;
}

export function wrap(s, width, size = 10, font = 'R') {
  const out = [];
  for (const para of clean(s).split('\n')) {
    let line = '';
    for (const word of para.split(/ +/)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (textWidth(tryLine, size, font) <= width || !line) line = tryLine;
      else { out.push(line); line = word; }
      // a single word wider than the line is cut
      while (textWidth(line, size, font) > width && line.length > 1) {
        let k = line.length - 1;
        while (k > 1 && textWidth(line.slice(0, k), size, font) > width) k--;
        out.push(line.slice(0, k)); line = line.slice(k);
      }
    }
    out.push(line);
  }
  return out;
}

const rgb = (hex) => {
  const h = String(hex || '#000000').replace('#', '');
  return [0, 2, 4].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
};

/** Reads the pixel size from a baseline or progressive JPEG. */
export function jpegSize(buf) {
  if (!buf || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), comps: buf[i + 9] };
    }
    i += 2 + len;
  }
  return null;
}

export class Pdf {
  constructor({ margin = 56, title = '', author = '', footer = '' } = {}) {
    this.m = margin; this.title = title; this.author = author; this.footer = footer;
    this.pages = []; this.images = [];
    this.newPage();
  }

  get width() { return W - this.m * 2; }

  newPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = H - this.m;
    return this;
  }

  /** Starts a new page if fewer than h points are left. */
  need(h) { if (this.y - h < this.m + 24) this.newPage(); return this; }

  text(s, x, y, { size = 10, font = 'R', color = '#14181f' } = {}) {
    const [f] = FONTS[font];
    const t = font === 'I' ? '1 0 0.21 1' : '1 0 0 1';
    this.ops.push(`BT /${f} ${size} Tf ${rgb(color)} rg ${t} ${x.toFixed(2)} ${y.toFixed(2)} Tm (${esc(clean(s))}) Tj ET`);
    return this;
  }

  line(x1, y1, x2, y2, { color = '#d8d2c2', width = 0.8 } = {}) {
    this.ops.push(`${rgb(color)} RG ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
    return this;
  }

  rect(x, y, w, h, { fill = null, stroke = null, width = 0.8 } = {}) {
    const p = [];
    if (fill) p.push(`${rgb(fill)} rg`);
    if (stroke) p.push(`${rgb(stroke)} RG ${width} w`);
    p.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
    this.ops.push(p.join(' '));
    return this;
  }

  /** Draws a JPEG (Buffer). Returns false if it is not a JPEG the PDF can carry. */
  jpeg(buf, x, y, w, h) {
    const sz = jpegSize(buf);
    if (!sz || ![1, 3].includes(sz.comps)) return false;
    const name = `Im${this.images.length + 1}`;
    this.images.push({ name, buf, ...sz });
    this.ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /${name} Do Q`);
    return true;
  }

  // ---- flowing layout ------------------------------------------------
  /** A wrapped paragraph at the cursor. */
  para(s, { size = 10, font = 'R', color = '#14181f', indent = 0, gap = 6, lead = 1.38, align = 'left' } = {}) {
    const lines = wrap(s, this.width - indent, size, font);
    const lh = size * lead;
    for (const ln of lines) {
      this.need(lh);
      this.y -= lh;
      let x = this.m + indent;
      if (align === 'center') x = this.m + (this.width - textWidth(ln, size, font)) / 2;
      if (align === 'right') x = this.m + this.width - textWidth(ln, size, font);
      this.text(ln, x, this.y + size * 0.28, { size, font, color });
    }
    this.y -= gap;
    return this;
  }

  heading(s, { size = 12, color = '#0b5c87', gap = 4 } = {}) {
    this.need(size * 3.2);
    this.y -= size * 0.6;
    return this.para(s, { size, font: 'B', color, gap });
  }

  bullet(s, { size = 10, indent = 14, mark = '\x95' } = {}) {
    const lines = wrap(s, this.width - indent - 12, size, 'R');
    const lh = size * 1.38;
    lines.forEach((ln, i) => {
      this.need(lh);
      this.y -= lh;
      if (i === 0) this.text(mark, this.m + indent, this.y + size * 0.28, { size });
      this.text(ln, this.m + indent + 12, this.y + size * 0.28, { size });
    });
    this.y -= 3;
    return this;
  }

  /** Label / value rows, two columns. */
  rows(pairs, { size = 10, labelW = 150, gap = 4 } = {}) {
    for (const [k, v] of pairs) {
      const lines = wrap(v || '-', this.width - labelW, size, 'R');
      const lh = size * 1.38;
      this.need(lh * Math.min(lines.length, 3));
      lines.forEach((ln, i) => {
        this.need(lh);
        this.y -= lh;
        if (i === 0) this.text(k, this.m, this.y + size * 0.28, { size, font: 'B', color: '#5b6472' });
        this.text(ln, this.m + labelW, this.y + size * 0.28, { size });
      });
      this.y -= gap;
    }
    return this;
  }

  rule({ gap = 10, color = '#d8d2c2' } = {}) {
    this.need(gap * 2);
    this.y -= gap;
    this.line(this.m, this.y, W - this.m, this.y, { color });
    this.y -= gap;
    return this;
  }

  space(h) { this.y -= h; return this; }

  // ---- output --------------------------------------------------------
  toBuffer() {
    const total = this.pages.length;
    if (this.footer || total > 1) {
      this.pages.forEach((ops, i) => {
        const s = `${this.footer ? `${this.footer}   ` : ''}Page ${i + 1} of ${total}`;
        ops.push(`BT /F1 8 Tf 0.45 0.48 0.53 rg 1 0 0 1 ${this.m} 30 Tm (${esc(clean(s))}) Tj ET`);
      });
    }

    const chunks = []; const offsets = []; let len = 0;
    const put = (x) => { const b = Buffer.isBuffer(x) ? x : Buffer.from(x, 'latin1'); chunks.push(b); len += b.length; };
    const obj = (n, body) => { offsets[n] = len; put(`${n} 0 obj\n`); body(); put('\nendobj\n'); };
    const stream = (n, dict, data) => obj(n, () => { put(`<< ${dict} /Length ${data.length} >>\nstream\n`); put(data); put('\nendstream'); });

    put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    // 1 catalog, 2 pages, 3-5 fonts, 6 info, then images, then page + content pairs
    const imgStart = 7;
    const pageStart = imgStart + this.images.length;
    const kids = this.pages.map((_, i) => `${pageStart + i * 2} 0 R`).join(' ');
    obj(1, () => put('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => put(`<< /Type /Pages /Kids [${kids}] /Count ${total} >>`));
    const font = (n, base) => obj(n, () => put(`<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`));
    font(3, 'Helvetica'); font(4, 'Helvetica-Bold'); font(5, 'Helvetica-Oblique');
    const pdfStr = (s) => `(${esc(clean(s))})`;
    const now = new Date(); const pad = (v) => String(v).padStart(2, '0');
    const d = `D:${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
    obj(6, () => put(`<< /Title ${pdfStr(this.title)} /Author ${pdfStr(this.author)} /Producer (Uzaa) /CreationDate (${d}) >>`));
    const xobj = this.images.map((im, i) => `/${im.name} ${imgStart + i} 0 R`).join(' ');
    this.images.forEach((im, i) => stream(imgStart + i,
      `/Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /${im.comps === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode`, im.buf));
    this.pages.forEach((ops, i) => {
      const pn = pageStart + i * 2;
      obj(pn, () => put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >>${xobj ? ` /XObject << ${xobj} >>` : ''} >> /Contents ${pn + 1} 0 R >>`));
      stream(pn + 1, '', Buffer.from(ops.join('\n'), 'latin1'));
    });
    const count = pageStart + this.pages.length * 2;
    const xref = len;
    put(`xref\n0 ${count}\n0000000000 65535 f \n`);
    for (let n = 1; n < count; n++) put(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
    put(`trailer\n<< /Size ${count} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return Buffer.concat(chunks);
  }
}

export const PAGE = { W, H };
