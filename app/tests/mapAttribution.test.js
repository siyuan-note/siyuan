const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const install = (sources, css, controlledClock) => {
    document.head.innerHTML = "";
    document.body.innerHTML = '<div id="map" class="maplibregl-map"></div>';
    const style = document.createElement("style");
    style.textContent = css + "body{margin:0} #map{width:100vw;height:100vh;position:relative;background:lightblue}";
    document.head.append(style);
    const modules = {};
    for (const [name, source] of Object.entries(sources)) {
        const exports = {};
        new Function("require", "exports", source)(name => {
            assertModule(name, modules[name.slice(2)]);
            return modules[name.slice(2)];
        }, exports);
        modules[name] = exports;
    }
    const container = document.getElementById("map");
    class FakeMap {
        callbacks = new Map();
        controls = [];
        style = {stylesheet: {}, tileManagers: {source: {used: true, getSource: () => ({attribution:
            '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ' +
            '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> ' +
            'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'})}}};
        on(name, callback) {
            if (!this.callbacks.has(name)) this.callbacks.set(name, []);
            this.callbacks.get(name).push(callback);
        }
        off(name, callback) {
            this.callbacks.set(name, this.callbacks.get(name)?.filter(item => item !== callback) || []);
        }
        remove() { this.controls.forEach(control => control.onRemove()); }
        getCanvasContainer() { return container; }
        _getUIString() { return "Toggle attribution"; }
        addControl(control) {
            this.controls.push(control);
            const wrapper = document.createElement("div");
            wrapper.className = "maplibregl-ctrl-bottom-right";
            container.append(wrapper);
            wrapper.append(control.onAdd(this));
        }
        emit(name) { this.callbacks.get(name)?.slice().forEach(callback => callback()); }
        constructor() { window.mapFixture = this; }
    }
    if (controlledClock) {
        let now = 0, nextFrame = 0;
        const frames = new Map();
        window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
        window.cancelAnimationFrame = frame => frames.delete(frame);
        window.advanceAttribution = elapsed => {
            now += elapsed;
            const pending = [...frames.values()];
            frames.clear();
            pending.forEach(callback => callback(now));
        };
        window.pendingAttributionFrames = () => frames.size;
    }
    window.attributionLinks = [];
    window.attributionAdapter = modules.providers.createAVMapAdapter("openfreemap", {
        Map: FakeMap, AttributionControl: window.maplibregl.AttributionControl,
    }, container, {onMarkerClick() {}, onError() {}, onAttributionClick: link => window.attributionLinks.push(link)});
    window.showAttribution = visible => window.attributionAdapter.setVisible(visible,
        visible ? {x: 0, y: 0, width: window.innerWidth, height: window.innerHeight} : undefined);
    window.showAttribution(true);
    window.mapFixture.emit("load");
};

const assertModule = (name, module) => {
    if (!module) throw new Error(`Unknown fixture module: ${name}`);
};

