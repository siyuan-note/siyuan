const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// 真实 owner、主进程、预载与原生子视图；固定 adapter 只隔离 OFM 网络和 WebGL。
const runBoundaryFixture = async (profile) => {
    const {app, BrowserWindow, WebContentsView, MessageChannelMain, ipcMain, session} = require("electron");
    const {createMapHostManager} = require("../electron/mapHostManager");
    const http = require("node:http");
    const ts = require("typescript");
    app.setPath("userData", profile);
    await app.whenReady();
    const mapDirectory = path.join(__dirname, "../src/protyle/render/av/map");
    const compile = name => ts.transpileModule(fs.readFileSync(path.join(mapDirectory, name + ".ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    const bundle = (names, extra, entry, electron = false) => {
        const modules = {...Object.fromEntries(names.map(name => ["./" + name, compile(name)])), ...extra};
        return `(() => {
            const modules = {${Object.entries(modules).map(([name, source]) =>
            `${JSON.stringify(name)}: (require, exports) => {${source}\n}`).join(",")}};
            const cache = {};
            const load = name => {
                ${electron ? 'if (name === "electron") return require("electron");' : ""}
                if (!modules[name]) throw new Error("Unknown fixture module");
                if (!cache[name]) { cache[name] = {}; modules[name](load, cache[name]); }
                return cache[name];
            };
            ${entry}
        })();`;
    };
    let owner, manager, server;
    const views = [];
    let privateRequests = 0;
    try {
        server = http.createServer((request, response) => {
            if (request.url !== "/stage/build/app/") {
                if (request.url.startsWith("/api/")) privateRequests++;
                response.writeHead(403).end();
                return;
            }
            response.setHeader("Content-Type", "text/html");
            response.end('<!doctype html><html><body style="margin:0"><div id="map" ' +
                'style="position:fixed;left:10px;top:20px;width:400px;height:300px"></div></body></html>');
        });
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        const origin = `http://127.0.0.1:${server.address().port}`;
        const runtime = bundle(["protocol", "loadingBudget", "bootstrap", "hostRuntime"], {
            "./providersLoader": `
                window.mapFixture = {fits: 0, revisions: [], destroyed: 0};
                exports.prepareAVMapAssets = async () => {
                    await new Promise(resolve => { window.releaseFixtureBootstrap = resolve; });
                    return {lock() {}, destroy() { window.mapFixture.assetsDestroyed = true; }};
                };
                exports.loadAVMapAdapter = async (_init, _container, callbacks) => {
                    if (window.rejectFixtureMap) throw new Error("private-fixture-path?token=secret");
                    window.mapFixture.callbacks = callbacks;
                    return {
                        setPoints(points, revision) { window.mapFixture.revisions.push(revision); },
                        fit() { window.mapFixture.fits++; },
                        resize() {}, setTheme() {}, setVisible() {},
                        destroy() { window.mapFixture.destroyed++; }
                    };
                };`,
        }, 'load("./hostRuntime").connectAVMapRuntime(window);');
        const fixtureFiles = new Map([
            ["stage/map/index.html", Buffer.from("<!doctype html><html><head><script defer " +
                'src="/stage/build/map/host.js"></script></head><body style="margin:0"><div id="map"></div></body></html>')],
            ["stage/build/map/host.js", Buffer.from(runtime)],
        ]);
        owner = new BrowserWindow({width: 800, height: 600, useContentSize: true, show: true,
            webPreferences: {nodeIntegration: true, contextIsolation: false, backgroundThrottling: false}});
        manager = createMapHostManager({app, ipcMain, session, BrowserWindow, MessageChannelMain,
            WebContentsView: function (options) {
                const view = new WebContentsView(options);
                views.push(view);
                return view;
            },
            getTarget: id => id === owner.webContents.id ? {origin, mode: "remote"} : undefined,
            isInitialized: id => id === owner.webContents.id, appDir: path.join(__dirname, ".."),
            readFile: async filename => {
                const key = path.relative(path.join(__dirname, ".."), filename).split(path.sep).join("/");
                if (!fixtureFiles.has(key)) throw new Error("Unknown fixture asset");
                return fixtureFiles.get(key);
            }});
        await owner.loadURL(origin + "/stage/build/app/");
        const evaluate = script => owner.webContents.executeJavaScript(script);
        const waitFor = async (predicate, label) => {
            const deadline = Date.now() + 5000;
            while (!await predicate()) {
                assert.ok(Date.now() < deadline, label);
                await new Promise(resolve => setTimeout(resolve, 25));
            }
        };
        await evaluate(bundle(["protocol", "loadingBudget", "unplacedMenu", "desktopGeometry", "desktopGeometryDOM", "desktopTransport"], {}, `
            window.ownerFixture = {ready: 0, errors: [], links: []};
            window.mapContainer = document.getElementById("map");
            window.startFixtureHost = () => load("./desktopTransport").createDesktopAVMapHost(window.mapContainer, {
                provider: "openfreemap", theme: "light", onMarkerClick() {},
                onReady() { window.ownerFixture.ready++; },
                onError(code) { window.ownerFixture.errors.push(code); },
                onAttributionClick(link) { window.ownerFixture.links.push(link); }
            });
            window.mapHost = window.startFixtureHost();
            window.mapHost.setPoints([{id: "row-1", longitude: 0, latitude: 0}], 1);
            window.openFixtureMenu = () => {
                const menu = document.createElement("div");
                menu.className = "b3-menu";
                menu.style.cssText = "position:fixed;left:250px;top:20px;width:150px;height:200px;background:white;z-index:10";
                document.body.appendChild(menu);
                const release = load("./unplacedMenu").registerMapUnplacedMenu(menu, window.mapContainer);
                window.closeFixtureMenu = () => { release(); menu.remove(); };
            };
        `, true));
        await waitFor(() => views.length === 1, "one native view is created");
        const view = views[0], map = view.webContents;
        const inspectMap = script => map.executeJavaScript(script);
        await waitFor(() => inspectMap("typeof window.releaseFixtureBootstrap === 'function'"), "the real preload transfers its port");
        assert.equal(view.getVisible(), false);
        assert.equal(await evaluate("window.ownerFixture.ready"), 0);
        assert.deepEqual(await inspectMap("({origin: window.origin, node: typeof require, bridge: window.siyuanMapDesktop.version})"),
            {origin: "null", node: "undefined", bridge: 1});
        await inspectMap("window.releaseFixtureBootstrap()");
        await waitFor(() => evaluate("window.ownerFixture.ready === 1"), "runtime ready crosses the main process");
        await waitFor(() => view.getVisible(), "the stable native map becomes visible");
        const fullBounds = view.getBounds();
        assert.equal(fullBounds.width, 400);
        assert.deepEqual(await inspectMap("({fits: window.mapFixture.fits, revisions: window.mapFixture.revisions})"),
            {fits: 1, revisions: [1]});
        await evaluate("window.openFixtureMenu()");
        await waitFor(() => view.getVisible() && view.getBounds().width < fullBounds.width, "an owned menu crops the real native view");
        assert.equal(await inspectMap("document.getElementById('map').style.width"), "400px");
        await evaluate("window.closeFixtureMenu()");
        await waitFor(() => view.getVisible() && view.getBounds().width === fullBounds.width, "menu closure restores the native view");
        assert.equal(await inspectMap("window.mapFixture.fits"), 1);
        owner.hide();
        await waitFor(() => !view.getVisible(), "hiding the actual owner hides its native child view");
        owner.show();
        await waitFor(() => view.getVisible(), "showing the owner restores verified native geometry");
        assert.deepEqual(view.getBounds(), fullBounds);
        assert.equal(await inspectMap("window.mapFixture.fits"), 1);
        owner.webContents.setZoomFactor(1.25);
        await waitFor(() => view.getVisible() && view.getBounds().width > fullBounds.width, "owner zoom is applied once");
        assert.equal(map.getZoomFactor(), 1.25);
        await evaluate("window.mapContainer.style.top = '-20px'; window.dispatchEvent(new Event('scroll'));");
        await waitFor(() => view.getVisible() && view.getBounds().y < 5, "scroll updates native cropping");
        assert.ok(view.getBounds().y >= 0);
        assert.match(await inspectMap("document.getElementById('map').style.transform"), /translate\(/);
        const privateURL = origin + "/api/map-fixture-private";
        assert.equal(await inspectMap(`fetch(${JSON.stringify(privateURL)}).then(() => false, () => true)`), true);
        assert.equal(await inspectMap(`new Promise(resolve => {
            const source = "fetch(" + ${JSON.stringify(JSON.stringify(privateURL))} + ").then(() => postMessage(false), () => postMessage(true))";
            const url = URL.createObjectURL(new Blob([source], {type: "text/javascript"}));
            const worker = new Worker(url);
            worker.onmessage = event => { worker.terminate(); URL.revokeObjectURL(url); resolve(event.data); };
            worker.onerror = () => { worker.terminate(); URL.revokeObjectURL(url); resolve(false); };
        })`), true, "the locked worker cannot connect to the owner API");
        const entryURL = map.getURL();
        await inspectMap(`window.location.href = ${JSON.stringify(privateURL)}`);
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.equal(map.getURL(), entryURL);
        assert.equal(privateRequests, 0);
        await inspectMap("window.mapFixture.callbacks.onAttributionClick('maplibre')");
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.deepEqual(await evaluate("window.ownerFixture"), {ready: 1, errors: [], links: []});
        await evaluate("window.mapHost.destroy(); window.mapHost.destroy()");
        await waitFor(() => map.isDestroyed(), "destroy closes the actual isolated renderer");
        assert.equal(owner.contentView.children.includes(view), false);
        await evaluate("window.mapHost = window.startFixtureHost()");
        await waitFor(() => views.length === 2, "a replacement receives an independent native view");
        const failedMap = views[1].webContents;
        await waitFor(() => failedMap.executeJavaScript("typeof window.releaseFixtureBootstrap === 'function'"), "replacement bootstrap receives its port");
        await failedMap.executeJavaScript("window.rejectFixtureMap = true; window.releaseFixtureBootstrap()");
        await waitFor(() => failedMap.isDestroyed(), "a failed adapter closes its real native renderer");
        assert.deepEqual(await evaluate("window.ownerFixture.errors"), ["sdkUnavailable"]);
        assert.equal((await evaluate("JSON.stringify(window.ownerFixture)")).includes("secret"), false);
    } finally {
        manager?.destroyAll();
        if (owner && !owner.isDestroyed()) owner.destroy();
        if (server) {
            server.closeAllConnections?.();
            await new Promise(resolve => server.close(resolve));
        }
    }
};

if (process.versions.electron && process.type === "browser") {
    const {app} = require("electron");
    runBoundaryFixture(process.argv[2]).then(() => app.exit(0), error => {
        console.error(error);
        app.exit(1);
    });
} else {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("real Electron owner, main, preload and isolated map enforce native geometry, CSP and teardown", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY
            ? "Real Electron boundary verification requires DISPLAY or WAYLAND_DISPLAY" : false,
    }, async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-map-boundary-"));
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
