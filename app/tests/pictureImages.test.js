const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const runCases = async (sources) => {
    const assert = require("node:assert/strict");
    const modules = new Map();
    const load = (name) => {
        if (!modules.has(name)) {
            const module = {exports: {}};
            modules.set(name, module);
            new Function("require", "exports", "module", sources[name])(load, module.exports, module);
        }
        return modules.get(name).exports;
    };
    const {normalizePictureImages} = load("./pictureImages");
    const {hasHTMLEmbeddedAssets, collectHTMLEmbeddedAssets} = load("./htmlEmbeddedAssets");
    const {collectHTMLLocalAssets} = load("./htmlLocalAssets");
    const placeholder = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
    const root = document.createElement("template");
    const sourceURL = "https://glyphsapp.com/zh/learn/vertical-metrics";
    const realURL = "https://glyphsapp.com/media/verticaladobe-1280.webp";
    // 评论截图中的来源分布：noscript 在 picture 前，实际图片仅存在于 source。
    root.innerHTML = `<figure class="Image Image--shadow"><noscript><img src="${realURL}"></noscript>` +
        `<picture class="js-only"><source type="image/webp" media="all" data-srcset="${realURL} 640w" ` +
        `srcset="https://glyphsapp.com/media/verticaladobe-320.webp 160w, ${realURL} 640w">` +
        `<img alt="diagram" data-lazyload data-sizes="90vw" src="${placeholder}" width="489" height="335"></picture></figure>`;
    assert.equal(hasHTMLEmbeddedAssets(root.content), true);
    normalizePictureImages(root.content, sourceURL);
    assert.equal(root.content.querySelector("picture img").getAttribute("src"), realURL);
    assert.equal(hasHTMLEmbeddedAssets(root.content), false);
    assert.equal(collectHTMLEmbeddedAssets(root.content).length, 0);
    assert.equal(collectHTMLLocalAssets(root.content).length, 0);
    const blockDOM = globalThis.Lute.New().HTML2BlockDOM(root.innerHTML);
    assert.ok(blockDOM.includes(realURL));
    assert.equal(blockDOM.includes(placeholder), false);

    root.innerHTML = "<picture><source srcset=\"/mobile.png 640w\" media=\"(max-width: 1px)\">" +
        "<source type=\"image/jxl\" srcset=\"/unsupported.jxl 640w\">" +
        `<source type="image/png" data-srcset="../images/a.png 640w"><img src="${placeholder}"></picture>`;
    normalizePictureImages(root.content, sourceURL);
    assert.equal(root.content.querySelector("img").getAttribute("src"), "https://glyphsapp.com/zh/images/a.png");

    root.innerHTML = "<picture><source media=\"(max-width: 600px)\" srcset=\"https://example.com/mobile.png 320w\">" +
        `<source srcset="https://example.com/desktop.png 1280w"><img src="${placeholder}"></picture>`;
    normalizePictureImages(root.content, sourceURL);
    assert.equal(root.content.querySelector("img").getAttribute("src"),
        window.matchMedia("(max-width: 600px)").matches ? "https://example.com/mobile.png" : "https://example.com/desktop.png");

    for (const html of [`<img src="${placeholder}">`, `<picture><img src="${placeholder}"></picture>`,
        "<picture><source srcset=\"https://example.com/real.png 640w\"><img src=\"assets/existing.png\"></picture>"]) {
        root.innerHTML = html;
        const before = root.innerHTML;
        normalizePictureImages(root.content, sourceURL);
        assert.equal(root.innerHTML, before);
    }

    // 选区只包含 img 时仍使用原页面选中的来源，并保持原页面属性不变。
    root.innerHTML = "<picture><source srcset=\"https://example.com/large.png 640w\">" +
        `<img src="${placeholder}" data-original="https://example.com/placeholder.png"></picture>`;
    const original = root.content.querySelector("img");
    Object.defineProperty(original, "currentSrc", {value: "https://example.com/selected.png"});
    const originalHTML = root.innerHTML;
    const range = document.createRange();
    range.selectNode(original);
    const selected = document.createElement("div");
    selected.append(range.cloneContents());
    normalizePictureImages(selected, sourceURL, [original]);
    assert.equal(selected.querySelector("img").getAttribute("src"), original.currentSrc);
    assert.equal(selected.querySelector("img").hasAttribute("data-original"), false);
    assert.equal(root.innerHTML, originalHTML);
    normalizePictureImages(selected, sourceURL);
    assert.equal(selected.querySelector("img").getAttribute("src"), original.currentSrc);
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    let exitCode = 0;
    try {
        const ts = require("typescript");
        const sources = Object.fromEntries([
            ["pictureImages", "util"], ["htmlEmbeddedAssets", "upload"], ["htmlLocalAssets", "upload"], ["base64File", "upload"],
        ].map(([name, directory]) => ["./" + name,
            ts.transpileModule(readFileSync(path.join(__dirname, `../src/protyle/${directory}/${name}.ts`), "utf8"),
                {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText]));
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(readFileSync(path.join(__dirname, "../stage/protyle/js/lute/lute.min.js"), "utf8"));
        await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(sources)})`);
        win.setSize(480, 800);
        await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(sources)})`);
        console.log("Picture image paste cases passed");
    } catch (error) {
        console.error(error);
        exitCode = 1;
    } finally {
        win.destroy();
        app.exit(exitCode);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => {
        console.error(error);
        require("electron").app.exit(1);
    });
} else {
    require("node:test").it("normalizes picture images before embedded uploads and Lute conversion using browser DOM", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-picture-images-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Picture image paste cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-picture-images-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
