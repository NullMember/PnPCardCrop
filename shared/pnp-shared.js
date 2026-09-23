// PnPTools shared runtime — canonical copy lives in the hub's shared/ folder
// and is copied verbatim into every tool by scripts/sync-shared.sh, so each
// tool keeps working when deployed on its own. Do not edit the per-tool copies.
//
// Exposes a single global, PnP, with:
//   PnP.init({ tool, ... })       top bar (hub + tool links, mm/in toggle, project buttons)
//   PnP.settings                   auto-persisted sidebar settings (localStorage)
//   PnP.units                      mm / inch display layer for inputs marked data-unit="mm"
//   PnP.presets / bindPreset()     shared card and paper size presets
//   PnP.handoff                    pass image sets between tools (IndexedDB)
//   PnP.sendMenu() / importButton()
//   PnP.project                    .pnp project files (zip: manifest.json + files/)
//   PnP.guard()                    warn before leaving with unsaved work
//   PnP.dropzone()                 drag & drop + click-to-browse file zone
//   PnP.zip                        tiny dependency-free zip writer/reader

(() => {
    'use strict';

    const MM_PER_IN = 25.4;
    const HUB_URL = 'https://nullmember.github.io/PnPTools/';

    const TOOLS = [
        { id: 'PnPCardCrop', name: 'CardCrop', icon: '✂️', path: 'PnPCardCrop/index.html' },
        { id: 'PnPAlign', name: 'Align', icon: '🎯', path: 'PnPAlign/index.html' },
        { id: 'PnPBleed', name: 'Bleed', icon: '🩸', path: 'PnPBleed/index.html' },
        { id: 'PnPLayout', name: 'Layout', icon: '🗂️', path: 'PnPLayout/index.html' },
        { id: 'PnPBooklet', name: 'Booklet', icon: '📖', path: 'PnPBooklet/index.html' },
        { id: 'PnPCut', name: 'Cut', icon: '✒️', path: 'PnPCut/index.html' },
        { id: 'PnPTuckBox', name: 'TuckBox', icon: '📦', path: 'PnPTuckBox/index.html' },
    ];

    // ---------------------------------------------------------------- utils

    function storageGet(key, fallback = null) {
        try {
            const raw = localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (e) {
            return fallback;
        }
    }

    function storageSet(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            // Private mode / quota — settings just won't persist.
        }
    }

    function storageRemove(key) {
        try {
            localStorage.removeItem(key);
        } catch (e) { /* ignore */ }
    }

    function h(tag, attrs = {}, ...children) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (v === undefined || v === null || v === false) continue;
            if (k === 'class') node.className = v;
            else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
            else node.setAttribute(k, v === true ? '' : v);
        }
        for (const child of children.flat()) {
            if (child === null || child === undefined || child === false) continue;
            node.append(child instanceof Node ? child : String(child));
        }
        return node;
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = h('a', { href: url, download: filename });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    function timeAgo(ts) {
        const s = Math.round((Date.now() - ts) / 1000);
        if (s < 60) return 'just now';
        if (s < 3600) return `${Math.round(s / 60)} min ago`;
        if (s < 86400) return `${Math.round(s / 3600)} h ago`;
        return new Date(ts).toLocaleDateString();
    }

    function toast(message, type = 'info') {
        let host = document.querySelector('.pnp-toasts');
        if (!host) {
            host = h('div', { class: 'pnp-toasts', role: 'status', 'aria-live': 'polite' });
            document.body.appendChild(host);
        }
        const node = h('div', { class: `pnp-toast ${type}` }, message);
        host.appendChild(node);
        setTimeout(() => node.classList.add('leaving'), 3500);
        setTimeout(() => node.remove(), 4000);
    }

    // True when served as a standalone per-tool GitHub Pages site, where "../"
    // is not the hub.
    function isStandaloneDeploy() {
        return location.hostname.endsWith('github.io') && !/^\/PnPTools\//i.test(location.pathname);
    }

    // Relative URL from the current tool page to another tool (or the hub).
    // Tools live one folder below the hub, and standalone deploys sit side by
    // side on the same origin, so "../<Tool>/" works in both layouts.
    function toolUrl(tool) {
        return `../${tool.path}`;
    }

    function hubUrl() {
        return isStandaloneDeploy() ? HUB_URL : '../index.html';
    }

    // The unit layer overrides .value on mm inputs; nativeValue reads the raw
    // stored millimetres regardless.
    const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

    // Set a field's value (keeping any unit proxy in sync) and notify
    // listeners like a user edit would.
    function setFieldValue(el, value, events = ['input', 'change']) {
        if (el.type === 'checkbox' || el.type === 'radio') {
            el.checked = !!value;
        } else {
            el.value = value;
        }
        events.forEach((type) => el.dispatchEvent(new Event(type, { bubbles: true })));
    }

    // ---------------------------------------------------------------- zip

    const zip = (() => {
        const CRC_TABLE = new Uint32Array(256).map((_, n) => {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            return c >>> 0;
        });

        function crc32(bytes) {
            let crc = 0xffffffff;
            for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
            return (crc ^ 0xffffffff) >>> 0;
        }

        // entries: [{ name, data: Uint8Array | Blob | string }] -> Blob (STORE, no compression)
        async function create(entries) {
            const enc = new TextEncoder();
            const parts = [];
            const central = [];
            let offset = 0;
            for (const entry of entries) {
                let data = entry.data;
                if (typeof data === 'string') data = enc.encode(data);
                else if (data instanceof Blob) data = new Uint8Array(await data.arrayBuffer());
                const name = enc.encode(entry.name);
                const crc = crc32(data);

                const local = new DataView(new ArrayBuffer(30));
                local.setUint32(0, 0x04034b50, true);
                local.setUint16(4, 20, true);
                local.setUint16(6, 0x0800, true); // UTF-8 names
                local.setUint32(14, crc, true);
                local.setUint32(18, data.length, true);
                local.setUint32(22, data.length, true);
                local.setUint16(26, name.length, true);
                parts.push(local, name, data);

                const cen = new DataView(new ArrayBuffer(46));
                cen.setUint32(0, 0x02014b50, true);
                cen.setUint16(4, 20, true);
                cen.setUint16(6, 20, true);
                cen.setUint16(8, 0x0800, true);
                cen.setUint32(16, crc, true);
                cen.setUint32(20, data.length, true);
                cen.setUint32(24, data.length, true);
                cen.setUint16(28, name.length, true);
                cen.setUint32(42, offset, true);
                central.push(cen, name);

                offset += 30 + name.length + data.length;
            }
            const centralSize = central.reduce((n, p) => n + p.byteLength, 0);
            const end = new DataView(new ArrayBuffer(22));
            end.setUint32(0, 0x06054b50, true);
            end.setUint16(8, entries.length, true);
            end.setUint16(10, entries.length, true);
            end.setUint32(12, centralSize, true);
            end.setUint32(16, offset, true);
            return new Blob([...parts, ...central, end], { type: 'application/zip' });
        }

        async function inflateRaw(bytes) {
            if (typeof DecompressionStream === 'undefined') {
                throw new Error('This browser cannot read compressed zip files.');
            }
            const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            return new Uint8Array(await new Response(stream).arrayBuffer());
        }

        // Blob -> Map(name -> Uint8Array). Supports STORE and DEFLATE entries.
        async function read(blob) {
            const buf = new Uint8Array(await blob.arrayBuffer());
            const view = new DataView(buf.buffer);
            let eocd = -1;
            for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
                if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
            }
            if (eocd < 0) throw new Error('Not a valid project file.');
            const count = view.getUint16(eocd + 10, true);
            let p = view.getUint32(eocd + 16, true);
            const dec = new TextDecoder();
            const files = new Map();
            for (let i = 0; i < count; i++) {
                if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt project file.');
                const method = view.getUint16(p + 10, true);
                const compSize = view.getUint32(p + 20, true);
                const nameLen = view.getUint16(p + 28, true);
                const extraLen = view.getUint16(p + 30, true);
                const commentLen = view.getUint16(p + 32, true);
                const localOffset = view.getUint32(p + 42, true);
                const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
                p += 46 + nameLen + extraLen + commentLen;

                const lNameLen = view.getUint16(localOffset + 26, true);
                const lExtraLen = view.getUint16(localOffset + 28, true);
                const start = localOffset + 30 + lNameLen + lExtraLen;
                const raw = buf.subarray(start, start + compSize);
                if (name.endsWith('/')) continue;
                if (method === 0) files.set(name, raw.slice());
                else if (method === 8) files.set(name, await inflateRaw(raw));
                else throw new Error(`Unsupported zip compression in ${name}.`);
            }
            return files;
        }

        return { create, read, crc32 };
    })();

    // ---------------------------------------------------------------- image DPI

    // DPI stored in a PNG (pHYs chunk) or JPEG (JFIF header); null if absent.
    async function readImageDpi(file) {
        const bytes = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
        const view = new DataView(bytes.buffer);
        if (bytes[0] === 0x89 && bytes[1] === 0x50) {
            let p = 8;
            while (p + 12 <= bytes.length) {
                const len = view.getUint32(p);
                const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
                if (type === 'pHYs' && p + 17 <= bytes.length) {
                    const ppu = view.getUint32(p + 8);
                    return bytes[p + 16] === 1 && ppu > 0 ? ppu * 0.0254 : null;
                }
                if (type === 'IDAT' || type === 'IEND') return null;
                p += 12 + len;
            }
            return null;
        }
        if (bytes[0] === 0xff && bytes[1] === 0xd8) {
            let p = 2;
            while (p + 4 < bytes.length && bytes[p] === 0xff) {
                const marker = bytes[p + 1];
                const len = view.getUint16(p + 2);
                if (marker === 0xe0 && String.fromCharCode(...bytes.subarray(p + 4, p + 9)) === 'JFIF\0') {
                    const units = bytes[p + 11];
                    const density = view.getUint16(p + 12);
                    if (!density) return null;
                    if (units === 1) return density;
                    if (units === 2) return density * 2.54;
                    return null;
                }
                p += 2 + len;
            }
        }
        return null;
    }

    // A PNG blob with its DPI recorded (a pHYs chunk after IHDR), so other
    // tools and apps know its physical size.
    async function setPngDpi(blob, dpi) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (bytes[0] !== 0x89 || bytes[1] !== 0x50) return blob;
        const ppm = Math.round(dpi / 0.0254);
        const chunk = new Uint8Array(21);
        const view = new DataView(chunk.buffer);
        view.setUint32(0, 9);
        chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
        view.setUint32(8, ppm);
        view.setUint32(12, ppm);
        chunk[16] = 1; // metre
        view.setUint32(17, zip.crc32(chunk.subarray(4, 17)));
        const ihdrEnd = 8 + 25;
        return new Blob([bytes.subarray(0, ihdrEnd), chunk, bytes.subarray(ihdrEnd)], { type: 'image/png' });
    }

    // ---------------------------------------------------------------- presets

    const presets = {
        card: [
            { id: 'poker', label: 'Poker', w: 63, h: 88 },
            { id: 'usPoker', label: 'US Poker', w: 63.5, h: 88.9 },
            { id: 'bridge', label: 'Bridge', w: 57, h: 89 },
            { id: 'euro', label: 'Standard European', w: 59, h: 92 },
            { id: 'miniAmerican', label: 'Mini American', w: 41, h: 63 },
            { id: 'miniEuropean', label: 'Mini European', w: 44, h: 68 },
            { id: 'tarot', label: 'Tarot', w: 70, h: 120 },
            { id: 'large', label: 'Large (Dixit)', w: 80, h: 120 },
            { id: 'square', label: 'Square', w: 70, h: 70 },
        ],
        paper: [
            { id: 'a4', label: 'A4', w: 210, h: 297 },
            { id: 'a4l', label: 'A4 landscape', w: 297, h: 210 },
            { id: 'letter', label: 'US Letter', w: 215.9, h: 279.4 },
            { id: 'letterl', label: 'US Letter landscape', w: 279.4, h: 215.9 },
            { id: 'a3', label: 'A3', w: 297, h: 420 },
            { id: 'a3l', label: 'A3 landscape', w: 420, h: 297 },
            { id: 'legal', label: 'US Legal', w: 215.9, h: 355.6 },
        ],
    };

    function formatSize(p) {
        if (units.current === 'in') {
            const f = (v) => +(v / MM_PER_IN).toFixed(2);
            return `${f(p.w)} × ${f(p.h)} in`;
        }
        return `${p.w} × ${p.h} mm`;
    }

    // Fill `select` with presets and keep it in sync with the two mm inputs:
    // choosing a preset writes the inputs; editing an input selects the
    // matching preset (or "Custom").
    function bindPreset(select, wInput, hInput, list) {
        if (typeof list === 'string') list = presets[list];
        const render = () => {
            const current = select.value;
            select.innerHTML = '';
            list.forEach((p) => select.append(h('option', { value: p.id }, `${p.label} (${formatSize(p)})`)));
            select.append(h('option', { value: 'custom' }, 'Custom'));
            if (current) select.value = current;
        };
        const syncFromInputs = () => {
            const w = parseFloat(nativeValue.get.call(wInput));
            const hh = parseFloat(nativeValue.get.call(hInput));
            const match = list.find((p) => Math.abs(p.w - w) < 0.05 && Math.abs(p.h - hh) < 0.05);
            select.value = match ? match.id : 'custom';
        };
        render();
        syncFromInputs();
        select.addEventListener('change', () => {
            const p = list.find((x) => x.id === select.value);
            if (!p) return;
            setFieldValue(wInput, p.w);
            setFieldValue(hInput, p.h);
        });
        [wInput, hInput].forEach((el) => el.addEventListener('input', syncFromInputs));
        units.onChange(() => { render(); syncFromInputs(); });
        settings.onApply(syncFromInputs);
        select.dataset.persist = 'false'; // derived from the inputs
        return { sync: syncFromInputs };
    }

    // ---------------------------------------------------------------- units

    // Inputs marked data-unit="mm" always hold millimetres, so tool code never
    // changes. Each one gets a visible proxy input that shows the value in the
    // user's chosen unit; the real input is hidden and kept in sync both ways.
    const units = (() => {
        const KEY = 'pnp:units';
        let current = storageGet(KEY, 'mm') === 'in' ? 'in' : 'mm';
        const listeners = [];
        const proxies = [];

        const factor = () => (current === 'in' ? MM_PER_IN : 1);
        const fmt = (mm) => {
            const v = parseFloat(mm);
            if (!Number.isFinite(v)) return '';
            return String(+(v / factor()).toFixed(current === 'in' ? 3 : 2));
        };

        function relabel(root = document.body) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            const target = current === 'in' ? '(in)' : '(mm)';
            let node;
            while ((node = walker.nextNode())) {
                if (/\((mm|in)\)/.test(node.nodeValue) && !node.parentElement.closest('option, script, style, .pnp-no-units')) {
                    node.nodeValue = node.nodeValue.replace(/\((mm|in)\)/g, target);
                }
            }
        }

        function refreshProxy(real, proxy) {
            proxy.value = fmt(nativeValue.get.call(real));
            const step = parseFloat(real.getAttribute('step'));
            proxy.step = current === 'in' ? 'any' : (real.getAttribute('step') || 'any');
            ['min', 'max'].forEach((attr) => {
                const v = parseFloat(real.getAttribute(attr));
                if (Number.isFinite(v)) proxy.setAttribute(attr, +(v / factor()).toFixed(4));
                else proxy.removeAttribute(attr);
            });
            if (!Number.isFinite(step)) proxy.step = 'any';
        }

        function attach(real) {
            if (real.dataset.unitBound) return;
            real.dataset.unitBound = '1';
            const proxy = real.cloneNode(false);
            proxy.removeAttribute('id');
            proxy.removeAttribute('name');
            proxy.removeAttribute('required');
            proxy.removeAttribute('data-unit');
            proxy.removeAttribute('data-unit-bound');
            proxy.classList.add('pnp-unit-proxy');
            proxy.id = real.id ? `${real.id}__display` : '';
            real.after(proxy);
            real.hidden = true;
            real.classList.add('pnp-unit-real');

            const label = real.id && document.querySelector(`label[for="${CSS.escape(real.id)}"]`);
            if (label && proxy.id) label.htmlFor = proxy.id;

            const push = (type) => {
                const v = parseFloat(proxy.value);
                if (!Number.isFinite(v)) return;
                nativeValue.set.call(real, +(v * factor()).toFixed(4));
                real.dispatchEvent(new Event(type, { bubbles: true }));
            };
            proxy.addEventListener('input', (e) => { e.stopPropagation(); push('input'); });
            proxy.addEventListener('change', (e) => { e.stopPropagation(); push('change'); });

            // Tool code that writes real.value (presets, auto-fit, …) updates the proxy.
            Object.defineProperty(real, 'value', {
                configurable: true,
                get() { return nativeValue.get.call(this); },
                set(v) {
                    nativeValue.set.call(this, v);
                    if (document.activeElement !== proxy) proxy.value = fmt(v);
                },
            });
            new MutationObserver(() => {
                proxy.disabled = real.disabled;
                proxy.readOnly = real.readOnly;
            }).observe(real, { attributes: true, attributeFilter: ['disabled', 'readonly'] });
            proxy.disabled = real.disabled;

            proxies.push([real, proxy]);
            refreshProxy(real, proxy);
        }

        function scan(root = document) {
            root.querySelectorAll('input[data-unit="mm"]').forEach(attach);
        }

        function set(unit) {
            current = unit === 'in' ? 'in' : 'mm';
            storageSet(KEY, current);
            proxies.forEach(([real, proxy]) => refreshProxy(real, proxy));
            relabel();
            document.querySelectorAll('.pnp-units button').forEach((b) => {
                b.setAttribute('aria-pressed', String(b.dataset.unit === current));
            });
            listeners.forEach((fn) => fn(current));
        }

        function refresh() {
            proxies.forEach(([real, proxy]) => { if (document.activeElement !== proxy) proxy.value = fmt(nativeValue.get.call(real)); });
        }

        // Another tab changed the unit.
        window.addEventListener('storage', (e) => { if (e.key === KEY) set(storageGet(KEY, 'mm')); });

        return {
            get current() { return current; },
            scan,
            set,
            refresh,
            relabel,
            onChange: (fn) => listeners.push(fn),
            /** mm -> display string with unit, e.g. for info panels */
            format: (mm) => `${fmt(mm)} ${current}`,
        };
    })();

    // ---------------------------------------------------------------- theme

    // auto (follow the OS) / light / dark, shared by every tool. pnp-theme.js
    // applies it early in <head>; this module switches it at runtime.
    const theme = (() => {
        const KEY = 'pnp:theme';
        const ORDER = ['auto', 'light', 'dark'];
        const LABEL = { auto: '◐ Auto', light: '☀ Light', dark: '☾ Dark' };
        let current = storageGet(KEY, 'auto');
        if (!ORDER.includes(current)) current = 'auto';
        const buttons = [];

        function apply() {
            if (current === 'auto') document.documentElement.removeAttribute('data-theme');
            else document.documentElement.setAttribute('data-theme', current);
            buttons.forEach((b) => {
                b.textContent = LABEL[current];
                b.title = `Colour theme: ${current} (click to change)`;
                b.setAttribute('aria-label', `Colour theme: ${current}. Click to change.`);
            });
        }

        function set(value) {
            current = ORDER.includes(value) ? value : 'auto';
            storageSet(KEY, current);
            apply();
        }

        function toggleButton(container) {
            const b = h('button', {
                type: 'button',
                class: 'pnp-theme-toggle',
                onclick: () => set(ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]),
            });
            buttons.push(b);
            if (container) container.append(b);
            apply();
            return b;
        }

        window.addEventListener('storage', (e) => {
            if (e.key === KEY) { current = storageGet(KEY, 'auto'); apply(); }
        });
        apply();
        return { get current() { return current; }, set, toggleButton };
    })();

    // ---------------------------------------------------------------- settings

    // Every input/select inside the tool's settings root (default: .sidebar)
    // that has an id is saved to localStorage on edit and restored on load.
    //   data-persist="false"    never saved
    //   data-persist="project"  saved only into project files, not localStorage
    const settings = (() => {
        let key = null;
        let root = null;
        let defaults = {};
        const applyListeners = [];

        function fields(scope = 'local') {
            if (!root) return [];
            return [...root.querySelectorAll('input[id], select[id], textarea[id]')].filter((el) => {
                if (el.type === 'file' || el.type === 'button' || el.type === 'submit') return false;
                if (el.classList.contains('pnp-unit-proxy')) return false;
                const p = el.dataset.persist;
                if (p === 'false') return false;
                if (p === 'project' && scope === 'local') return false;
                return true;
            });
        }

        function read(el) {
            return el.type === 'checkbox' || el.type === 'radio' ? el.checked : (el instanceof HTMLInputElement ? nativeValue.get.call(el) : el.value);
        }

        function collect(scope = 'local') {
            const out = {};
            fields(scope).forEach((el) => { out[el.id] = read(el); });
            return out;
        }

        // Apply values in DOM order, firing the same events a user edit would,
        // so tool code (previews, dependent fields) reacts normally.
        function apply(values) {
            if (!values) return;
            fields('project').forEach((el) => {
                if (!(el.id in values)) return;
                const v = values[el.id];
                if (read(el) === v) return;
                if (el.type === 'radio' && !v) return; // the checked sibling handles it
                if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === v)) return;
                setFieldValue(el, v);
            });
            units.refresh();
            applyListeners.forEach((fn) => fn());
        }

        let saveTimer = null;
        function save() {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => storageSet(key, collect('local')), 150);
        }

        function init(tool, rootEl) {
            key = `pnp:settings:${tool}`;
            root = rootEl;
            if (!root) return;
            defaults = collect('project');
            apply(storageGet(key, null));
            root.addEventListener('input', save);
            root.addEventListener('change', save);
        }

        function reset() {
            storageRemove(key);
            apply(defaults);
            storageRemove(key);
        }

        return { init, collect, apply, reset, onApply: (fn) => applyListeners.push(fn) };
    })();

    // ---------------------------------------------------------------- guard

    const guards = [];
    function guard(hasUnsavedWork) {
        guards.push(hasUnsavedWork);
    }
    let guardBypass = false;
    window.addEventListener('beforeunload', (e) => {
        if (guardBypass) return;
        if (guards.some((fn) => { try { return fn(); } catch (err) { return false; } })) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    // ---------------------------------------------------------------- handoff

    // Image sets passed between tools live in IndexedDB (same origin for the
    // hub and every standalone tool deploy). The newest MAX_SETS are kept.
    const handoff = (() => {
        const DB = 'pnptools';
        const STORE = 'handoff';
        const MAX_SETS = 12;

        function open() {
            return new Promise((resolve, reject) => {
                const req = indexedDB.open(DB, 1);
                req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }

        async function tx(mode, fn) {
            const db = await open();
            return new Promise((resolve, reject) => {
                const t = db.transaction(STORE, mode);
                const result = fn(t.objectStore(STORE));
                t.oncomplete = () => { db.close(); resolve(result && 'result' in result ? result.result : result); };
                t.onerror = () => { db.close(); reject(t.error); };
            });
        }

        async function list() {
            const all = await tx('readonly', (s) => s.getAll());
            return (all || []).sort((a, b) => b.created - a.created);
        }

        /** items: [{ name, blob, role? }] -> id */
        async function save({ name, from, items }) {
            const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            await tx('readwrite', (s) => s.put({ id, name, from, created: Date.now(), items }));
            const all = await list();
            if (all.length > MAX_SETS) {
                await tx('readwrite', (s) => all.slice(MAX_SETS).forEach((set) => s.delete(set.id)));
            }
            return id;
        }

        const get = (id) => tx('readonly', (s) => s.get(id));
        const remove = (id) => tx('readwrite', (s) => s.delete(id));

        // If the page was opened with ?import=<id>, hand that set to onItems once.
        async function receive(onItems) {
            const params = new URLSearchParams(location.search);
            const id = params.get('import');
            if (!id) return;
            params.delete('import');
            const clean = location.pathname + (params.toString() ? `?${params}` : '') + location.hash;
            history.replaceState(null, '', clean);
            try {
                const set = await get(id);
                if (!set) {
                    toast('The images sent from the other tool are no longer available.', 'error');
                    return;
                }
                await onItems(set.items, set);
                toast(`Imported ${set.items.length} image(s) from ${set.from}.`, 'success');
            } catch (err) {
                console.error(err);
                toast(`Import failed: ${err.message}`, 'error');
            }
        }

        return { list, save, get, remove, receive };
    })();

    // Turn stored items back into File objects that tools' loaders accept.
    function itemsToFiles(items) {
        return items.map((it) => {
            const f = new File([it.blob], it.name, { type: it.blob.type || 'image/png' });
            if (it.role) f.pnpRole = it.role;
            return f;
        });
    }

    // "Send to →" buttons. getItems() returns [{ name, blob, role? }].
    function sendMenu(container, { from, targets, getItems, label = 'Send to' }) {
        const row = h('div', { class: 'pnp-send' }, h('span', { class: 'pnp-send-label' }, `${label}:`));
        const buttons = [];
        targets.forEach((id) => {
            const tool = TOOLS.find((t) => t.id === id);
            if (!tool) return;
            const btn = h('button', {
                type: 'button',
                class: 'btn-secondary btn-small',
                title: `Open ${tool.name} in a new tab with these images`,
                onclick: async () => {
                    // Open the tab synchronously so popup blockers allow it.
                    const win = window.open('', '_blank');
                    buttons.forEach((b) => (b.disabled = true));
                    try {
                        const items = await getItems();
                        if (!items || items.length === 0) throw new Error('Nothing to send yet.');
                        const id = await handoff.save({ name: `${items.length} image(s) from ${from}`, from, items });
                        const url = `${toolUrl(tool)}?import=${encodeURIComponent(id)}`;
                        if (win) win.location.href = url;
                        else location.href = url;
                    } catch (err) {
                        if (win) win.close();
                        toast(err.message, 'error');
                    } finally {
                        buttons.forEach((b) => (b.disabled = false));
                    }
                },
            }, h('span', { class: 'pnp-send-icon', 'aria-hidden': 'true' }, tool.icon), h('span', {}, tool.name));
            buttons.push(btn);
            row.append(btn);
        });
        container.append(row);
        return {
            setEnabled(on) { buttons.forEach((b) => (b.disabled = !on)); },
        };
    }

    // "Import from other tools" button + popover listing recent hand-offs.
    function importButton(container, onFiles) {
        const wrap = h('div', { class: 'pnp-import' });
        const pop = h('div', { class: 'pnp-popover', hidden: true });
        const btn = h('button', {
            type: 'button',
            class: 'btn-secondary btn-small',
            onclick: async (e) => {
                e.stopPropagation();
                if (!pop.hidden) { pop.hidden = true; return; }
                pop.innerHTML = '';
                let sets = [];
                try { sets = await handoff.list(); } catch (err) { /* IndexedDB unavailable */ }
                if (sets.length === 0) {
                    pop.append(h('div', { class: 'pnp-popover-empty' }, 'Nothing here yet — use “Send to” in another PnPTools tool.'));
                }
                sets.forEach((set) => {
                    pop.append(h('div', { class: 'pnp-popover-row' },
                        h('button', {
                            type: 'button',
                            class: 'pnp-popover-item',
                            onclick: async () => {
                                pop.hidden = true;
                                try {
                                    await onFiles(itemsToFiles(set.items), set);
                                    toast(`Imported ${set.items.length} image(s) from ${set.from}.`, 'success');
                                } catch (err) {
                                    toast(`Import failed: ${err.message}`, 'error');
                                }
                            },
                        },
                        h('strong', {}, `${set.items.length} image(s)`),
                        h('span', {}, ` from ${set.from} · ${timeAgo(set.created)}`)),
                        h('button', {
                            type: 'button',
                            class: 'pnp-popover-remove',
                            title: 'Remove from list',
                            'aria-label': 'Remove from list',
                            onclick: async (ev) => {
                                ev.stopPropagation();
                                await handoff.remove(set.id);
                                ev.target.closest('.pnp-popover-row').remove();
                            },
                        }, '✕')));
                });
                pop.hidden = false;
            },
        }, '⇩ Import from other tools');
        document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) pop.hidden = true; });
        wrap.append(btn, pop);
        container.append(wrap);
        return wrap;
    }

    // ---------------------------------------------------------------- dropzone

    function dropzone(zone, { input, onFiles, accept }) {
        const matches = (f) => !accept || accept.some((a) => (a.endsWith('/*') ? f.type.startsWith(a.slice(0, -1)) : f.type === a || f.name.toLowerCase().endsWith(a)));
        const deliver = (fileList) => {
            const files = [...fileList];
            const ok = files.filter(matches);
            if (ok.length < files.length) toast(`Skipped ${files.length - ok.length} unsupported file(s).`, 'error');
            if (ok.length) onFiles(ok);
        };
        zone.addEventListener('click', (e) => {
            if (e.target === input || e.target.closest('button, a')) return;
            input.click();
        });
        zone.setAttribute('tabindex', '0');
        zone.setAttribute('role', 'button');
        zone.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
        });
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('change', () => { deliver(input.files); input.value = ''; });
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('dragover');
            deliver(e.dataTransfer.files);
        });
    }

    // ---------------------------------------------------------------- project

    // A .pnp project is a zip: manifest.json + files/<n>-<name>. The manifest
    // holds the tool id, all settings (including data-persist="project" ones)
    // and whatever extra state the tool registers.
    const project = (() => {
        const VERSION = 1;
        let tool = null;
        let hooks = null;

        function register(h_) { hooks = h_; }

        async function save() {
            if (!hooks) return;
            const files = hooks.getFiles ? await hooks.getFiles() : [];
            const manifest = {
                app: 'PnPTools',
                version: VERSION,
                tool,
                saved: new Date().toISOString(),
                settings: settings.collect('project'),
                state: hooks.getState ? await hooks.getState() : null,
                files: [],
            };
            const entries = [];
            files.forEach((f, i) => {
                const path = `files/${String(i + 1).padStart(4, '0')}-${f.name.replace(/[\\/:*?"<>|]/g, '_')}`;
                manifest.files.push({ path, name: f.name, type: f.blob.type, role: f.role || null });
                entries.push({ name: path, data: f.blob });
            });
            entries.unshift({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) });
            const blob = await zip.create(entries);
            const stamp = new Date().toISOString().slice(0, 10);
            downloadBlob(blob, `${(hooks.fileName && hooks.fileName()) || tool}-${stamp}.pnp`);
            hooks.markSaved && hooks.markSaved();
            toast('Project saved.', 'success');
        }

        async function load(file) {
            const entries = await zip.read(file);
            const raw = entries.get('manifest.json');
            if (!raw) throw new Error('This is not a PnPTools project file.');
            const manifest = JSON.parse(new TextDecoder().decode(raw));
            if (manifest.app !== 'PnPTools') throw new Error('This is not a PnPTools project file.');
            if (manifest.tool !== tool) {
                const other = TOOLS.find((t) => t.id === manifest.tool);
                throw new Error(`This project belongs to ${other ? other.name : manifest.tool}. Open it there.`);
            }
            const files = (manifest.files || []).map((f) => {
                const file = new File([entries.get(f.path)], f.name, { type: f.type || '' });
                if (f.role) file.pnpRole = f.role;
                return file;
            });
            settings.apply(manifest.settings);
            if (hooks.setFiles) await hooks.setFiles(files, manifest);
            if (hooks.setState) await hooks.setState(manifest.state, manifest);
            toast('Project loaded.', 'success');
        }

        function openPicker() {
            const input = h('input', { type: 'file', accept: '.pnp,application/zip' });
            input.addEventListener('change', async () => {
                const file = input.files[0];
                if (!file) return;
                try {
                    await load(file);
                } catch (err) {
                    console.error(err);
                    toast(err.message, 'error');
                }
            });
            input.click();
        }

        return {
            register,
            save: () => save().catch((err) => { console.error(err); toast(`Could not save project: ${err.message}`, 'error'); }),
            load,
            openPicker,
            _setTool: (t) => { tool = t; },
            get registered() { return !!hooks; },
        };
    })();

    // ---------------------------------------------------------------- top bar

    function topBar(toolId, { projectButtons }) {
        const header = document.querySelector('header');
        if (!header) return;
        const nav = h('nav', { class: 'pnp-topbar', 'aria-label': 'PnPTools' },
            h('a', { class: 'pnp-home', href: hubUrl(), title: 'All PnPTools' }, '◂ PnPTools'),
            h('div', { class: 'pnp-tools' },
                TOOLS.map((t) => h('a', {
                    class: `pnp-tool${t.id === toolId ? ' current' : ''}`,
                    href: toolUrl(t),
                    'aria-current': t.id === toolId ? 'page' : null,
                    title: t.id,
                }, h('span', { 'aria-hidden': 'true' }, t.icon), ` ${t.name}`))),
            h('div', { class: 'pnp-actions' },
                theme.toggleButton(),
                h('div', { class: 'pnp-units', role: 'group', 'aria-label': 'Units' },
                    ['mm', 'in'].map((u) => h('button', {
                        type: 'button',
                        'data-unit': u,
                        'aria-pressed': String(units.current === u),
                        onclick: () => units.set(u),
                    }, u))),
                projectButtons ? [
                    h('button', { type: 'button', class: 'pnp-action', onclick: () => project.openPicker(), title: 'Open a saved .pnp project' }, 'Open'),
                    h('button', { type: 'button', class: 'pnp-action', onclick: () => project.save(), title: 'Save settings and loaded files as a .pnp project' }, 'Save'),
                ] : null,
                h('button', {
                    type: 'button',
                    class: 'pnp-action',
                    title: 'Restore this tool’s default settings',
                    onclick: () => {
                        if (confirm('Reset all settings in this tool to their defaults?')) settings.reset();
                    },
                }, 'Reset')));
        header.prepend(nav);
    }

    // ---------------------------------------------------------------- offline

    // Registers the folder's service worker (sw.js next to the page) and asks
    // it to cache everything this page loaded plus any `extra` files the tool
    // only loads later (workers, lazily fetched libraries).
    function enableOffline(extra = []) {
        if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
        window.addEventListener('load', async () => {
            try {
                await navigator.serviceWorker.register('sw.js');
                const reg = await navigator.serviceWorker.ready;
                const loaded = performance.getEntriesByType('resource').map((e) => e.name);
                const urls = [location.href.split('#')[0], ...loaded, ...extra.map((u) => new URL(u, location.href).href)]
                    .filter((u) => /^https?:/.test(u));
                (reg.active || navigator.serviceWorker.controller)?.postMessage({ type: 'precache', urls: [...new Set(urls)] });
            } catch (err) {
                console.warn('Offline support unavailable:', err);
            }
        });
    }

    // ---------------------------------------------------------------- init

    /**
     * PnP.init({
     *   tool: 'PnPBleed',                     // TOOLS id
     *   settingsKey?: 'PnPCut-grid',          // localStorage scope (defaults to tool)
     *   settingsRoot?: Element,               // defaults to .sidebar
     *   project?: { getFiles, setFiles, getState, setState, fileName },
     *   hasUnsavedWork?: () => boolean,
     *   offlineFiles?: [url],                 // files loaded later that must work offline
     * })
     */
    function init(opts) {
        const toolId = opts.tool;
        project._setTool(toolId);
        units.scan();
        units.relabel();
        topBar(toolId, { projectButtons: !!opts.project });
        if (opts.project) project.register(opts.project);
        const rootEl = opts.settingsRoot === undefined ? document.querySelector('.sidebar') : opts.settingsRoot;
        settings.init(opts.settingsKey || toolId, rootEl);
        if (opts.hasUnsavedWork) guard(opts.hasUnsavedWork);
        enableOffline(opts.offlineFiles || []);
    }

    window.PnP = {
        TOOLS,
        MM_PER_IN,
        init,
        units,
        theme,
        settings,
        presets,
        bindPreset,
        handoff,
        sendMenu,
        importButton,
        itemsToFiles,
        dropzone,
        project,
        guard,
        allowLeave() { guardBypass = true; },
        enableOffline,
        toast,
        zip,
        downloadBlob,
        readImageDpi,
        setPngDpi,
        canvasToBlob: (canvas, type = 'image/png', quality) => new Promise((resolve, reject) => {
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image.'))), type, quality);
        }),
    };
})();
