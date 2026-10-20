const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const browserCases = (sources, styles) => {
    const assert = require("node:assert/strict");
    window.siyuan = {config: {fileTree: {useSVGDefaultIcon: false}},
        storage: {"local-images": {note: "1f600", folder: "1f4d2", file: "2b50"}}};
    const modules = {"../constants": {Constants: {LOCAL_IMAGES: "local-images"}}};
    for (const [name, source] of sources) {
        const exports = {};
        new Function("exports", "require", source)(exports, id => modules[id]);
        modules[name] = exports;
    }
    const {getFileTreeIconHTML, updateFileTreeItemIcon} = modules.fileTree;
    const row = (id, html) => `<li id="${id}" class="b3-list-item"><span class="b3-list-item__icon">${html}</span>` +
        '<span class="b3-list-item__text">Document</span></li>';
    const style = document.createElement("style");
    style.textContent = styles;
    document.head.append(style);
    document.body.innerHTML = '<ul class="b3-list">' +
        row("emoji", getFileTreeIconHTML("1f600", "notebook")) +
        row("image", getFileTreeIconHTML("custom.png", "file")) +
        row("svg", getFileTreeIconHTML("", "file", "", false, true)) + "</ul>";
    const icon = document.querySelector("#emoji .b3-list-item__icon");
    const emoji = icon.firstElementChild;
    for (const platform of ["windows", "mac", "linux", "android", "ios", "harmony"]) {
        document.body.className = `body--${platform}`;
        for (const size of [14, 24]) {
            document.body.style.fontSize = `${size}px`;
            const before = icon.getBoundingClientRect();
            emoji.style.transform = "none";
            const original = emoji.getBoundingClientRect();
            emoji.style.transform = "";
            const adjusted = emoji.getBoundingClientRect();
            assert.equal(adjusted.top - original.top, platform === "windows" ? -1 : 0);
            assert.equal(icon.getBoundingClientRect().top, before.top);
            assert.equal(icon.getBoundingClientRect().height, before.height);
            assert.equal(document.elementFromPoint(adjusted.x + adjusted.width / 2,
                adjusted.y + adjusted.height / 2), icon, "glyph wrappers preserve the icon click target");
            for (const id of ["image", "svg"]) {
                const graphic = document.querySelector(`#${id} .b3-list-item__icon`).firstElementChild;
                assert.equal(getComputedStyle(graphic).transform, "none");
                assert.equal(graphic.getBoundingClientRect().width, 16);
                assert.equal(graphic.getBoundingClientRect().height, 16);
            }
        }
    }
    updateFileTreeItemIcon(document.getElementById("emoji"), "2b50", "file");
    assert.equal(icon.firstElementChild.className, "b3-list-item__emoji");
    updateFileTreeItemIcon(document.getElementById("emoji"), "custom.png", "file");
    assert.equal(icon.firstElementChild.tagName, "IMG");
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", path.join(process.argv[2], "profile"));
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        const root = path.resolve(__dirname, "..");
        const ts = require("typescript");
        const sources = [["../util/escape", "util/escape.ts"], ["./iconValue", "emoji/iconValue.ts"],
            ["fileTree", "emoji/fileTreeIcon.ts"]].map(([name, file]) => [name,
            ts.transpileModule(fs.readFileSync(path.join(root, "src", file), "utf8"), {
                compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
            }).outputText]);
        const css = require("sass").compile(path.join(root, "src/assets/scss/base.scss"),
            {logger: {warn() {}, debug() {}}}).css;
        await win.loadURL("about:blank");
        await win.webContents.executeJavaScript(fs.readFileSync(path.join(root, "stage/protyle/js/lute/lute.min.js"), "utf8"));
        await win.webContents.executeJavaScript(`(${browserCases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(css)})`);
        app.exit(0);
    } catch (error) {
        console.error(error);
        app.exit(1);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").it("adjusts only Windows file tree emoji glyphs while preserving image, SVG and click geometry", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 60000,
    }, async () => {
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-file-tree-icon-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, temporary], {env, windowsHide: true, timeout: 55000});
        } finally {
            assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(temporary).startsWith("siyuan-file-tree-icon-"));
            fs.rmSync(temporary, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
