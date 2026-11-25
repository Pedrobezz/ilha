// Gera o ícone do app (PNG 256 + ICO com vários tamanhos) sem dependências externas.
// Desenho: quadrado arredondado escuro com degradê e a "ilha" preta no topo, com um ponto verde.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crcTable() { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; }
const T = crcTable();
const crc = b => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };

function draw(S) {
  const px = Buffer.alloc(S * S * 4);
  const R = S * 0.22;                       // raio do quadrado
  const pw = S * 0.5, ph = S * 0.17, pr = ph / 2, py = S * 0.2; // pílula
  const inRoundRect = (x, y) => { const dx = Math.max(Math.abs(x - S / 2) - (S / 2 - R), 0), dy = Math.max(Math.abs(y - S / 2) - (S / 2 - R), 0); return dx * dx + dy * dy <= R * R; };
  const inPill = (x, y) => { const lx = Math.max(Math.abs(x - S / 2) - (pw / 2 - pr), 0), ly = Math.abs(y - (py + pr)); return lx * lx + ly * ly <= pr * pr; };
  const inDot = (x, y) => Math.hypot(x - (S / 2 + pw / 2 - pr), y - (py + pr)) <= pr * 0.42;
  const N = 4;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) {
      const X = x + (sx + .5) / N, Y = y + (sy + .5) / N;
      if (!inRoundRect(X, Y)) continue;
      let cr, cg, cb;
      if (inDot(X, Y)) { cr = 48; cg = 209; cb = 88; }
      else if (inPill(X, Y)) { cr = 4; cg = 4; cb = 6; }
      else {
        // degradê diagonal (roxo-azulado → laranja suave), escuro como vidro
        const t = (X + Y) / (2 * S);
        cr = 40 + 150 * t; cg = 44 + 40 * t; cb = 92 - 30 * t;
        const shade = 0.55 + 0.45 * (Y / S); cr *= shade; cg *= shade; cb *= shade;
        if (Y < S * 0.08) { cr += 18; cg += 18; cb += 22; } // brilho no topo
      }
      r += cr; g += cg; b += cb; a++;
    }
    const i = (y * S + x) * 4;
    if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; px[i + 3] = Math.round(255 * a / (N * N)); }
  }
  const raw = Buffer.alloc((S * 4 + 1) * S);
  for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(S, 0); ih.writeUInt32BE(S, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map(draw);
// ICO com PNG embutido
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length; const dir = [];
sizes.forEach((s, i) => { const e = Buffer.alloc(16); e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12); offset += pngs[i].length; dir.push(e); });
fs.writeFileSync(path.join(__dirname, 'icon.ico'), Buffer.concat([header, ...dir, ...pngs]));
fs.writeFileSync(path.join(__dirname, 'icon.png'), pngs[sizes.length - 1]);
console.log('ícones gerados');
