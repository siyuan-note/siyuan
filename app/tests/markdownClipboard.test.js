const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const sources = () => {
    const ts = require("typescript");
    const compile = file => ts.transpileModule(readFileSync(path.join(__dirname, "../src", file), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText;
    return {
        clipboard: compile("protyle/util/markdownClipboard.ts"),
        paste: compile("protyle/util/paste.ts"),
        fixture: JSON.parse(readFileSync(path.join(__dirname, "fixtures/doubao-clipboard.json"), "utf8")),
    };
};

const runCases = async source => {
    const check = require("node:assert/strict");
    const {Lute} = window;
    const load = (code, mocks = {}) => {
        const module = {exports: {}};
        new Function("module", "exports", "require", code)(module, module.exports, id => mocks[id] || {});
        return module.exports;
    };
    const clipboard = load(source.clipboard);
    const {shouldPasteMarkdownFromHTML: preferMarkdown} = clipboard;
    const {html, text} = source.fixture;
    check.equal(preferMarkdown(html, text), true, "captured Doubao clipboard");
    check.equal(preferMarkdown(Lute.Sanitize(html), text), true, "sanitized clipboard");
    check.equal(preferMarkdown("<p><strong>标题</strong>\n第一行\n第二行</p>", "**标题**\n第一行\n第二行"), true);
    check.equal(preferMarkdown("<p>公式 $g=4.2%$</p>", "公式 $g=4.2\\%$"), true);
    check.equal(preferMarkdown("<p>$$\nY=C+I+G\n$$</p>", "$$\nY=C+I+G\n$$"), false);
    check.equal(preferMarkdown("<p><strong>公式</strong> $x$</p>", "**公式** $x$"), true);
    check.equal(preferMarkdown("<p><strong>代码</strong>\n<code>&lt;br&gt;</code></p>", "**代码**\n`<br>`"), true);

    const richText = "**标题**\n第二行\n\n[链接](https://example.com)\n\n![图片](https://example.com/image.png)";
    const richHTML = '<p><strong>标题</strong>\n第二行</p><p><a href="https://example.com">链接</a></p>' +
        '<p><img src="https://example.com/image.png" alt="图片"></p>';
    check.equal(preferMarkdown(richHTML, richText), true, "matching links and images");
    check.equal(preferMarkdown(richHTML.replace("image.png", "other.png"), richText), false, "different image source");
    check.equal(preferMarkdown(richHTML.replace('href="https://example.com"', 'href="https://example.com/other"'), richText),
        false, "different link destination");
    check.equal(preferMarkdown(richHTML + "<p>HTML 独有内容</p>", richText), false, "HTML-only content");

    for (const [name, value, plain] of [
        ["empty text", html, ""],
        ["empty HTML", "", text],
        ["ordinary selection", "<p>第一行\n第二行 $x$</p>", "第一行\n第二行 $x$"],
        ["ordinary rich selection", "<p><strong>标题</strong>\n内容 $x$</p>", "标题\n内容 $x$"],
        ["different text", html, text.replace("4.2", "5.0")],
        ["different structure", html.replaceAll("<strong>", "<em>").replaceAll("</strong>", "</em>"), text],
        ["text color", html.replace("<strong>", '<strong style="color: red">'), text],
        ["font size", html.replace("<p>", '<p style="font-size: 24px">'), text],
        ["list style", html.replace("decimal", "upper-roman"), text],
        ["list numbering", html.replace("<ol ", '<ol start="3" '), text],
        ["rendered math", '<p><strong>公式</strong> <span class="katex">x</span></p>', "**公式** $x$"],
        ["inline code", "<p><strong>示例</strong> <code>$g=4.2\\%$</code></p>", "**示例** `$g=4.2\\%$`"],
        ["fenced code", "<pre><code>$g=4.2\\%$\n$x$\n</code></pre>", "```\n$g=4.2\\%$\n$x$\n```"],
        ["explicit line break", "<p><strong>标题</strong><br>第二行</p>", "**标题**\n第二行"],
        ["placeholder collision", html + "\uE000", text + "\uE000"],
        ["raw HTML", "<p><strong>标题</strong>\n第二行</p>", "<p><strong>标题</strong>\n第二行</p>"],
        ["mixed raw HTML", "<p><strong>标题</strong>\n<span>第二行</span></p>", "**标题**\n<span>第二行</span>"],
    ]) {
        check.equal(preferMarkdown(value, plain), false, name);
    }

    // 识别过程处理未经清洗的受限编辑器剪贴板时，图片事件不能触发。
    window.clipboardImageEvents = 0;
    check.equal(preferMarkdown('<p><strong>图片</strong>\n<img src="data:image/png,broken" ' +
        'onerror="window.clipboardImageEvents++"></p>', "**图片**\n![](data:image/png,broken)"), false);
    await new Promise(resolve => setTimeout(resolve, 50));
    check.equal(window.clipboardImageEvents, 0);

    const lute = Lute.New();
    lute.SetInlineMath(true);
    lute.SetProtyleWYSIWYG(true);
    lute.SetTextMark(true);
    lute.SetHTMLTag2TextMark(true);
    const validateResult = result => {
        const root = document.createElement("div");
        root.innerHTML = result;
        check.deepEqual(Array.from(root.querySelectorAll('[data-type="inline-math"]'), node => node.dataset.content),
            ["g=4.2\\%", "S-A=C_A"]);
        check.match(root.querySelector('[data-type="NodeParagraph"] [contenteditable]').textContent,
            /示例\n名义增长率 [\s\S]*\n国民收入恒等式/);
        check.equal(root.querySelector('[data-type="NodeMathBlock"]').dataset.content, "\\(Y=C+I+G\\)");
        check.equal(root.querySelectorAll('[data-type="NodeListItem"]').length, 2);
        check.ok(Array.from(root.querySelectorAll('[data-type~="code"]')).some(node => node.textContent.includes("$g=4.2\\%$")));
    };

    // 执行共享入口，覆盖桌面剪贴板事件、移动端读取结果以及保留来源格式选项。
    const paste = async (mobile, preserveSourceFormat = false, restricted = false) => {
        let inserted;
        let htmlConversions = 0;
        let checkedBlockDOM;
        const validated = new Error("validated restricted content");
        const block = document.createElement("div");
        block.setAttribute("data-type", "NodeParagraph");
        const range = document.createRange();
        range.selectNodeContents(block);
        const noop = () => {};
        const mocks = {
            "../../constants": {Constants: {ZWSP: "\u200b"}},
            "./markdownClipboard": clipboard,
            "../runtimeCapabilities": {
                getProtyleBlockDOMSanitizer: () => restricted ? value => value : undefined,
                isProtyleRichHTMLPasteEnabled: () => restricted,
                isProtyleUploadDisabled: () => true,
                areProtylePluginExtensionsEnabled: () => false,
                getProtyleUnsupportedPasteBlocks: () => value => {
                    checkedBlockDOM = value;
                    throw validated;
                },
            },
            "../upload/insertPosition": {
                createUploadInsertPosition: () => ({range}), captureUploadDocument: () => ({}),
                isUploadInsertPositionAvailable: () => true, getAvailableUploadInsertRange: () => range,
            },
            "./selection": {getEditorRange: () => range},
            "./hasClosest": {hasClosestBlock: () => block},
            "./wpsPresentation": {extractWPSPresentationClipboard: () => undefined},
            "./compatibility": {isInHarmony: () => false,
                getTextSiyuanFromTextHTML: value => ({textSiyuan: "", textHtml: value})},
            "./officeMath": {extractOfficeMathHTML: () => ""},
            "./officeList": {convertOfficeLists: value => ({html: value, convertedCount: 0})},
            "./pasteSource": {extractCrossBlockPasteContext: value => ({html: value})},
            "./processCode": {processPasteCode: () => false, processRender: noop},
            "./inlineElementMarker": {stripSemanticMarkersFromRangeText: () => ""},
            "../upload/htmlLocalAssets": {resolveHTMLAssetURLs: noop, getHTMLAssetSourceURL: () => undefined,
                collectHTMLLocalAssets: () => [], removeHTMLLocalAssetPaths: noop},
            "../upload/htmlEmbeddedAssets": {hasHTMLEmbeddedAssets: () => false, collectHTMLEmbeddedAssets: () => []},
            "../../util/hostCapabilities": {getHostCapabilities: () => ({localFileSystem: false})},
            "../../util/fetch": {fetchSyncPost: async (_url, request) => {
                htmlConversions++;
                return {code: 0, data: lute.HTML2BlockDOM(request.dom)};
            }},
            "./insertHTML": {insertHTML: value => { inserted = value; }},
            "../ui/hideElements": {hideElements: noop},
            "../render/blockRender": {blockRender: noop},
            "../render/highlightRender": {highlightRender: noop},
            "../render/av/render": {avRender: noop},
            "../../util/highlightById": {scrollCenter: noop},
            "electron": {ipcRenderer: {invoke: async () => ""}},
        };
        window.siyuan = {config: {editor: {pasteURLAutoConvert: false}}};
        const protyle = {lute, hint: {}, options: {upload: {max: 1024 * 1024}},
            wysiwyg: {element: block}, toolbar: {getCurrentType: () => []}};
        const event = mobile ? {textHTML: html, textPlain: text, siyuanHTML: "", target: block, preserveSourceFormat} : {
            target: block, stopPropagation: noop, preventDefault: noop, preserveSourceFormat,
            clipboardData: {files: [], types: [], getData: type => ({"text/html": html, "text/plain": text}[type] || "")},
        };
        try {
            await load(source.paste, mocks).paste(protyle, event);
            check.equal(restricted, false);
        } catch (error) {
            if (!restricted || error !== validated) {
                throw error;
            }
        }
        return {inserted, htmlConversions, checkedBlockDOM};
    };
    for (const mobile of [false, true]) {
        const result = await paste(mobile);
        check.equal(result.htmlConversions, 0);
        validateResult(result.inserted);
        const preserved = await paste(mobile, true);
        check.equal(preserved.htmlConversions, 1);
        const restricted = await paste(mobile, false, true);
        validateResult(restricted.checkedBlockDOM);
        const restrictedPreserved = await paste(mobile, true, true);
        check.doesNotMatch(restrictedPreserved.checkedBlockDOM, /data-type="inline-math"/);
    }
    return "Markdown clipboard cases passed";
};

const run = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {
        nodeIntegration: true, contextIsolation: false, offscreen: true,
    }});
    let code = 0;
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(readFileSync(path.join(__dirname,
            "../stage/protyle/js/lute/lute.min.js"), "utf8"));
        const result = await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(sources())})`);
        assert.equal(result, "Markdown clipboard cases passed");
        console.log(result);
    } catch (error) {
        console.error(error);
        code = 1;
    } finally {
        win.destroy();
        app.exit(code);
    }
};

if (process.versions.electron && process.type === "browser") {
    run().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").test("Markdown clipboard detection and shared paste entry", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-markdown-clipboard-test-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Markdown clipboard cases passed/);
        } finally {
            assert.ok(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep));
            rmSync(profile, {recursive: true, force: true});
        }
    });
}