const verifyTileHTTP = async (win, sources, css, sdk) => {
    const http = require("node:http");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWOoWHDiPwAGVALgQhC29AAAAABJRU5ErkJggg==", "base64");
    let failNextTile = false;
    let failedTiles = 0;
    let holdTiles = true;
    const pendingTiles = [];
    const server = http.createServer((request, response) => {
        if (request.url === "/") {
            response.setHeader("Content-Type", "text/html");
            response.end("<!doctype html><html><head></head><body style='margin:0'><div id='map' style='width:800px;height:600px'></div></body></html>");
        } else if (request.url === "/worker.js") {
            response.setHeader("Content-Type", "text/javascript");
            response.end(fs.readFileSync(require.resolve("maplibre-gl/dist/maplibre-gl-csp-worker.js")));
        } else if (/^\/tile\/\d+\/\d+\/\d+\.png$/.test(request.url)) {
            if (failNextTile) {
                failNextTile = false;
                failedTiles++;
                response.writeHead(503).end("Temporary fixture failure");
            } else {
                const sendTile = () => {
                    response.setHeader("Content-Type", "image/png");
                    response.end(png);
                };
                if (holdTiles) pendingTiles.push(sendTile);
                else sendTile();
            }
        } else {
            response.writeHead(404).end();
        }
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
        await win.loadURL(origin);
        await win.webContents.executeJavaScript(sdk);
        const installRealMap = (sources, css, origin) => new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Fixture map did not load")), 15000);
            const style = document.createElement("style");
            style.textContent = css;
            document.head.append(style);
            const modules = {};
            for (const [name, source] of Object.entries(sources)) {
                const exports = {};
                new Function("require", "exports", source)(name => {
                    if (!modules[name.slice(2)]) throw new Error(`Unknown fixture module: ${name}`);
                    return modules[name.slice(2)];
                }, exports);
                modules[name] = exports;
            }
            const sdk = window.maplibregl;
            sdk.setWorkerUrl(origin + "/worker.js");
            window.tileHTTP = {errors: [], removed: 0, tileError: null, ready: false, loaded: false};
            class FixtureMap extends sdk.Map {
                constructor(options) {
                    super({...options, preserveDrawingBuffer: true, style: {version: 8, sources: {fixture: {type: "raster", tileSize: 256,
                        tiles: [origin + "/tile/{z}/{x}/{y}.png"], minzoom: 0, maxzoom: 6, attribution: "Fixture data"}},
                        layers: [{id: "fixture", type: "raster", source: "fixture"}]}});
                    window.tileMap = this;
                    this.on("error", event => {
                        window.tileHTTP.tileError = {status: event.error?.status, sourceId: event.sourceId,
                            state: event.tile?.state, canonical: event.tile?.tileID?.canonical};
                    });
                    this.on("load", () => { window.tileHTTP.loaded = true; });
                }
                remove() { window.tileHTTP.removed++; super.remove(); }
            }
            window.tileAdapter = modules.providers.createAVMapAdapter("openfreemap", {...sdk, Map: FixtureMap},
                document.getElementById("map"), {onMarkerClick() {}, onReady() {
                    window.tileHTTP.ready = true;
                    clearTimeout(timer);
                    resolve();
                },
                    onError(code) {
                        window.tileHTTP.errors.push(code);
                        window.tileAdapter?.destroy();
                        clearTimeout(timer);
                        reject(new Error("Fixture map failed: " + code));
                    }});
        });
        await win.webContents.executeJavaScript(`(${installRealMap.toString()})(${JSON.stringify(sources)},
            ${JSON.stringify(css)}, ${JSON.stringify(origin)})`);
        assert.equal(await win.webContents.executeJavaScript("tileHTTP.ready"), true);
        assert.equal(await win.webContents.executeJavaScript("tileHTTP.loaded"), false);
        await win.webContents.executeJavaScript("tileAdapter.setPoints([{id:'fixture', longitude:121, latitude:31}],1); tileAdapter.fit(); void 0");
        assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('.maplibregl-marker').length"), 1);
        // 真实网络瓦片延迟超过原有 20 秒就绪期限；记录和相机已经可以使用。
        await new Promise(resolve => setTimeout(resolve, 21000));
        assert.ok(pendingTiles.length > 0);
        assert.deepEqual(await win.webContents.executeJavaScript("({ready:tileHTTP.ready,loaded:tileHTTP.loaded,removed:tileHTTP.removed,errors:tileHTTP.errors})"),
            {ready: true, loaded: false, removed: 0, errors: []});
        holdTiles = false;
        pendingTiles.splice(0).forEach(sendTile => sendTile());
        const loadDeadline = Date.now() + 10000;
        while (!await win.webContents.executeJavaScript("tileHTTP.loaded") && Date.now() < loadDeadline) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.equal(await win.webContents.executeJavaScript("tileHTTP.loaded"), true, "delayed tiles eventually finish rendering");
        const pixel = await win.webContents.executeJavaScript(`(() => {
            const canvas = tileMap.getCanvas();
            const gl = canvas.getContext("webgl2");
            const pixel = new Uint8Array(4);
            gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            return Array.from(pixel);
        })()`);
        assert.ok(pixel[3] > 0, "the real WebGL canvas paints the delayed raster tile");
        failNextTile = true;
        await win.webContents.executeJavaScript("tileMap.setZoom(3); void 0");
        const deadline = Date.now() + 10000;
        let state;
        do {
            await new Promise(resolve => setTimeout(resolve, 50));
            state = await win.webContents.executeJavaScript("tileHTTP");
        } while (!state.tileError && Date.now() < deadline);
        assert.equal(failedTiles, 1);
        assert.equal(state.tileError?.status, 503);
        assert.equal(state.tileError.sourceId, "fixture");
        assert.equal(state.tileError.state, "errored");
        assert.ok(Number.isInteger(state.tileError.canonical.z));
        assert.deepEqual(state.errors, []);
        assert.equal(state.removed, 0, "a real HTTP tile 503 preserves the loaded SDK map");
        await win.webContents.executeJavaScript("tileAdapter.setPoints([{id:'fixture', longitude:0, latitude:0}],1); void 0");
        assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('.maplibregl-marker').length"), 1);
        await win.webContents.executeJavaScript("tileMap.fire('error', {error: new Error('fixture fatal worker')}); void 0");
        state = await win.webContents.executeJavaScript("tileHTTP");
        assert.deepEqual(state.errors, ["mapUnavailable"]);
        assert.equal(state.removed, 1, "unclassified SDK errors retain the fatal cleanup path");
    } finally {
        await win.webContents.executeJavaScript("window.tileAdapter?.destroy()");
        await new Promise(resolve => server.close(resolve));
    }
};

