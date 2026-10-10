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
        new Function("require", "exports", source)(name => modules[name.slice(2)], exports);
        modules[name] = exports;
    }
    const container = document.getElementById("map");
    class FakeMap {
        callbacks = new Map();
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
        remove() {}
        getCanvasContainer() { return container; }
        _getUIString() { return "Toggle attribution"; }
        addControl(control) {
            const wrapper = document.createElement("div");
            wrapper.className = "maplibregl-ctrl-bottom-right";
            container.append(wrapper);
            wrapper.append(control.onAdd(this));
        }
        emit(name) { this.callbacks.get(name)?.forEach(callback => callback()); }
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
            const sources = {protocol: compile("protocol"), providers: compile("providers")};
            const css = fs.readFileSync(require.resolve("maplibre-gl/dist/maplibre-gl.css"), "utf8");
            const sdk = fs.readFileSync(require.resolve("maplibre-gl/dist/maplibre-gl-csp.js"), "utf8");
            const evaluate = source => win.webContents.executeJavaScript(source);
            const state = () => evaluate(`(${inspect.toString()})()`);
            const setup = async controlled => {
                await win.loadURL("data:text/html,<html><head></head><body></body></html>");
                await evaluate(sdk);
                await evaluate(`(${install.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(css)}, ${controlled})`);
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
            await promisify(execFile)(require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 30000});
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
