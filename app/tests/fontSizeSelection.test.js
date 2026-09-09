const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const runCases = () => {
    const assert = require("node:assert/strict");
    document.body.innerHTML = '<div id="editor" style="font-size:16px"><div data-node-id="quote" data-type="NodeBlockquote">' +
        '<div data-node-id="one" data-type="NodeParagraph"><div contenteditable="true">111<span contenteditable="false" style="font-size:12px">badge</span></div><div class="protyle-attr" style="font-size:12px">attribute</div></div>' +
        '<div data-node-id="two" data-type="NodeParagraph"><div contenteditable="true">222</div></div></div></div>';
    const editor = document.getElementById("editor");
    const first = editor.querySelector('[data-node-id="one"] > div');
    const second = editor.querySelector('[data-node-id="two"] > div');
    const range = document.createRange();
    range.setStart(first.firstChild, 1);
    range.setEnd(second.firstChild, 2);
    const sample = () => window.fontSize.getSelectedFontSize(window.selection.getBlockRanges(editor, range));
    assert.equal(sample().fontSize, "16px");
    assert.equal(sample().mixed, false);
    second.style.fontSize = "20px";
    assert.equal(sample().mixed, true);
    second.style.fontSize = "1em";
    assert.equal(sample().mixed, false);
    assert.equal(sample().fontSize, "16px");
    first.style.fontSize = "1em";
    assert.equal(sample().fontSize, "1em");
    assert.equal(sample().baseFontSize, 16);
    second.innerHTML = '222<span style="font-size:30px">outside</span>';
    range.setEnd(second.firstChild, 2);
    assert.equal(sample().mixed, false);
    range.setEnd(second.lastChild.firstChild, 1);
    assert.equal(sample().mixed, true);
    range.setStart(second.firstChild, 3);
    assert.equal(sample().fontSize, "30px");
    assert.equal(sample().mixed, false);
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
        const root = path.join(__dirname, "../src/protyle");
        const read = name => readFileSync(path.join(root, name + ".ts"), "utf8");
        const extract = (name, names) => {
            const source = ts.createSourceFile(name, read(name), ts.ScriptTarget.Latest, true);
            const statements = source.statements.filter(statement => ts.isVariableStatement(statement) &&
                statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source))));
            assert.equal(statements.length, names.length);
            return statements.map(statement => statement.getText(source)).join("\n");
        };
        // 使用实际块选区解析；位置偏移与隐藏页签不参与本组字号场景。
        const modules = {
            "toolbar/fontSizeCore": read("toolbar/fontSizeCore"),
            "toolbar/fontSizeSelection": read("toolbar/fontSizeSelection"),
            "util/hasClosest": read("util/hasClosest"),
            "wysiwyg/getBlock": 'import {hasClosestBlock, hasClosestByClassName} from "../util/hasClosest";\n' +
                extract("wysiwyg/getBlock", ["getContenteditableElement"]),
            "util/selection": 'import {hasClosestBlock, isInEmbedBlock} from "./hasClosest";\n' +
                'import {getContenteditableElement} from "../wysiwyg/getBlock";\n' +
                "const isHiddenTabContent = () => false; const getSelectionOffset = () => ({start:0,end:0});\n" +
                extract("util/selection", ["getBlockRanges"]),
        };
        const sources = Object.fromEntries(Object.entries(modules).map(([name, source]) => [name,
            ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText]));
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(`(() => {
            const sources = ${JSON.stringify(sources)}, cache = {};
            const load = name => {
                if (!cache[name]) {
                    if (!sources[name]) { throw new Error(name); }
                    cache[name] = {};
                    const resolve = dependency => load(require("node:path").posix.normalize(
                        require("node:path").posix.dirname(name) + "/" + dependency));
                    new Function("require", "exports", sources[name])(resolve, cache[name]);
                }
                return cache[name];
            };
            window.fontSize = load("toolbar/fontSizeSelection");
            window.selection = load("util/selection");
        })()`);
        await win.webContents.executeJavaScript(`(${runCases.toString()})()`);
        console.log("Font size selection cases passed");
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
    require("node:test").it("samples editable cross-block font sizes with native DOM ranges", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-font-size-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Font size selection cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-font-size-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
