const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const runCases = async () => {
    const assert = require("node:assert/strict");
    const family = "SiYuanCustomFont-" + "a".repeat(64);
    const unused = "SiYuanCustomFont-" + "b".repeat(64);
    await window.customFont.ensureSelectedCustomFonts([]);
    document.body.innerHTML = `<span style="font-family: '${family}'">Readable text</span>`;
    const loaded = await document.fonts.load(`400 16px "${family}"`, "Readable text");
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].status, "loaded");
    const html = `<div style="font-family: var(--emoji), '${family}', serif">${unused}</div>` +
        "<script>window.exportScriptExecuted = true;</script>";
    const css = await window.customFont.getExportCustomFontStyle([], html);
    assert.ok(css.includes(family));
    assert.ok(!css.includes(unused));
    assert.match(css, /data:font\/ttf;base64,/);
    assert.equal(window.exportScriptExecuted, undefined);
    const style = document.createElement("style");
    style.textContent = css;
    document.querySelectorAll('[id^="customFontStyle-"]').forEach(element => element.remove());
    document.head.append(style);
    // 导出字体使用嵌入数据，不依赖工作空间的字体地址。
    document.body.innerHTML = `<span style="font-family: '${family}'">Offline text</span>`;
    const exported = await document.fonts.load(`400 16px "${family}"`, "Offline text");
    assert.equal(exported.length, 1);
    assert.equal(exported[0].status, "loaded");
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const fonts = ["a", "b"].map(character => {
        const id = character.repeat(64);
        return {id, family: "SiYuanCustomFont-" + id, displayName: "Imported", weight: 400};
    });
    const fontBytes = readFileSync(path.join(__dirname, "../stage/protyle/js/pdf/standard_fonts/LiberationSans-Regular.ttf"));
    const requests = [];
    const server = require("node:http").createServer((request, response) => {
        if (request.url.startsWith("/custom-fonts/")) {
            requests.push(request.url);
            response.writeHead(200, {"Content-Type": "font/ttf"});
            response.end(fontBytes);
        } else {
            response.writeHead(200, {"Content-Type": "text/html"});
            response.end("<!DOCTYPE html><html><head></head><body></body></html>");
        }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    let exitCode = 0;
    try {
        const ts = require("typescript");
        const source = ts.transpileModule(readFileSync(path.join(__dirname, "../src/util/customFont.ts"), "utf8"), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
        }).outputText;
        await win.loadURL(`http://127.0.0.1:${server.address().port}/stage/build/desktop/`);
        await win.webContents.executeJavaScript(`(() => {
            window.siyuan = {config: {system: {container: "harmony"}}};
            window.customFont = {};
            new Function("exports", "require", ${JSON.stringify(source)})(window.customFont,
                () => ({fetchSyncPost: async () => ({code: 0, data: ${JSON.stringify(fonts)}})}));
        })()`);
        await win.webContents.executeJavaScript(`(${runCases.toString()})()`);
        assert.ok(requests.includes(`/custom-fonts/${fonts[0].id}`));
        assert.ok(!requests.includes(`/custom-fonts/${fonts[1].id}`));
        console.log("Imported font rendering and offline export passed");
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
    runElectron().catch(error => {
        console.error(error);
        require("electron").app.exit(1);
    });
} else {
    require("node:test").it("renders imported inline fonts after reopening and embeds only used fonts in HTML", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-custom-font-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Imported font rendering and offline export passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-custom-font-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
