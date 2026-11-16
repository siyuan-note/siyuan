const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const runCases = (sources) => {
    const check = require("node:assert/strict");
    new Function("module", "exports", sources.lute)(undefined, undefined);
    new Function("module", "exports", sources.html)(undefined, undefined);
    window.siyuan = {languages: {}};
    const dependencies = {
        "../../toolbar/fontFamilyCore": {},
        "../../../util/escape": {escapeHtml: window.Lute.EscapeHTMLStr},
        "../../../constants": {Constants: {}},
        "../../wysiwyg/codeBlockUtil": {CODE_TAB_SPACE_VALUES: []},
        "../../util/inlineElementBoundary": {restoreInlineElementBoundaries() {}},
        "../setLute": {getAgentLute: () => {
            const lute = window.Lute.New();
            lute.SetTextMark(true);
            lute.SetHTMLTag2TextMark(true);
            lute.SetKramdownIAL(true);
            lute.SetSpin(true);
            lute.SetProtyleWYSIWYG(true);
            lute.SetRenderListStyle(false);
            lute.SetSanitize(true);
            return lute;
        }},
    };
    const load = name => {
        if (!dependencies[name]) {
            const exports = {};
            if (sources[name]) {
                new Function("require", "exports", sources[name])(load, exports);
            }
            dependencies[name] = exports;
        }
        return dependencies[name];
    };
    const richText = load("./richText");
    for (const [source, starts] of [
        ["2. second\n3. third", [2]],
        ["0. zero\n1. first", [0]],
        ["1. first\n\nseparator\n\n2. second", [1, 2]],
        ["3. outer\n\n   5. inner\n   6. next\n4. last", [3, 5]],
        ["- bullet\n\n  4. nested\n  5. next", [4]],
        ["- [ ] pending\n- [x] completed\n\n7. seventh", [7]],
    ]) {
        let markdown = source;
        for (let round = 0; round < 3; round++) {
            const preview = document.createElement("div");
            preview.innerHTML = richText.getAVRichTextPreviewHTML(markdown);
            const lists = Array.from(preview.querySelectorAll("ol"));
            check.deepEqual(lists.map(list => list.start), starts, `${source}, round ${round}: ${preview.innerHTML}`);
            lists.forEach((list, index) => {
                if (starts[index] !== 1) {
                    check.equal(list.getAttribute("start"), String(starts[index]));
                }
            });
            preview.querySelectorAll("input").forEach(input => {
                check.equal(input.type, "checkbox");
                check.equal(input.disabled, true);
            });
            const serialized = richText.serializeAVRichTextBlockDOM(richText.getAVRichTextBlockDOM(markdown));
            markdown = serialized.markdown;
        }
    }
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
        const {parse} = require("ifdef-loader/preprocessor");
        for (const mobile of [false, true]) {
            const sources = Object.fromEntries(["richText", "richTextValue"].map(name => ["./" + name,
                ts.transpileModule(parse(readFileSync(path.join(__dirname, `../src/protyle/render/av/${name}.ts`), "utf8"),
                    {MOBILE: mobile, BROWSER: true}, false, true), {
                    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
                }).outputText]));
            sources.lute = readFileSync(path.join(__dirname, "../stage/protyle/js/lute/lute.min.js"), "utf8");
            sources.html = readFileSync(path.join(__dirname, "../stage/protyle/js/protyle-html.js"), "utf8");
            await win.loadURL("data:text/html,<html><body></body></html>");
            const error = await win.webContents.executeJavaScript(`(() => {
                try { (${runCases.toString()})(${JSON.stringify(sources)}); return ""; }
                catch (error) { return error.stack; }
            })()`);
            assert.equal(error, "");
        }
        console.log("AV rich text preview cases passed");
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
    require("node:test").it("preserves database rich text list starts on desktop and mobile", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-av-rich-text-preview-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /AV rich text preview cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-av-rich-text-preview-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
