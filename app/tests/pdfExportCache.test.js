const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const os = require("node:os");
const ts = require("typescript");

const createPreview = mode => {
    const source = readFileSync(path.join(__dirname, "../src/protyle/export/index.ts"), "utf8");
    const compiled = ts.transpileModule(source.slice(source.indexOf("const renderPDF ="),
        source.indexOf("const getExportPath =")), {compilerOptions: {target: ts.ScriptTarget.ES2021}}).outputText;
    let html;
    let time = 1000;
    const renderPDF = new Function("window", "Constants", "ipcRenderer", "getAvailableExportPath", "getHostCapabilities",
        "getIconScript", "getSnippetCSS", "getSnippetJS", "getExportLanguages", "setInlineStyle", "getCustomFontStyle",
        "getPluginStyle", "fetchPost", "headingPageBreakControls", "Date", compiled + ";return renderPDF;")(
        {siyuan: {config: {appearance: {themeLight: "daylight"}, editor: {}, export: {}, system: {}},
            storage: {pdf: {paged: true}}, languages: {}}},
        {LOCAL_EXPORTPDF: "pdf", SIYUAN_VERSION: "test", NODE_ENV: mode}, {invoke: async () => 0},
        async () => "", () => ({}), () => "", () => "", () => "", () => "{}", async () => "", async () => "",
        async () => "", (_url, data) => html = data.content, () => "", {now: () => ++time});
    return async () => {
        await renderPDF("root");
        return {
            css: html.match(/id="baseStyle" href="([^"]+)"/)[1],
            js: html.match(/src="([^"]*stage\/build\/export\/protyle-method\.js[^"]*)"/)[1],
        };
    };
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    await app.whenReady();
    const win = new BrowserWindow({show: false});
    let phase = 0;
    let resources;
    const server = http.createServer((request, response) => {
        const pathname = new URL(request.url, "http://localhost").pathname;
        if (pathname.endsWith(".css") || pathname.endsWith(".js")) {
            response.setHeader("Cache-Control", "public, max-age=3600");
            response.setHeader("Content-Type", pathname.endsWith(".css") ? "text/css" : "text/javascript");
            response.end(pathname.endsWith(".css") ? `.probe { height: ${phase ? 880 : 1500}px; }` :
                `window.exportGeneration = ${phase};`);
        } else {
            response.setHeader("Content-Type", "text/html");
            response.setHeader("Cache-Control", "no-store");
            response.end(`<link rel="stylesheet" href="${resources.css}"><div class="probe"></div><script src="${resources.js}"></script>`);
        }
    });
    let exitCode = 0;
    try {
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        const origin = "http://127.0.0.1:" + server.address().port;
        const preview = createPreview("development");
        resources = await preview();
        await win.loadURL(origin + "/first");
        assert.deepEqual(await win.webContents.executeJavaScript(`({height: document.querySelector(".probe").clientHeight,
            generation: window.exportGeneration})`), {height: 1500, generation: 0});
        phase = 1;
        resources = await preview();
        await win.loadURL(origin + "/second");
        assert.deepEqual(await win.webContents.executeJavaScript(`({height: document.querySelector(".probe").clientHeight,
            generation: window.exportGeneration})`), {height: 880, generation: 1},
        "A new development preview must load rebuilt CSS and rendering scripts despite a warm cache");
        const production = createPreview("production");
        assert.deepEqual(await production(), await production(), "Production exports retain versioned resource caching");
        console.log("PDF export resource cache cases passed");
    } catch (error) {
        console.error(error);
        exitCode = 1;
    } finally {
        win.destroy();
        await new Promise(resolve => server.close(resolve));
        app.exit(exitCode);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").it("development PDF previews refresh rebuilt resources while production keeps versioned caching", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 30000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-pdf-cache-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 25000});
            assert.match(stdout, /PDF export resource cache cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-pdf-cache-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
