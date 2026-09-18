const assert = require("node:assert/strict");
const {readFileSync, writeFileSync, mkdirSync, copyFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    const profile = process.argv[2];
    app.setPath("userData", path.join(profile, "profile"));
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, width: 1000, height: 800});
    let exitCode = 0;
    try {
        const ts = require("typescript");
        const moduleExports = {};
        const source = readFileSync(path.join(__dirname, "../src/util/emojiFont.ts"), "utf8");
        new Function("exports", ts.transpileModule(source, {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
        }).outputText)(moduleExports);
        const {getEmojiFontStyle, NOTO_EMOJI_FONT_PATH} = moduleExports;
        const fontPath = path.join(profile, NOTO_EMOJI_FONT_PATH);
        mkdirSync(path.dirname(fontPath), {recursive: true});
        copyFileSync(path.join(__dirname, "..", NOTO_EMOJI_FONT_PATH), fontPath);
        const sequences = JSON.parse(readFileSync(path.join(__dirname, "fixtures/unicode17-emoji.json"), "utf8"));
        const oldSequences = ["1f600", "1f1e8-1f1f3", "1f46f", "1f93c", "1fa70", "1f9d1-200d-1f4bb",
            "1f469-1f3fd-200d-1f4bb", "1f468-200d-1f469-200d-1f467", "1f469-200d-2764-fe0f-200d-1f469"];
        const characters = [...sequences, ...oldSequences].map(sequence => String.fromCodePoint(...sequence.split("-").map(value => parseInt(value, 16))));
        win.webContents.debugger.attach("1.3");
        const command = (method, params) => win.webContents.debugger.sendCommand(method, params);
        for (const platform of ["apple", "windows11", "other"]) {
            // 从导出目录加载真实 WOFF2，确保字体声明及相对路径能在离线页面使用。
            const html = `<html><meta charset="utf-8"><style>${getEmojiFontStyle(platform, "")}
body { background: white; }
.emoji { display: inline-block; font-size: 32px; margin: 3px; font-family: "Emojis Additional", "Emojis"; }
.text { font-family: "Emojis Additional", "Emojis Reset", Arial, "Emojis"; }
</style><body>${characters.map((char, index) => `<span id="emoji-${index}" class="emoji">${char}</span>`).join("")}
<hr>${characters.map((char, index) => `<span id="text-${index}" class="emoji text">${char}</span>`).join("")}
${characters.map((char, index) => `<span id="native-${index}" style='font-family:"Emojis"'>${char}</span>`).join("")}</body></html>`;
            const htmlPath = path.join(profile, `${platform}.html`);
            writeFileSync(htmlPath, html);
            await win.loadFile(htmlPath);
            await command("DOM.enable");
            await command("CSS.enable");
            await win.webContents.executeJavaScript("document.fonts.ready.then(() => true)");
            const {root} = await command("DOM.getDocument");
            for (const context of ["emoji", "text"]) {
                for (let index = 0; index < characters.length; index++) {
                    const {nodeId} = await command("DOM.querySelector", {nodeId: root.nodeId, selector: `#${context}-${index}`});
                    const {fonts} = await command("CSS.getPlatformFontsForNode", {nodeId});
                    const label = `${platform}/${context}: ${[...sequences, ...oldSequences][index]}`;
                    const glyphCount = fonts.reduce((count, font) => count + font.glyphCount, 0);
                    if (index < sequences.length || platform === "other") {
                        assert.equal(glyphCount, 1, `${label}: ${JSON.stringify(fonts)}`);
                        assert.ok(fonts.every(font => font.isCustomFont), `${label}: ${JSON.stringify(fonts)}`);
                    } else {
                        // 系统字体对旧组合的支持各异，补充字体不能使既有组合进一步拆分。
                        const native = await command("DOM.querySelector", {nodeId: root.nodeId, selector: `#native-${index}`});
                        const {fonts: nativeFonts} = await command("CSS.getPlatformFontsForNode", {nodeId: native.nodeId});
                        const nativeCount = nativeFonts.reduce((count, font) => count + font.glyphCount, 0);
                        assert.ok(glyphCount > 0 && glyphCount <= nativeCount, `${label}: ${JSON.stringify(fonts)}`);
                    }
                }
            }
            const pdf = await win.webContents.printToPDF({printBackground: true});
            assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
            assert.ok(pdf.length > 10000);
            if (process.env.SIYUAN_EMOJI_TEST_ARTIFACTS) {
                const artifacts = path.resolve(process.env.SIYUAN_EMOJI_TEST_ARTIFACTS);
                mkdirSync(artifacts, {recursive: true});
                writeFileSync(path.join(artifacts, `${platform}.pdf`), pdf);
                writeFileSync(path.join(artifacts, `${platform}.png`), (await win.webContents.capturePage()).toPNG());
            }
        }
        console.log("Unicode 17 emoji rendering cases passed");
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
    require("node:test").it("renders Unicode 17 sequences and existing emoji with platform and offline export styles", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 90000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-emoji-font-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 85000});
            assert.match(stdout, /Unicode 17 emoji rendering cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-emoji-font-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