const inspect = () => {
    const attribution = document.querySelector(".maplibregl-ctrl-attrib");
    const text = attribution.querySelector(".maplibregl-ctrl-attrib-inner");
    const rect = attribution.getBoundingClientRect();
    return {tag: attribution.tagName, buttonTag: attribution.firstElementChild.tagName, open: attribution.open,
        expandedClass: attribution.classList.contains("maplibregl-compact-show"),
        textVisible: text.checkVisibility(), hidden: document.hidden,
        radius: getComputedStyle(attribution).borderTopLeftRadius,
        corners: [rect.left + 1, rect.right - 1].flatMap(x => [rect.top + 1, rect.bottom - 1]
            .map(y => attribution.contains(document.elementFromPoint(x, y))))};
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({width: 800, height: 600, useContentSize: true, show: true,
            webPreferences: {sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false}});
        let code = 0;
        try {
            const ts = require("typescript");
            const compile = name => ts.transpileModule(fs.readFileSync(
                path.join(__dirname, "../src/protyle/render/av/map", name + ".ts"), "utf8"), {
                compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
            }).outputText;
            const sources = Object.fromEntries(["protocol", "attribution", "providers"]
                .filter(name => fs.existsSync(path.join(__dirname, "../src/protyle/render/av/map", name + ".ts")))
                .map(name => [name, compile(name)]));
            const css = fs.readFileSync(require.resolve("maplibre-gl/dist/maplibre-gl.css"), "utf8");
            const sdk = fs.readFileSync(require.resolve("maplibre-gl/dist/maplibre-gl-csp.js"), "utf8");
            const evaluate = source => win.webContents.executeJavaScript(source);
            const state = () => evaluate(`(${inspect.toString()})()`);
            const setup = async controlled => {
                await win.loadURL("data:text/html,<html><head></head><body></body></html>");
                await evaluate(sdk);
                await evaluate(`const assertModule = ${assertModule.toString()};
                    (${install.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(css)}, ${controlled})`);
            };
            await setup(false);
            const initial = await state();
            assert.equal(initial.tag, "DETAILS");
            assert.equal(initial.buttonTag, "SUMMARY");
            assert.equal(initial.hidden, false);
            assert.equal(initial.radius, "12px");
            assert.ok(initial.corners.some(hit => !hit), "rounded transparent corners do not hit attribution");
            assert.equal(initial.textVisible, true);
            const deadline = Date.now() + 10000;
            while ((await state()).open && Date.now() < deadline) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            assert.equal((await state()).open, false, "actual visible time automatically collapses after five seconds");
            assert.equal((await state()).textVisible, false);
            await evaluate("window.attributionAdapter.destroy()");

            await setup(true);
            await evaluate("document.getElementById('map').style.width = '780px'; advanceAttribution(0); advanceAttribution(4000)");
            await evaluate("attributionAdapter.setVisible(true, {x: 0, y: 0, width: 790, height: 600}); advanceAttribution(1000)");
            assert.equal((await state()).open, false, "an entirely visible viewport change preserves four elapsed seconds");
            await evaluate("window.attributionAdapter.destroy()");

            await setup(true);
            win.webContents.debugger.attach("1.3");
            await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {enabled: true});
            const click = async selector => {
                const point = await evaluate(`(() => {const rect = document.querySelector(${JSON.stringify(selector)})
                    .getBoundingClientRect(); return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};})()`);
                for (const type of ["mousePressed", "mouseReleased"]) {
                    await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
                        type, ...point, button: "left", clickCount: 1,
                    });
                }
            };
            await evaluate("advanceAttribution(0); advanceAttribution(4999)");
            assert.equal((await state()).open, true);
            await evaluate("showAttribution(false); advanceAttribution(10000); showAttribution(true); advanceAttribution(0); advanceAttribution(4999)");
            assert.equal((await state()).open, true, "hidden time is not charged");
            await evaluate("advanceAttribution(1)");
            assert.equal((await state()).open, false);
            assert.equal((await state()).expandedClass, false);
            await click("summary");
            assert.equal((await state()).open, true, "trusted click expands once without a duplicate native toggle");
            assert.equal((await state()).textVisible, true);
            await evaluate("showAttribution(false)");
            await click("summary");
            assert.equal((await state()).open, false, "local disclosure survives delayed host visibility messages");
            await click("summary");
            assert.equal((await state()).open, true);
            await click('a[href="https://maplibre.org/"]');
            assert.deepEqual(await evaluate("window.attributionLinks"), [], "hidden host cannot open an official link");
            await evaluate("showAttribution(true)");
            for (const href of ["https://maplibre.org/", "https://openfreemap.org", "https://www.openmaptiles.org/",
                "https://www.openstreetmap.org/copyright"]) {
                await click(`a[href="${href}"]`);
            }
            assert.deepEqual(await evaluate("window.attributionLinks"), ["maplibre", "openfreemap", "openmaptiles", "openstreetmap"]);
            await evaluate("document.querySelector('summary').click(); advanceAttribution(10000); mapFixture.emit('drag')");
            assert.equal((await state()).open, true, "synthetic input, elapsed time and drag preserve the user's choice");
            await click("summary");
            assert.equal((await state()).open, false);
            await evaluate("window.attributionAdapter.destroy()");
            assert.deepEqual(await evaluate("[pendingAttributionFrames(), [...mapFixture.callbacks.values()].flat().length]"), [0, 0],
                "destroy releases application and real SDK control listeners");
            await verifyTileHTTP(win, sources, css, sdk);
        } catch (error) {
            console.error(error);
            code = 1;
        } finally {
            win.destroy();
            app.exit(code);
        }
    });
} else {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("MapLibre attribution uses its real rounded DOM and supports trusted disclosure and visible display time", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY
            ? "Real Electron DOM verification requires DISPLAY or WAYLAND_DISPLAY" : false,
    }, async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-map-attribution-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            await promisify(execFile)(require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 60000});
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
