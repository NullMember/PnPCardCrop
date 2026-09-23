// Raster helpers for the vector editor (canonical copy in the hub's shared/): region detection on images, exact
// distance transforms (for offsetting shapes) and tracing a mask's outline
// back into a polygon. Pure functions on typed arrays, except rasterize().

const Raster = (() => {
    // ---- Masks ------------------------------------------------------------------------

    // Most common colour along the image border (quantised), used as "background".
    function borderColor(data, w, h) {
        const counts = new Map();
        const add = (x, y) => {
            const i = (y * w + x) * 4;
            if (data[i + 3] < 32) return;
            const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
            const c = counts.get(key) || { n: 0, r: 0, g: 0, b: 0 };
            c.n++; c.r += data[i]; c.g += data[i + 1]; c.b += data[i + 2];
            counts.set(key, c);
        };
        for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
        for (let y = 0; y < h; y++) { add(0, y); add(w - 1, y); }
        let best = null;
        counts.forEach((c) => { if (!best || c.n > best.n) best = c; });
        return best ? { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n } : { r: 255, g: 255, b: 255 };
    }

    const colorDist = (data, i, c) => Math.max(Math.abs(data[i] - c.r), Math.abs(data[i + 1] - c.g), Math.abs(data[i + 2] - c.b));

    // The object under `seed` (pixel index): everything that differs from the
    // background colour (or is opaque, for transparent images) and is
    // connected to the seed. If the seed itself looks like background, fall
    // back to a magic-wand region of the seed's own colour.
    // 1 where a pixel differs from the background (or is opaque, for images
    // with transparency).
    function foregroundMask(data, w, h, tolerance) {
        const bg = borderColor(data, w, h);
        const n = w * h;
        const isObject = new Uint8Array(n);
        let hasTransparency = false;
        for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 32) { hasTransparency = true; break; }
        for (let i = 0; i < n; i++) {
            const o = i * 4;
            isObject[i] = hasTransparency ? (data[o + 3] >= 128 ? 1 : 0) : (colorDist(data, o, bg) > tolerance ? 1 : 0);
        }
        return isObject;
    }

    function objectMask(data, w, h, seed, tolerance) {
        const n = w * h;
        const isObject = foregroundMask(data, w, h, tolerance);
        let region = isObject;
        if (!isObject[seed]) {
            const c = { r: data[seed * 4], g: data[seed * 4 + 1], b: data[seed * 4 + 2] };
            region = new Uint8Array(n);
            for (let i = 0; i < n; i++) region[i] = colorDist(data, i * 4, c) <= tolerance ? 1 : 0;
        }
        return component(region, w, h, seed);
    }

    // 4-connected component containing seed (or the largest one if seed < 0).
    function component(mask, w, h, seed) {
        const n = w * h;
        const labels = new Int32Array(n);
        const stack = [];
        let label = 0, best = 0, bestSize = 0;
        const fill = (start) => {
            label++;
            let size = 0;
            labels[start] = label;
            stack.push(start);
            while (stack.length) {
                const j = stack.pop();
                size++;
                const x = j % w;
                if (x > 0 && mask[j - 1] && !labels[j - 1]) { labels[j - 1] = label; stack.push(j - 1); }
                if (x < w - 1 && mask[j + 1] && !labels[j + 1]) { labels[j + 1] = label; stack.push(j + 1); }
                if (j >= w && mask[j - w] && !labels[j - w]) { labels[j - w] = label; stack.push(j - w); }
                if (j < n - w && mask[j + w] && !labels[j + w]) { labels[j + w] = label; stack.push(j + w); }
            }
            return size;
        };
        if (seed >= 0) {
            if (!mask[seed]) return null;
            fill(seed);
            best = label;
        } else {
            for (let i = 0; i < n; i++) {
                if (!mask[i] || labels[i]) continue;
                const size = fill(i);
                if (size > bestSize) { bestSize = size; best = label; }
            }
            if (!best) return null;
        }
        const out = new Uint8Array(n);
        for (let i = 0; i < n; i++) out[i] = labels[i] === best ? 1 : 0;
        return out;
    }

    // Every 4-connected component, largest first, each as its own mask.
    function components(mask, w, h, minSize = 1) {
        const n = w * h;
        const labels = new Int32Array(n);
        const sizes = [0];
        const stack = [];
        let label = 0;
        for (let i = 0; i < n; i++) {
            if (!mask[i] || labels[i]) continue;
            label++;
            let size = 0;
            labels[i] = label;
            stack.push(i);
            while (stack.length) {
                const j = stack.pop();
                size++;
                const x = j % w;
                if (x > 0 && mask[j - 1] && !labels[j - 1]) { labels[j - 1] = label; stack.push(j - 1); }
                if (x < w - 1 && mask[j + 1] && !labels[j + 1]) { labels[j + 1] = label; stack.push(j + 1); }
                if (j >= w && mask[j - w] && !labels[j - w]) { labels[j - w] = label; stack.push(j - w); }
                if (j < n - w && mask[j + w] && !labels[j + w]) { labels[j + w] = label; stack.push(j + w); }
            }
            sizes.push(size);
        }
        const out = [];
        for (let l = 1; l <= label; l++) {
            if (sizes[l] < minSize) continue;
            const m = new Uint8Array(n);
            for (let i = 0; i < n; i++) if (labels[i] === l) m[i] = 1;
            out.push({ mask: m, size: sizes[l] });
        }
        return out.sort((a, b) => b.size - a.size);
    }

    // ---- Outline tracing ----------------------------------------------------------------

    // Outer boundary of a single-component mask, walking pixel edges with the
    // region on the right; returns corner points (pixel units).
    function traceOuter(mask, w, h) {
        let start = -1;
        for (let i = 0; i < w * h; i++) if (mask[i]) { start = i; break; }
        if (start < 0) return [];
        const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
        const sx = start % w, sy = (start - sx) / w;
        const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
        const ahead = (cx, cy, d, right) => {
            switch (d) {
                case 0: return right ? [cx, cy] : [cx, cy - 1];
                case 1: return right ? [cx - 1, cy] : [cx, cy];
                case 2: return right ? [cx - 1, cy - 1] : [cx - 1, cy];
                default: return right ? [cx, cy - 1] : [cx - 1, cy - 1];
            }
        };
        let x = sx, y = sy, dir = 0;
        const pts = [{ x, y }];
        const limit = 4 * (w + 1) * (h + 1);
        for (let k = 0; k < limit; k++) {
            if (inside(...ahead(x, y, dir, false))) dir = (dir + 3) % 4;
            else if (!inside(...ahead(x, y, dir, true))) dir = (dir + 1) % 4;
            x += DX[dir];
            y += DY[dir];
            if (x === sx && y === sy) break;
            pts.push({ x, y });
        }
        // Midpoints of every unit step turn 1-pixel staircases into diagonals
        // while moving true corners by only half a pixel. (Averaging after
        // merging straight runs would cut whole corners off.) Callers simplify.
        return pts.map((p, i) => {
            const q = pts[(i + 1) % pts.length];
            return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        });
    }

    // ---- Distance transform (Felzenszwalb & Huttenlocher, squared Euclidean) ----

    function edt1d(f, n, d, v, z) {
        let k = 0;
        v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
        for (let q = 1; q < n; q++) {
            let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            while (s <= z[k]) {
                k--;
                s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            }
            k++;
            v[k] = q; z[k] = s; z[k + 1] = Infinity;
        }
        k = 0;
        for (let q = 0; q < n; q++) {
            while (z[k + 1] < q) k++;
            d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
        }
    }

    // Squared distance from every pixel to the nearest pixel where mask == 1.
    function distanceTo(mask, w, h) {
        const INF = 1e20;
        const out = new Float64Array(w * h);
        for (let i = 0; i < w * h; i++) out[i] = mask[i] ? 0 : INF;
        const m = Math.max(w, h);
        const f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) f[y] = out[y * w + x];
            edt1d(f, h, d, v, z);
            for (let y = 0; y < h; y++) out[y * w + x] = d[y];
        }
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) f[x] = out[y * w + x];
            edt1d(f, w, d, v, z);
            for (let x = 0; x < w; x++) out[y * w + x] = d[x];
        }
        return out;
    }

    // Grow (r > 0) or shrink (r < 0) a mask by r pixels.
    function offsetMask(mask, w, h, r) {
        const out = new Uint8Array(w * h);
        if (r >= 0) {
            const d = distanceTo(mask, w, h);
            const r2 = r * r;
            for (let i = 0; i < w * h; i++) out[i] = d[i] <= r2 ? 1 : 0;
        } else {
            const inv = new Uint8Array(w * h);
            for (let i = 0; i < w * h; i++) inv[i] = mask[i] ? 0 : 1;
            // pixels outside the canvas count as background too
            const d = distanceTo(inv, w, h);
            const r2 = r * r;
            for (let i = 0; i < w * h; i++) {
                const x = i % w, y = (i - x) / w;
                const edge = Math.min(x + 1, y + 1, w - x, h - y);
                out[i] = mask[i] && d[i] > r2 && edge > -r ? 1 : 0;
            }
        }
        return out;
    }

    // Draw with a canvas callback into a w × h mask (1 where anything was painted).
    function rasterize(w, h, draw) {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        draw(ctx);
        const data = ctx.getImageData(0, 0, w, h).data;
        const mask = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) mask[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
        return mask;
    }

    return { foregroundMask, objectMask, component, components, traceOuter, distanceTo, offsetMask, rasterize, borderColor };
})();

if (typeof module !== 'undefined') module.exports = Raster;
