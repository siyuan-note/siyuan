const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const runCases = (sources) => {
    const check = require("node:assert/strict");
    new Function("module", "exports", sources.lute)(undefined, undefined);
    new Function("module", "exports", sources.html)(undefined, undefined);
    window.siyuan = {languages: {}};
    const opened = [];
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
            lute.SetSanitize(true);
            return lute;
        }},
        "../../../editor/openLink": {openLink: (_app, href) => opened.push(href)},
        "./attributeValue": {getAVTemplateInteractiveElement: () => undefined},
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
    const {avClick} = load("./action");
    const {handleRichTextInteraction} = load("./blockAttr");
    for (const target of [
        "hook://file/EqhAm6xHS?p=YXJjaGl2ZXMvcHJvdmVuYW5jZQ==&n=2026%2D10%2D05",
        "obsidian://open?vault=notes&file=book", "custom+app://action/path",
    ]) {
        let markdown = `[Book](${target})`;
        for (let round = 0; round < 3; round++) {
            const blockDOM = richText.getAVRichTextBlockDOM(markdown);
            const serialized = richText.serializeAVRichTextBlockDOM(blockDOM);
            check.equal(serialized.plainText, "Book");
            markdown = serialized.markdown;
            const host = document.createElement("div");
            host.className = "av__celltext--rich";
            host.innerHTML = richText.getAVRichTextPreviewHTML(markdown);
            document.body.replaceChildren(host);
            const link = host.querySelector("a[href]");
            check.ok(link, `link was removed: ${markdown}`);
            check.equal(link.textContent, "Book");
            check.equal(link.getAttribute("href"), target);
            for (const handler of [avClick, handleRichTextInteraction]) {
                host.onclick = event => handler({app: {}}, event);
                const count = opened.length;
                const event = new MouseEvent("click", {bubbles: true, cancelable: true});
                link.dispatchEvent(event);
                check.equal(opened.length, count + 1);
                check.equal(opened.at(-1), target);
                check.equal(event.defaultPrevented, true);
            }
        }
    }
    for (const target of [
        "javascript://host/payload", "vbscript://host/payload", "data://host/payload",
        "file://host/path", "chrome://settings", "java%73cript://host/payload",
    ]) {
        const host = document.createElement("div");
        host.innerHTML = richText.getAVRichTextPreviewHTML(`[Blocked](${target})`);
        check.equal(host.querySelector("a[href], [data-href], script, iframe"), null, target);
    }
    const imageDOM = '<div data-type="NodeParagraph"><div contenteditable="true">' +
        '<span class="img"><img data-src="hook://file/example" src="hook://file/example"></span></div></div>';
    const image = document.createElement("div");
    image.innerHTML = richText.sanitizeAVRichTextBlockDOM(imageDOM, true, true);
    check.equal(image.querySelector("img[src], img[data-src]"), null);
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
            const sources = Object.fromEntries(["richText", "richTextValue", "action", "blockAttr"].map(name => ["./" + name,
                ts.transpileModule(parse(readFileSync(path.join(__dirname, `../src/protyle/render/av/${name}.ts`), "utf8"),
                    {MOBILE: mobile, BROWSER: true}, false, true), {
                    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
                }).outputText]));
            sources["./blockAttr"] += "\nexports.handleRichTextInteraction = handleRichTextInteraction;";
            sources.lute = readFileSync(path.join(__dirname, "../stage/protyle/js/lute/lute.min.js"), "utf8");
            sources.html = readFileSync(path.join(__dirname, "../stage/protyle/js/protyle-html.js"), "utf8");
            await win.loadURL("data:text/html,<html><body></body></html>");
            const error = await win.webContents.executeJavaScript(`(() => {
                try { (${runCases.toString()})(${JSON.stringify(sources)}); return ""; }
                catch (error) { return error.stack; }
            })()`);
            assert.equal(error, "");
        }
        console.log("AV custom protocol cases passed");
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
    require("node:test").it("preserves and opens custom database text links on desktop and mobile", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-av-custom-protocol-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /AV custom protocol cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-av-custom-protocol-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
