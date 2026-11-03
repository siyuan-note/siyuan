const assert = require("node:assert/strict");
const {readFileSync, writeFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const rendererSource = () => {
    const ts = require("typescript");
    const declarations = {
        "util/selection.ts": ["focusByWbr"],
        "util/selectionOffsets.ts": ["focusByRange"],
        "wysiwyg/getBlock.ts": ["hasNextSibling", "hasPreviousSibling"],
        "util/inlineElementMarker.ts": ["ZERO_WIDTH_SPACE", "WORD_JOINER", "SEMANTIC_INLINE_TYPES", "INTERNAL_MARKERS",
            "hasSemanticInlineType", "getSemanticInternalMarkerPrefixLength", "isSemanticInlineElement", "getFirstTextNode",
            "isSemanticInlineMarkerTextNode", "getSemanticMarkerPrefixLengthForNode"],
    };
    const files = ["render/mathRender.ts", "render/mathRenderSecurity.ts", "render/foldedContent.ts", "util/hasClosest.ts",
        ...Object.keys(declarations)];
    const source = files.map(file => {
        const parsed = ts.createSourceFile(file, readFileSync(path.join(__dirname, "../src/protyle", file), "utf8"),
            ts.ScriptTarget.Latest, true);
        const names = declarations[file];
        const statements = parsed.statements.filter(statement => !ts.isImportDeclaration(statement) &&
            (!names || ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration =>
                names.includes(declaration.name.getText(parsed)))));
        if (names) {
            assert.equal(statements.length, names.length, file);
        }
        return statements.map(statement => statement.getText(parsed)).join("\n").replace(/^export /gm, "");
    }).join("\n");
    return ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2021}}).outputText;
};

const setup = async (source, options) => {
    const dependencies = {
        addScript: () => Promise.resolve(), addStyle: () => {},
        Constants: {PROTYLE_CDN: "", ZWSP: "\u200b"}, looseJsonParse: JSON.parse,
        getHostCapabilities: () => ({remoteKernel: false}), revealTabsForTarget: () => {},
        genRenderFrame: () => { throw new Error("Unexpected block formula"); },
    };
    const api = new Function(...Object.keys(dependencies), source + "\nreturn {focusByWbr, mathRender};")(
        ...Object.values(dependencies));
    window.siyuan = {config: {editor: {katexMacros: "{}"}}};
    const lute = window.Lute.New();
    ["SetTextMark", "SetHTMLTag2TextMark", "SetBlockRef", "SetSpin", "SetProtyleWYSIWYG", "SetKramdownIAL"]
        .forEach(method => lute[method](true));
    document.body.innerHTML = '<div class="protyle-wysiwyg" contenteditable="false">' +
        (options.container === "table" ? lute.Md2BlockDOM("| Header |\n| --- |\n| 1： |") :
            lute.Md2BlockDOM(options.container === "heading" ? "### 1：" : "1：")) + "</div>";
    const editor = document.body.firstElementChild;
    const editable = options.container === "table" ? editor.querySelector("td") : editor.querySelector('[contenteditable="true"]');
    const range = document.createRange();
    range.setStart(editable.firstChild, editable.firstChild.textContent.length);
    range.collapse(true);
    const pasted = document.createElement("template");
    pasted.innerHTML = lute.Md2BlockDOM(`$${options.formula}$`);
    pasted.innerHTML = pasted.content.firstElementChild.firstElementChild.innerHTML.trim();
    const fragment = pasted.content.cloneNode(true);
    const math = fragment.querySelector('[data-type="inline-math"]');
    range.insertNode(fragment);
    range.setStart(editable.lastChild, 0);
    range.collapse(true);
    const marker = document.createElement("wbr");
    range.insertNode(marker);
    // Range 插入会拆分文本，保留这些空节点以覆盖真实粘贴后的组合输入边界。
    const rendering = api.mathRender(editor);
    if (options.rendered) {
        await rendering;
    }
    api.focusByWbr(editor, range, options.preserve);
    await rendering;
    window.inlineMathInputFixture = {editor, editable, math, lute};
    if (options.preserve) {
        const count = editable.childNodes.length;
        api.focusByWbr(editor, range, true);
        if (editable.childNodes.length !== count) {
            throw new Error("Restoring a retained marker added another boundary");
        }
        marker.remove();
    }
    editor.focus();
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return {outside: !math.contains(range.startContainer), collapsed: range.collapsed};
};

const readResult = () => {
    const {editor, editable, math, lute} = window.inlineMathInputFixture;
    const copy = editable.cloneNode(true);
    copy.querySelectorAll('[data-type~="inline-math"]').forEach(element => element.remove());
    return {text: copy.textContent.replace(/[\u200b\ufeff]/g, ""), markdown: lute.BlockDOM2StdMd(editor.innerHTML),
        formula: math.dataset.content, outside: !math.contains(getSelection().anchorNode)};
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    await app.whenReady();
    const win = new BrowserWindow({show: false, width: 900, height: 600,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false}});
    let exitCode = 0;
    try {
        const katexRoot = path.join(__dirname, "../stage/protyle/js/katex");
        const url = require("node:url").pathToFileURL;
        const html = path.join(process.argv[2], "test.html");
        writeFileSync(html, '<html><head><meta charset="utf-8"><link rel="stylesheet" href="' +
            url(path.join(katexRoot, "katex.min.css")) + '"><script src="' +
            url(path.join(__dirname, "../stage/protyle/js/lute/lute.min.js")) + '"></script></head><body></body></html>');
        await win.loadFile(html);
        await win.webContents.executeJavaScript(`window.katex = require(${JSON.stringify(path.join(katexRoot, "katex.min.js"))}); true;`);
        win.webContents.debugger.attach("1.3");
        await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {enabled: true});
        const source = rendererSource();
        let cases = 0;
        for (const container of ["paragraph", "heading", "table"]) {
            for (const formula of [String.raw`E_{\mathrm{c}}`, String.raw`I^{\prime}`]) {
                for (const rendered of [false, true]) {
                    for (const preserve of [false, true]) {
                        const options = {container, formula, rendered, preserve};
                        const restored = await win.webContents.executeJavaScript(
                            `(${setup.toString()})(${JSON.stringify(source)}, ${JSON.stringify(options)})`);
                        assert.deepEqual(restored, {outside: true, collapsed: true}, JSON.stringify(options));
                        let expected = "1：";
                        for (const text of ["。", "。", "，", "，", "中文"]) {
                            await win.webContents.debugger.sendCommand("Input.imeSetComposition", {
                                text, selectionStart: text.length, selectionEnd: text.length,
                            });
                            await win.webContents.debugger.sendCommand("Input.insertText", {text});
                            expected += text;
                            const result = await win.webContents.executeJavaScript(`(${readResult.toString()})()`);
                            assert.equal(result.text, expected, JSON.stringify({...options, text, result}));
                            assert.equal(result.formula, formula);
                            assert.equal(result.outside, true);
                            assert.ok(result.markdown.includes(`$${formula}$`), JSON.stringify({...options, result}));
                        }
                        cases++;
                    }
                }
            }
        }
        console.log(`Inline math input: ${cases} native composition cases passed`);
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
    require("node:test").test("commits IME text once after pasted inline math and preserves repeated punctuation", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-inline-math-input-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Inline math input: 24 native composition cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-inline-math-input-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
