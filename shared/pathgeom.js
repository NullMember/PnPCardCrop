// Path geometry for the vector editor (canonical copy in the hub's shared/).
// No DOM access.
//
// A path is { nodes, closed } in some coordinate frame (mm). Each node is
// { x, y, hi?, ho?, smooth? } where hi / ho are the absolute positions of the
// incoming / outgoing Bézier handles (absent = straight segment on that side).

const PathGeom = (() => {
    const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

    // Segments as cubic control points [p0, c1, c2, p3]; straight sides use the endpoints.
    function segments(path) {
        const { nodes, closed } = path;
        const out = [];
        const n = nodes.length;
        const count = closed ? n : n - 1;
        for (let i = 0; i < count; i++) {
            const a = nodes[i], b = nodes[(i + 1) % n];
            out.push([a, a.ho || a, b.hi || b, b]);
        }
        return out;
    }

    function isStraight(seg) {
        return seg[1] === seg[0] && seg[2] === seg[3];
    }

    function cubicAt([p0, p1, p2, p3], t) {
        const u = 1 - t;
        return {
            x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
            y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
        };
    }

    // de Casteljau split at t -> [left, right] control points
    function splitCubic([p0, p1, p2, p3], t) {
        const a = lerp(p0, p1, t), b = lerp(p1, p2, t), c = lerp(p2, p3, t);
        const d = lerp(a, b, t), e = lerp(b, c, t);
        const m = lerp(d, e, t);
        return [[p0, a, d, m], [m, e, c, p3]];
    }

    // Polyline approximation (closed paths repeat nothing; caller closes).
    function flatten(path, stepsPerCurve = 24) {
        const pts = [];
        const segs = segments(path);
        if (!segs.length) return path.nodes.map((n) => ({ x: n.x, y: n.y }));
        segs.forEach((seg, i) => {
            if (i === 0) pts.push({ x: seg[0].x, y: seg[0].y });
            if (isStraight(seg)) {
                pts.push({ x: seg[3].x, y: seg[3].y });
            } else {
                for (let k = 1; k <= stepsPerCurve; k++) pts.push(cubicAt(seg, k / stepsPerCurve));
            }
        });
        if (path.closed && pts.length > 1) pts.pop(); // last point == first
        return pts;
    }

    function bounds(points) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        points.forEach((p) => {
            if (p.x < x0) x0 = p.x;
            if (p.y < y0) y0 = p.y;
            if (p.x > x1) x1 = p.x;
            if (p.y > y1) y1 = p.y;
        });
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }

    function toD(path, fmt = (v) => +v.toFixed(4)) {
        const { nodes } = path;
        if (!nodes.length) return '';
        let d = `M${fmt(nodes[0].x)} ${fmt(nodes[0].y)}`;
        segments(path).forEach((seg) => {
            if (isStraight(seg)) d += ` L${fmt(seg[3].x)} ${fmt(seg[3].y)}`;
            else d += ` C${fmt(seg[1].x)} ${fmt(seg[1].y)} ${fmt(seg[2].x)} ${fmt(seg[2].y)} ${fmt(seg[3].x)} ${fmt(seg[3].y)}`;
        });
        if (path.closed) d += ' Z';
        return d;
    }

    // Nearest point on the path: { seg, t, point, dist }
    function nearest(path, p) {
        let best = { seg: -1, t: 0, point: null, dist: Infinity };
        segments(path).forEach((seg, i) => {
            const steps = isStraight(seg) ? 1 : 40;
            if (isStraight(seg)) {
                const a = seg[0], b = seg[3];
                const dx = b.x - a.x, dy = b.y - a.y;
                const len2 = dx * dx + dy * dy || 1e-12;
                const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
                const q = { x: a.x + dx * t, y: a.y + dy * t };
                const d = Math.hypot(q.x - p.x, q.y - p.y);
                if (d < best.dist) best = { seg: i, t, point: q, dist: d };
                return;
            }
            let bt = 0, bd = Infinity;
            for (let k = 0; k <= steps; k++) {
                const q = cubicAt(seg, k / steps);
                const d = Math.hypot(q.x - p.x, q.y - p.y);
                if (d < bd) { bd = d; bt = k / steps; }
            }
            // refine
            let lo = Math.max(0, bt - 1 / steps), hi = Math.min(1, bt + 1 / steps);
            for (let it = 0; it < 20; it++) {
                const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
                const d1 = Math.hypot(cubicAt(seg, m1).x - p.x, cubicAt(seg, m1).y - p.y);
                const d2 = Math.hypot(cubicAt(seg, m2).x - p.x, cubicAt(seg, m2).y - p.y);
                if (d1 < d2) hi = m2; else lo = m1;
            }
            const t = (lo + hi) / 2;
            const q = cubicAt(seg, t);
            const d = Math.hypot(q.x - p.x, q.y - p.y);
            if (d < best.dist) best = { seg: i, t, point: q, dist: d };
        });
        return best;
    }

    // Insert a node on segment `segIndex` at parameter t, keeping the curve shape.
    function insertNode(path, segIndex, t) {
        const nodes = path.nodes.map((n) => ({ ...n }));
        const n = nodes.length;
        const a = nodes[segIndex], b = nodes[(segIndex + 1) % n];
        const seg = [a, a.ho || a, b.hi || b, b];
        let node;
        if (!a.ho && !b.hi) {
            node = lerp(a, b, t);
        } else {
            const [l, r] = splitCubic(seg, t);
            if (a.ho) a.ho = l[1];
            node = { x: l[3].x, y: l[3].y, hi: l[2], ho: r[1], smooth: true };
            if (b.hi) b.hi = r[2];
        }
        nodes.splice(segIndex + 1, 0, node);
        return { nodes, closed: path.closed, index: segIndex + 1 };
    }

    // Catmull-Rom style handles through the nodes (tension 1/6 of neighbour span).
    // Catmull-Rom tangents (k × the neighbour span), but each handle no longer
    // than k × 2 of its own side: where a long edge meets a short one, the
    // short side's handle would otherwise overshoot it and spike the curve.
    function smoothHandles(nodes, closed, k = 1 / 6) {
        const n = nodes.length;
        return nodes.map((p, i) => {
            const prev = nodes[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
            const next = nodes[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
            const tx = (next.x - prev.x) * k, ty = (next.y - prev.y) * k;
            const t = Math.hypot(tx, ty) || 1;
            const along = (side) => Math.min(1, (2 * k * Math.hypot(side.x - p.x, side.y - p.y)) / t);
            const out = { x: p.x, y: p.y, smooth: true };
            if (closed || i > 0) { const f = along(prev); out.hi = { x: p.x - tx * f, y: p.y - ty * f }; }
            if (closed || i < n - 1) { const f = along(next); out.ho = { x: p.x + tx * f, y: p.y + ty * f }; }
            return out;
        });
    }

    // Handles for a node made smooth: along the neighbour direction, 1/3 of each side's length.
    function makeSmooth(nodes, i, closed) {
        const n = nodes.length;
        const p = nodes[i];
        const prev = closed || i > 0 ? nodes[(i - 1 + n) % n] : null;
        const next = closed || i < n - 1 ? nodes[(i + 1) % n] : null;
        const dir = { x: (next || p).x - (prev || p).x, y: (next || p).y - (prev || p).y };
        const len = Math.hypot(dir.x, dir.y) || 1;
        const ux = dir.x / len, uy = dir.y / len;
        const out = { ...p, smooth: true };
        if (prev) {
            const l = Math.hypot(p.x - prev.x, p.y - prev.y) / 3;
            out.hi = { x: p.x - ux * l, y: p.y - uy * l };
        }
        if (next) {
            const l = Math.hypot(next.x - p.x, next.y - p.y) / 3;
            out.ho = { x: p.x + ux * l, y: p.y + uy * l };
        }
        return out;
    }

    // Douglas–Peucker simplification of a point list (closed or open).
    function simplify(points, tol, closed) {
        if (points.length < 4) return points.slice();
        const dp = (list) => {
            if (list.length < 3) return list;
            const a = list[0], b = list[list.length - 1];
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            let maxD = -1, idx = 0;
            for (let i = 1; i < list.length - 1; i++) {
                const p = list[i];
                const d = len < 1e-9 ? Math.hypot(p.x - a.x, p.y - a.y)
                    : Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) / len;
                if (d > maxD) { maxD = d; idx = i; }
            }
            if (maxD <= tol) return [a, b];
            return dp(list.slice(0, idx + 1)).slice(0, -1).concat(dp(list.slice(idx)));
        };
        if (!closed) return dp(points);
        let far = 0, farD = -1;
        points.forEach((p, i) => {
            const d = Math.hypot(p.x - points[0].x, p.y - points[0].y);
            if (d > farD) { farD = d; far = i; }
        });
        const first = dp(points.slice(0, far + 1));
        const second = dp(points.slice(far).concat([points[0]]));
        return first.slice(0, -1).concat(second.slice(0, -1));
    }

    // Turn a dense point list (freehand, traced outline) into a tidy path:
    // simplify, then give nodes smooth handles except at sharp corners.
    function fitPath(points, closed, tolerance = 0.3, cornerDeg = 50) {
        const pts = simplify(points, tolerance, closed);
        if (pts.length < 2) return { nodes: pts.map((p) => ({ x: p.x, y: p.y })), closed };
        const smooth = smoothHandles(pts, closed);
        const n = pts.length;
        const nodes = smooth.map((node, i) => {
            const prev = closed || i > 0 ? pts[(i - 1 + n) % n] : null;
            const next = closed || i < n - 1 ? pts[(i + 1) % n] : null;
            if (!prev || !next) return node;
            const a1 = Math.atan2(pts[i].y - prev.y, pts[i].x - prev.x);
            const a2 = Math.atan2(next.y - pts[i].y, next.x - pts[i].x);
            let turn = Math.abs(a2 - a1) * 180 / Math.PI;
            if (turn > 180) turn = 360 - turn;
            if (turn > cornerDeg) return { x: node.x, y: node.y }; // sharp corner
            return node;
        });
        return { nodes, closed };
    }

    // Map every point of a path (nodes and handles) through fn.
    function mapPath(path, fn) {
        return {
            closed: path.closed,
            nodes: path.nodes.map((n) => {
                const out = { ...fn(n) };
                if (n.hi) out.hi = fn(n.hi);
                if (n.ho) out.ho = fn(n.ho);
                if (n.smooth) out.smooth = true;
                return out;
            }),
        };
    }

    // ---- SVG path data parser -> [{ nodes, closed }] (absolute coordinates) ----

    function arcToCubics(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
        // SVG implementation notes F.6 (endpoint -> centre), split into ≤90° cubics.
        if (rx === 0 || ry === 0) return [[{ x: x1, y: y1 }, { x: x1, y: y1 }, { x: x2, y: y2 }, { x: x2, y: y2 }]];
        const phi = (phiDeg * Math.PI) / 180;
        const cos = Math.cos(phi), sin = Math.sin(phi);
        const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
        const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
        rx = Math.abs(rx); ry = Math.abs(ry);
        const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
        if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
        const sign = fa === fs ? -1 : 1;
        const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
        const coef = sign * Math.sqrt(Math.max(0, num / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
        const cxp = (coef * rx * y1p) / ry, cyp = (-coef * ry * x1p) / rx;
        const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
        const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
        const ang = (ux, uy, vx, vy) => {
            const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
            return a;
        };
        let t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
        let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
        if (!fs && dt > 0) dt -= 2 * Math.PI;
        if (fs && dt < 0) dt += 2 * Math.PI;
        const parts = Math.ceil(Math.abs(dt) / (Math.PI / 2));
        const step = dt / parts;
        const k = (4 / 3) * Math.tan(step / 4);
        const pt = (t) => ({
            x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
            y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
        });
        const deriv = (t) => ({
            x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
            y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos,
        });
        const out = [];
        for (let i = 0; i < parts; i++) {
            const a = t1 + i * step, b = a + step;
            const p0 = pt(a), p3 = pt(b), d0 = deriv(a), d3 = deriv(b);
            out.push([p0, { x: p0.x + k * d0.x, y: p0.y + k * d0.y }, { x: p3.x - k * d3.x, y: p3.y - k * d3.y }, p3]);
        }
        return out;
    }

    function parseD(d) {
        const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
        const paths = [];
        let cur = null;
        let x = 0, y = 0, sx = 0, sy = 0;
        let lastC = null, lastQ = null, cmd = null;
        let i = 0;
        const num = () => parseFloat(tokens[i++]);
        const start = (px, py) => {
            if (cur && cur.nodes.length) paths.push(cur);
            cur = { nodes: [{ x: px, y: py }], closed: false };
            sx = px; sy = py;
        };
        const lineTo = (px, py) => { cur.nodes.push({ x: px, y: py }); };
        const cubicTo = (c1, c2, p) => {
            const last = cur.nodes[cur.nodes.length - 1];
            last.ho = c1;
            cur.nodes.push({ x: p.x, y: p.y, hi: c2 });
        };
        while (i < tokens.length) {
            if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
            else if (cmd === null) break;
            const rel = cmd === cmd.toLowerCase();
            const C = cmd.toUpperCase();
            const ox = rel ? x : 0, oy = rel ? y : 0;
            if (C === 'Z') {
                if (cur) {
                    const first = cur.nodes[0], last = cur.nodes[cur.nodes.length - 1];
                    if (cur.nodes.length > 1 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) {
                        // merge the closing duplicate, keeping its incoming handle
                        if (last.hi) first.hi = last.hi;
                        cur.nodes.pop();
                    }
                    cur.closed = true;
                    paths.push(cur);
                    cur = { nodes: [], closed: false };
                }
                x = sx; y = sy; lastC = lastQ = null;
                cmd = null;
                continue;
            }
            if (C === 'M') {
                x = ox + num(); y = oy + num();
                start(x, y);
                cmd = rel ? 'l' : 'L';
                lastC = lastQ = null;
                continue;
            }
            if (!cur || !cur.nodes.length) start(x, y);
            if (C === 'L') { x = ox + num(); y = oy + num(); lineTo(x, y); lastC = lastQ = null; }
            else if (C === 'H') { x = ox + num(); lineTo(x, y); lastC = lastQ = null; }
            else if (C === 'V') { y = oy + num(); lineTo(x, y); lastC = lastQ = null; }
            else if (C === 'C') {
                const c1 = { x: ox + num(), y: oy + num() }, c2 = { x: ox + num(), y: oy + num() };
                x = ox + num(); y = oy + num();
                cubicTo(c1, c2, { x, y }); lastC = c2; lastQ = null;
            } else if (C === 'S') {
                const c1 = lastC ? { x: 2 * x - lastC.x, y: 2 * y - lastC.y } : { x, y };
                const c2 = { x: ox + num(), y: oy + num() };
                x = ox + num(); y = oy + num();
                cubicTo(c1, c2, { x, y }); lastC = c2; lastQ = null;
            } else if (C === 'Q' || C === 'T') {
                const q = C === 'Q' ? { x: ox + num(), y: oy + num() } : (lastQ ? { x: 2 * x - lastQ.x, y: 2 * y - lastQ.y } : { x, y });
                const nx = ox + num(), ny = oy + num();
                cubicTo({ x: x + (2 / 3) * (q.x - x), y: y + (2 / 3) * (q.y - y) }, { x: nx + (2 / 3) * (q.x - nx), y: ny + (2 / 3) * (q.y - ny) }, { x: nx, y: ny });
                x = nx; y = ny; lastQ = q; lastC = null;
            } else if (C === 'A') {
                const rx = num(), ry = num(), rot = num(), fa = num(), fs = num();
                const nx = ox + num(), ny = oy + num();
                arcToCubics(x, y, rx, ry, rot, fa, fs, nx, ny).forEach((c) => cubicTo(c[1], c[2], c[3]));
                x = nx; y = ny; lastC = lastQ = null;
            } else {
                i++; // unknown command: skip a number
            }
        }
        if (cur && cur.nodes.length > 1) paths.push(cur);
        return paths.filter((p) => p.nodes.length > 1 || p.closed);
    }

    // ---- Editor shapes -> paths ----

    const KAPPA = 0.5522847498;

    // A card-editor shape's outline as nodes in fractions of its box
    // ({ fx, fy, hi?, ho? }), or null for types that aren't drawn as a path.
    function shapeNodes(shape) {
        if (shape.type === 'path') return { nodes: shape.nodes, closed: !!shape.closed };
        if (shape.type === 'polygon') return { nodes: shape.points.map((p) => ({ fx: p.fx, fy: p.fy })), closed: true };
        if (shape.type === 'ellipse') {
            const k = KAPPA * 0.5;
            return {
                closed: true,
                nodes: [
                    { fx: 0.5, fy: 0, hi: { fx: 0.5 - k, fy: 0 }, ho: { fx: 0.5 + k, fy: 0 }, smooth: true },
                    { fx: 1, fy: 0.5, hi: { fx: 1, fy: 0.5 - k }, ho: { fx: 1, fy: 0.5 + k }, smooth: true },
                    { fx: 0.5, fy: 1, hi: { fx: 0.5 + k, fy: 1 }, ho: { fx: 0.5 - k, fy: 1 }, smooth: true },
                    { fx: 0, fy: 0.5, hi: { fx: 0, fy: 0.5 + k }, ho: { fx: 0, fy: 0.5 - k }, smooth: true },
                ],
            };
        }
        if (shape.type === 'rect') {
            const r = Math.max(0, Math.min(shape.radius || 0, shape.w / 2, shape.h / 2));
            if (r <= 0) return { closed: true, nodes: [{ fx: 0, fy: 0 }, { fx: 1, fy: 0 }, { fx: 1, fy: 1 }, { fx: 0, fy: 1 }] };
            const rx = r / shape.w, ry = r / shape.h, kx = rx * KAPPA, ky = ry * KAPPA;
            return {
                closed: true,
                nodes: [
                    { fx: rx, fy: 0, hi: { fx: rx - kx, fy: 0 } }, { fx: 1 - rx, fy: 0, ho: { fx: 1 - rx + kx, fy: 0 } },
                    { fx: 1, fy: ry, hi: { fx: 1, fy: ry - ky } }, { fx: 1, fy: 1 - ry, ho: { fx: 1, fy: 1 - ry + ky } },
                    { fx: 1 - rx, fy: 1, hi: { fx: 1 - rx + kx, fy: 1 } }, { fx: rx, fy: 1, ho: { fx: rx - kx, fy: 1 } },
                    { fx: 0, fy: 1 - ry, hi: { fx: 0, fy: 1 - ry + ky } }, { fx: 0, fy: ry, ho: { fx: 0, fy: ry - ky } },
                ],
            };
        }
        if (shape.type === 'line') {
            return { closed: false, nodes: shape.diag === 'tlbr' ? [{ fx: 0, fy: 0 }, { fx: 1, fy: 1 }] : [{ fx: 1, fy: 0 }, { fx: 0, fy: 1 }] };
        }
        return null;
    }

    // A shape as a path in card coordinates with its position and rotation
    // baked in. SVG cut files use this instead of transform attributes, which
    // Cricut Design Space mis-scales (72/25.4 against untransformed elements).
    function shapePath(shape) {
        const sn = shapeNodes(shape);
        if (!sn) return null;
        const r = ((shape.rotation || 0) * Math.PI) / 180;
        const cos = Math.cos(r), sin = Math.sin(r);
        const cx = shape.x + shape.w / 2, cy = shape.y + shape.h / 2;
        const f = (p) => {
            const lx = (p.fx - 0.5) * shape.w, ly = (p.fy - 0.5) * shape.h;
            return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
        };
        return {
            closed: sn.closed,
            nodes: sn.nodes.map((n) => {
                const o = f(n);
                if (n.hi) o.hi = f(n.hi);
                if (n.ho) o.ho = f(n.ho);
                return o;
            }),
        };
    }

    return {
        segments, cubicAt, splitCubic, flatten, bounds, toD, nearest, insertNode,
        smoothHandles, makeSmooth, simplify, fitPath, mapPath, parseD, arcToCubics,
        shapeNodes, shapePath,
    };
})();

if (typeof module !== 'undefined') module.exports = PathGeom;
