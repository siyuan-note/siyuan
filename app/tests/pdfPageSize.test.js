const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const ts = require("typescript");

const browserCases = async (renderSource, persistSource) => {
    const check = require("node:assert/strict");
    const Constants = {LOCAL_EXPORTPDF: "pdf", SIYUAN_VERSION: "test", SIYUAN_GET: "get"};
    const config = {appearance: {themeLight: "daylight"}, editor: {}, export: {}, system: {}};
    let html;
    let exported;
    let dialogs = 0;
    let saved;
    const ipcRenderer = {
        invoke: async (_channel, options) => {
            if (options.cmd === "showOpenDialog") {
                dialogs++;
                return {canceled: false, filePaths: ["export"]};
            }
            return 0;
        },
        send: (_channel, options) => exported = options,
    };
    const renderPDF = new Function("Constants", "ipcRenderer", "getAvailableExportPath", "getHostCapabilities",
        "getIconScript", "getSnippetCSS", "getSnippetJS", "getExportLanguages", "setInlineStyle", "getCustomFontStyle",
        "getPluginStyle", "fetchPost", "headingPageBreakControls", renderSource + ";return renderPDF;")(
        Constants, ipcRenderer, async () => "", () => ({}), () => "", () => "", () => "", () => "{}",
        async () => "", async () => "", async () => "", (_url, data) => html = data.content, () => "");
    const tick = () => new Promise(resolve => setTimeout(resolve, 30));
    const open = async (pageSize = "A4") => {
        exported = undefined;
        window.siyuan = {config, storage: {pdf: {pageSize, paged: true, scale: 1, marginType: "none"}},
            languages: new Proxy({}, {get: (_object, key) => String(key)})};
        await renderPDF("root");
        document.getElementById("previewStyle")?.remove();
        const style = document.createElement("style");
        style.id = "previewStyle";
        style.textContent = html.match(/<style>([\s\S]*?)<\/style>/)[1];
        document.head.append(style);
        document.body.innerHTML = html.slice(html.indexOf("<body")).replace(/<script[\s\S]*?<\/script>/g, "");
        window.Protyle = new Proxy({}, {get: () => () => {}});
        window.fetch = async () => ({ok: true, json: async () => ({code: 0,
            data: {name: "Test", attrs: {}, content: "<div>Body</div>"}})});
        const inline = html.match(/<script>\s*const previewElement[\s\S]*?<\/script>/)[0]
            .replace(/^<script>|<\/script>$/g, "");
        new Function("require", inline)(() => ({ipcRenderer}));
        await tick();
        await new Promise(resolve => setTimeout(resolve, 320));
    };
    const control = id => document.getElementById(id);
    const change = async (id, value, event = "change") => {
        control(id).value = value;
        control(id).dispatchEvent(new Event(event));
        await tick();
    };
    const width = () => parseFloat(control("preview").style.width);
    const persist = data => new Function("window", "Constants", "setStorageVal", "ipcData", persistSource)(
        {siyuan: {storage: {}}}, Constants, (_key, value) => saved = value, data);

    await open();
    check.ok(control("customPageSize").classList.contains("fn__none"));
    await change("pageSize", "custom");
    check.ok(!control("customPageSize").classList.contains("fn__none"));
    check.equal(control("pageWidth").value, "8.27");
    check.equal(control("pageHeight").value, "11.7");
    check.equal(control("pageWidth").labels[0].textContent, "width");
    check.equal(control("pageHeight").labels[0].textContent, "height");
    check.ok(control("pageWidth").getBoundingClientRect().right <= control("action").getBoundingClientRect().right);
    await change("pageWidth", "5", "input");
    await change("pageHeight", "7", "input");
    check.equal(width(), 5 * 96);
    control("landscape").click();
    await new Promise(resolve => setTimeout(resolve, 320));
    check.equal(width(), 7 * 96);
    for (const [preset, inches] of [["A3", 16.54], ["A4", 11.7], ["A5", 8.27],
        ["Legal", 14], ["Letter", 11], ["Tabloid", 17]]) {
        await change("pageSize", preset);
        check.ok(Math.abs(width() - inches * 96) < 0.001);
        check.ok(control("customPageSize").classList.contains("fn__none"));
    }
    await change("pageSize", "custom");
    check.equal(control("pageWidth").value, "5", "Switching presets preserves this preview's custom dimensions");
    const confirm = document.querySelector(".b3-button--text");
    check.equal(confirm.disabled, false);
    for (const id of ["pageWidth", "pageHeight"]) {
        const original = control(id).value;
        for (const invalid of ["", "0", "-1", "0.001", "Infinity"]) {
            await change(id, invalid, "input");
            check.equal(control(id).checkValidity(), false);
            confirm.click();
            await tick();
            check.equal(dialogs, 0, "Invalid dimensions must not open the destination picker");
            check.ok(Number.isFinite(width()), "Invalid edits keep preview dimensions finite");
        }
        await change(id, original, "input");
    }
    confirm.click();
    await tick();
    check.equal(dialogs, 1);
    check.deepEqual(exported.pageSize, {width: 5, height: 7});
    check.deepEqual(exported.pdfOptions.pageSize, exported.pageSize);
    check.equal(exported.pdfOptions.landscape, true);
    persist(exported);
    check.deepEqual(saved.pageSize, {width: 5, height: 7});
    await open(saved.pageSize);
    check.equal(control("pageSize").value, "custom");
    check.equal(control("pageWidth").value, "5");
    check.equal(control("pageHeight").value, "7");
    check.equal(width(), 5 * 96);
    await change("pageWidth", "", "input");
    await change("pageSize", "A5");
    document.querySelector(".b3-button--text").click();
    await tick();
    check.equal(exported.pageSize, "A5", "Hidden custom inputs must not block preset exports");
    check.equal(exported.pdfOptions.pageSize, "A5");
    persist(exported);
    check.equal(saved.pageSize, "A5");
    await open(saved.pageSize);
    check.equal(control("pageSize").value, "A5");
    await open({width: -2, height: null});
    check.equal(control("pageWidth").value, "8.27");
    check.equal(control("pageHeight").value, "11.7");
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    let exitCode = 0;
    try {
        const source = readFileSync(path.join(__dirname, "../src/protyle/export/index.ts"), "utf8");
        const renderSource = ts.transpileModule(source.slice(source.indexOf("const renderPDF ="),
            source.indexOf("const getExportPath =")), {compilerOptions: {target: ts.ScriptTarget.ES2021}}).outputText;
        const bootSource = readFileSync(path.join(__dirname, "../src/boot/onGetConfig.ts"), "utf8");
        const start = bootSource.indexOf("        window.siyuan.storage[Constants.LOCAL_EXPORTPDF] =");
        const persistSource = bootSource.slice(start, bootSource.indexOf("        try {", start));
        await win.loadURL("data:text/html,<!DOCTYPE html><html><body></body></html>");
        await win.webContents.insertCSS(require("sass").compile(path.join(__dirname, "../src/assets/scss/export.scss")).css +
            ".fn__none {display:none}");
        await win.webContents.executeJavaScript(`(${browserCases.toString()})(${JSON.stringify(renderSource)}, ${JSON.stringify(persistSource)})`);
        console.log("Custom PDF paper UI cases passed");
    } catch (error) {
        console.error(error);
        exitCode = 1;
    } finally {
        win.destroy();
        app.exit(exitCode);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").it("custom PDF dimensions update previews, validate exports and restore paper history", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 30000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-pdf-page-size-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 25000});
            assert.match(stdout, /Custom PDF paper UI cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-pdf-page-size-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
