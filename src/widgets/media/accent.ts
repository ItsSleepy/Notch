export const DEFAULT_ACCENT = 'rgb(29, 185, 84)';

/** Picks a vivid colour from album art, brightened so it reads on black. */
export function extractAccent(src: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const size = 16;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const g = canvas.getContext('2d');
      if (!g) return resolve(DEFAULT_ACCENT);
      g.drawImage(img, 0, 0, size, size);
      const d = g.getImageData(0, 0, size, size).data;

      let r = 0, gr = 0, b = 0, total = 0;
      for (let i = 0; i < d.length; i += 4) {
        const R = d[i], G = d[i + 1], B = d[i + 2];
        const max = Math.max(R, G, B);
        const min = Math.min(R, G, B);
        if (max < 40) continue; // ignore near-black
        const sat = (max - min) / max;
        const w = sat * sat + 0.03; // favour saturated pixels
        r += R * w; gr += G * w; b += B * w; total += w;
      }
      if (total === 0) return resolve(DEFAULT_ACCENT);
      r /= total; gr /= total; b /= total;

      const peak = Math.max(r, gr, b, 1);
      const boost = peak < 190 ? 190 / peak : 1;
      const c = (v: number) => Math.min(255, Math.round(v * boost));
      resolve(`rgb(${c(r)}, ${c(gr)}, ${c(b)})`);
    };
    img.onerror = () => resolve(DEFAULT_ACCENT);
    img.src = src;
  });
}
