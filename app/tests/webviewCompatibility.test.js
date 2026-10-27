const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

async function runElectron() {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    await app.whenReady();
    const win = new BrowserWindow({show: false});
    const root = path.resolve(__dirname, "../stage/protyle");
    const server = require("node:http").createServer((request, response) => {
        const name = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
        if (name === "/") { response.end("<html><body></body></html>"); return; }
        const file = path.resolve(root, "." + name);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
        response.setHeader("Content-Type", "text/javascript");
        response.end(fs.readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    let code = 0;
    try {
        await win.loadURL("http://127.0.0.1:" + server.address().port + "/");
        const compat = fs.readFileSync(path.join(__dirname, "../stage/protyle/js/webview-compat.js"), "utf8");
        const ts = require("typescript");
        const inert = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/boot/inert.ts"), "utf8"), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
        }).outputText;
        const reset = require("sass").compile(path.join(__dirname, "../src/assets/scss/util/_reset.scss")).css;
        await win.webContents.insertCSS(reset);
        const result = await win.webContents.executeJavaScript(`(async () => {
            const check = (value, message) => { if (!value) throw new Error(message); };
            const native = {clone: structuredClone, parse: URL.parse, any: AbortSignal.any, group: Object.groupBy};
            ${compat}
            check(native.clone === structuredClone && native.parse === URL.parse && native.any === AbortSignal.any && native.group === Object.groupBy,
                "compatibility replaced native implementations");
            delete globalThis.structuredClone; delete URL.parse; delete AbortSignal.any;
            delete Promise.withResolvers; delete Object.groupBy;
            ${compat}
            check(URL.parse("/a", "https://example.com/").href === "https://example.com/a", "relative URL parsing failed");
            check(URL.parse("https://[invalid") === null, "invalid URL did not return null");
            let threw = false;
            try { URL.parse({toString() { throw new Error("conversion"); }}); } catch { threw = true; }
            check(threw, "URL conversion error was swallowed");
            const {promise, resolve} = Promise.withResolvers(); resolve(42);
            check(await promise === 42, "promise resolver failed");
            const a = new AbortController(), b = new AbortController();
            const reason = new Error("cancel");
            const signal = AbortSignal.any([a.signal, b.signal]); b.abort(reason);
            check(signal.aborted && signal.reason === reason, "abort reason was not preserved");
            check(AbortSignal.any([b.signal]).reason === reason && !AbortSignal.any([]).aborted, "pre-aborted or empty signal list failed");
            const groups = Object.groupBy([1, 2, 3], value => value % 2 ? "__proto__" : "even");
            check(Object.getPrototypeOf(groups) === null && groups.__proto__.length === 2 && groups.even[0] === 2, "grouping keys were unsafe");
            const buffer = new Uint8Array([1, 2, 3]).buffer;
            const object = {buffer, view: new Uint8Array(buffer), map: new Map(), set: new Set([7]), date: new Date(123), big: 5n};
            object.self = object; object.map.set(object, object.view);
            const copy = structuredClone(object, {transfer: [buffer]});
            check(buffer.byteLength === 0 && copy.buffer.byteLength === 3 && copy.view.buffer === copy.buffer &&
                copy.self === copy && copy.map.get(copy) === copy.view && copy.set.has(7) && copy.date.getTime() === 123 && copy.big === 5n,
                "structured clone lost transfer, type or graph identity");
            const unchanged = new ArrayBuffer(4);
            try { structuredClone({fn() {}}, {transfer: [unchanged]}); } catch (error) { check(error.name === "DataCloneError", "wrong clone error"); }
            check(unchanged.byteLength === 4, "failed clone detached original data");
            threw = false;
            try { structuredClone(unchanged, {transfer: [unchanged, unchanged]}); } catch (error) { threw = error.name === "DataCloneError"; }
            check(threw && unchanged.byteLength === 4, "duplicate transfers were accepted");
            const canvas = new OffscreenCanvas(2, 2);
            canvas.getContext("2d").fillRect(0, 0, 2, 2);
            const bitmap = canvas.transferToImageBitmap();
            const imageCopy = structuredClone({bitmap}, {transfer: [bitmap]});
            check(bitmap.width === 0 && imageCopy.bitmap.width === 2, "image transfer was not preserved");
            imageCopy.bitmap.close();
            const compatUrl = location.origin + "/js/webview-compat.js";
            const workerCode = 'delete URL.parse; delete Promise.withResolvers; delete globalThis.structuredClone; await import(' + JSON.stringify(compatUrl) + '); postMessage({url:URL.parse("/worker", "https://example.com").pathname, value:await Promise.withResolvers().promise.constructor.resolve(7)});';
            const workerUrl = URL.createObjectURL(new Blob([workerCode], {type: "text/javascript"}));
            const worker = new Worker(workerUrl, {type: "module"});
            const workerResult = await new Promise((resolve, reject) => { worker.onmessage = event => resolve(event.data); worker.onerror = event => reject(new Error("compatibility worker: " + event.message)); });
            worker.terminate(); URL.revokeObjectURL(workerUrl);
            check(workerResult.url === "/worker" && workerResult.value === 7, "worker compatibility failed");
            const pdfModule = await import(location.origin + "/js/pdf/pdf.min.mjs");
            const pdfWorkerCode = 'delete URL.parse; delete Promise.withResolvers; await import(' + JSON.stringify(location.origin + "/js/pdf/pdf.worker.compat.mjs?v=6.4.299-siyuan.2") + ');';
            const pdfWorkerUrl = URL.createObjectURL(new Blob([pdfWorkerCode], {type: "text/javascript"}));
            const pdfWorker = new Worker(pdfWorkerUrl, {type: "module"});
            const workerMessages = [];
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error("PDF worker initialization timed out")), 8000);
                pdfWorker.addEventListener("message", event => {
                    if (event.data.action === "ready") { clearTimeout(timeout); resolve(); }
                });
                pdfWorker.addEventListener("error", event => { clearTimeout(timeout); reject(new Error(event.message || "PDF worker initialization failed")); });
            });
            pdfWorker.addEventListener("message", event => workerMessages.push(event.data.action));
            pdfWorker.addEventListener("error", event => workerMessages.push(event.message || "worker error"));
            pdfModule.GlobalWorkerOptions.workerPort = pdfWorker;
            let pdfSource = "%PDF-1.7\\n";
            const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>"];
            const offsets = [0];
            objects.forEach((object, index) => { offsets.push(pdfSource.length); pdfSource += (index + 1) + " 0 obj\\n" + object + "\\nendobj\\n"; });
            const xref = pdfSource.length;
            pdfSource += "xref\\n0 4\\n0000000000 65535 f \\n" + offsets.slice(1).map(offset => String(offset).padStart(10, "0") + " 00000 n \\n").join("");
            pdfSource += "trailer\\n<< /Size 4 /Root 1 0 R >>\\nstartxref\\n" + xref + "\\n%%EOF";
            const pdfTask = pdfModule.getDocument({data: new TextEncoder().encode(pdfSource)});
            try {
                const pdf = await Promise.race([pdfTask.promise, new Promise((_, reject) => setTimeout(() =>
                    reject(new Error("PDF compatibility worker timed out: " + JSON.stringify(workerMessages))), 8000))]);
                const page = await pdf.getPage(1);
                check(pdf.numPages === 1 && page.getViewport({scale: 1}).width === 100, "PDF did not open with its compatibility worker");
                await pdfTask.destroy();
            } finally { pdfWorker.terminate(); URL.revokeObjectURL(pdfWorkerUrl); }
            delete HTMLElement.prototype.inert;
            const exports = {}; ${inert}
            exports.installInertFallback(document);
            document.body.innerHTML = '<button id="first">First</button><div id="hidden"><button id="inside">Inside</button></div><button id="last">Last</button><div id="color"></div>';
            const first = document.getElementById("first"), hidden = document.getElementById("hidden"), inside = document.getElementById("inside"), last = document.getElementById("last");
            first.focus(); hidden.inert = true;
            first.dispatchEvent(new KeyboardEvent("keydown", {key:"Tab", bubbles:true, cancelable:true}));
            check(document.activeElement === last, "Tab entered inert controls");
            last.dispatchEvent(new KeyboardEvent("keydown", {key:"Tab", shiftKey:true, bubbles:true, cancelable:true}));
            check(document.activeElement === first, "reverse Tab entered inert controls");
            inside.focus(); check(document.activeElement !== inside, "programmatic focus entered inert controls");
            let clicked = false; inside.onclick = () => { clicked = true; }; inside.click();
            check(!clicked, "inert controls received a click");
            hidden.inert = false; inside.focus(); check(document.activeElement === inside, "removing inert did not restore focus");
            hidden.setAttribute("inert", ""); await Promise.resolve();
            check(document.activeElement !== inside, "new inert attribute retained focus");
            const color = document.getElementById("color");
            color.style.backgroundColor = "var(--b3-legacy-light-color, #ddeeff) var(--b3-legacy-dark-color, #223344)";
            document.documentElement.dataset.themeMode = "light";
            check(getComputedStyle(color).backgroundColor === "rgb(221, 238, 255)", "light color fallback failed");
            document.documentElement.dataset.themeMode = "dark";
            check(getComputedStyle(color).backgroundColor === "rgb(34, 51, 68)", "dark color fallback failed to switch");
            return true;
        })()`);
        assert.equal(result, true);
    } catch (error) { console.error(error); code = 1; }
    finally { win.destroy(); server.close(); app.exit(code); }
}

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").test("legacy WebView fallbacks preserve cloning, workers, focus and theme switching", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-webview-compat-"));
        try {
            await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
        } finally { fs.rmSync(profile, {recursive: true, force: true}); }
    });
}
