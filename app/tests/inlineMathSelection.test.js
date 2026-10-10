const assert = require("node:assert/strict");
const {readFileSync, writeFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const setup = async (source, suffix) => {
    const dependencies = {
        addScript: () => Promise.resolve(), addStyle: () => {},
        Constants: {PROTYLE_CDN: "", ZWSP: "\u200b"}, looseJsonParse: JSON.parse,
        getHostCapabilities: () => ({remoteKernel: false}),
        revealTabsForTarget: () => {},
        genRenderFrame: () => { throw new Error("Unexpected block formula"); },
    };
    const api = new Function(...Object.keys(dependencies), source + "\nreturn {mathRender, normalizeInlineMathCaret};")(
        ...Object.values(dependencies));
    window.mathSelectionAPI = api;
    window.siyuan = {config: {editor: {katexMacros: "{}"}}};
    document.body.innerHTML = '<div class="protyle-wysiwyg"><div data-node-id="20260929143659-b77z50y" ' +
        'data-type="NodeParagraph"><div contenteditable="true">发达复赛<span data-type="inline-math" ' +
        'data-subtype="math" contenteditable="false"></span>你好你好11111<span data-type="inline-math" ' +
        'data-subtype="math" contenteditable="false" data-content="M"></span></div></div></div>';
    const formulas = document.querySelectorAll('[data-type="inline-math"]');
    // 保留原始测试文档中的公式及段末边界字符，不能用重新解析的 Markdown 替代。
    formulas[0].dataset.content = String.raw`\sum\limits_{n=1}\limits^{n_{0}-1}\Delta(m,n)`;
    formulas[1].after(document.createTextNode(suffix));
    await api.mathRender(document.querySelector(".protyle-wysiwyg"));
    await document.fonts.ready;
    const point = (node, offset) => {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const rect = range.getBoundingClientRect();
        return {x: rect.left + 1, y: (rect.top + rect.bottom) / 2};
    };
    const before = point(formulas[0].previousSibling, 1);
    const after = point(formulas[0].nextSibling, 7);
    return {before, after, end: {x: formulas[1].getBoundingClientRect().right + 30, y: before.y}};
};

const setupEdge = async (mode) => {
    document.body.innerHTML = '<div class="protyle-wysiwyg" contenteditable="false" data-readonly="false">' +
        '<div data-node-id="20261010232335-t6hx5pb" data-type="NodeParagraph" class="p">' +
        '<div contenteditable="true" spellcheck="false"><span data-inline-wrap="token"></span>' +
        '<span data-type="inline-math" data-subtype="math" contenteditable="false" class="render-node"></span>' +
        "哒哒哒哒哒哒</div></div></div>";
    const editable = document.querySelector('[contenteditable="true"]');
    const prefix = editable.firstChild;
    prefix.textContent = "1".repeat(141);
    const math = editable.querySelector('[data-type="inline-math"]');
    math.dataset.content = String.raw`I_{\mathrm{E}}`;
    await window.mathSelectionAPI.mathRender(editable);
    await document.fonts.ready;
    const range = document.createRange();
    range.selectNodeContents(prefix);
    const width = range.getBoundingClientRect().width;
    editable.style.width = (width + math.getBoundingClientRect().width * (mode === "left" ? 0.5 : 1) + 2) + "px";
    const point = (node, offset) => {
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const rect = range.getBoundingClientRect();
        return {x: rect.left + 1, y: (rect.top + rect.bottom) / 2};
    };
    const rect = math.getBoundingClientRect();
    const after = point(math.nextSibling, 1);
    const before = point(prefix.firstChild, prefix.textContent.length - 2);
    document.addEventListener("click", () => {
        // 使用编辑器的延迟光标校正，验证鼠标释放后的选区不会被折叠。
        setTimeout(() => {
            const selection = getSelection();
            if (selection.rangeCount) {
                window.mathSelectionAPI.normalizeInlineMathCaret(selection.getRangeAt(0));
            }
        }, 0);
    }, {once: true});
    return {before, after, left: {x: rect.left + 0.5, y: after.y},
        mathEnd: {x: rect.right + 1, y: after.y}, right: {x: rect.right + 1, y: before.y},
        width: editable.clientWidth, mathLeft: rect.left, prefixLeft: prefix.getBoundingClientRect().left};
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    const ts = require("typescript");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, width: 1600, height: 600,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false}});
    let exitCode = 0;
    try {
        const root = path.join(__dirname, "../src/protyle");
        let source = ["render/mathRender.ts", "render/mathRenderSecurity.ts", "render/foldedContent.ts",
            "util/hasClosest.ts", "util/selectionOffsets.ts", "wysiwyg/getBlock.ts"].map(file => {
            const parsed = ts.createSourceFile(file, readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true);
            const statements = parsed.statements.filter(statement => !ts.isImportDeclaration(statement) &&
                (file !== "wysiwyg/getBlock.ts" || ts.isVariableStatement(statement) &&
                    statement.declarationList.declarations.some(declaration =>
                        ["hasNextSibling", "hasPreviousSibling"].includes(declaration.name.getText(parsed)))) &&
                (file !== "util/selectionOffsets.ts" || ts.isVariableStatement(statement) &&
                    statement.declarationList.declarations.some(declaration => declaration.name.getText(parsed) === "focusByRange")));
            return statements.map(statement => statement.getText(parsed)).join("\n").replace(/^export /gm, "");
        }).join("\n");
        const clicks = ts.createSourceFile("index.ts", readFileSync(path.join(root, "wysiwyg/index.ts"), "utf8"),
            ts.ScriptTarget.Latest, true);
        let caretSource;
        const visit = node => {
            if (ts.isBlock(node)) {
                node.statements.forEach((statement, index) => {
                    if (ts.isVariableStatement(statement) && statement.getText(clicks).includes(
                        'hasClosestByAttribute(newRange.startContainer, "data-type", "inline-math")')) {
                        const next = node.statements[index + 1];
                        assert.ok(ts.isIfStatement(next));
                        caretSource = statement.getText(clicks) + "\n" + next.getText(clicks);
                    }
                });
            }
            ts.forEachChild(node, visit);
        };
        visit(clicks);
        assert.ok(caretSource);
        source += "\nconst normalizeInlineMathCaret = (newRange: Range) => {" + caretSource + "};";
        const compiled = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2021}}).outputText;
        const css = require("sass").compile(path.join(__dirname, "../src/assets/scss/base.scss"), {
            logger: require("sass").Logger.silent,
        }).css;
        const katexRoot = path.join(__dirname, "../stage/protyle/js/katex");
        const html = path.join(process.argv[2], "test.html");
        writeFileSync(html, '<html><head><meta charset="utf-8"><link rel="stylesheet" href="' +
            require("node:url").pathToFileURL(path.join(katexRoot, "katex.min.css")) + '"><style>' + css +
            "body {margin:32px;font-size:16px} .protyle-wysiwyg {padding:0}</style><script src=\"" +
            require("node:url").pathToFileURL(path.join(__dirname, "../stage/protyle/js/lute/lute.min.js")) +
            "\"></script></head><body></body></html>");
        await win.loadFile(html);
        await win.webContents.executeJavaScript(`window.katex = require(${JSON.stringify(path.join(katexRoot, "katex.min.js"))}); true;`);
        win.webContents.debugger.attach("1.3");
        const send = params => win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", params);
        const drag = async (from, to, edge = false) => {
            await win.webContents.executeJavaScript("getSelection().removeAllRanges(); true;");
            await send({type: "mouseMoved", ...from});
            await send({type: "mousePressed", ...from, button: "left", clickCount: 1});
            for (let step = 1; step <= 15; step++) {
                await send({type: "mouseMoved", x: from.x + (to.x - from.x) * step / 15,
                    y: from.y + (to.y - from.y) * step / 15, button: "left", buttons: 1});
            }
            await send({type: "mouseReleased", ...to, button: "left", clickCount: 1});
            await new Promise(resolve => setTimeout(resolve, 30));
            const text = await win.webContents.executeJavaScript("getSelection().toString()");
            if (edge) {
                assert.match(text, /I[\s\S]*E/, JSON.stringify(text));
                const markdown = await win.webContents.executeJavaScript(`(() => {
                    const copy = document.createElement("div");
                    copy.append(getSelection().getRangeAt(0).cloneContents());
                    return Lute.New().BlockDOM2StdMd(copy.innerHTML);
                })()`);
                assert.ok(markdown.includes(String.raw`$I_{\mathrm{E}}$`), markdown);
                return;
            }
            assert.ok(text.startsWith("达复赛"), JSON.stringify(text));
            assert.ok(text.includes("你好你好111"), JSON.stringify(text));
        };
        for (const suffix of ["\n", "\u200b\n", "\ufeff\n", "\u200b\ufeff\n"]) {
            const points = await win.webContents.executeJavaScript(`(${setup.toString()})(${JSON.stringify(compiled)}, ${JSON.stringify(suffix)})`);
            await drag(points.end, points.before);
            await drag(points.before, points.after);
            await drag(points.after, points.before);
        }
        await win.webContents.executeJavaScript(`(${setup.toString()})(${JSON.stringify(compiled)}, "following text")`);
        assert.equal(await win.webContents.executeJavaScript(
            'document.querySelectorAll("[data-type=inline-math]")[1].lastChild.textContent'), "\ufeff");
        for (const mode of ["left", "right"]) {
            for (const direction of mode === "left" ? ["forward", "backward", "cross-line"] : ["forward", "cross-line"]) {
                const points = await win.webContents.executeJavaScript(`(${setupEdge.toString()})(${JSON.stringify(mode)})`);
                if (mode === "left") {
                    assert.ok(Math.abs(points.mathLeft - points.prefixLeft) < 1);
                    await drag(direction === "forward" ? points.left : direction === "backward" ? points.after : points.before,
                        direction === "backward" ? points.left : direction === "forward" ? points.mathEnd : points.after, true);
                    if (direction === "backward") {
                        assert.equal(await win.webContents.executeJavaScript("getSelection().direction"), "backward");
                    }
                } else {
                    assert.ok(points.mathLeft > points.prefixLeft + points.width - 30);
                    await drag(direction === "cross-line" ? points.after : points.before,
                        direction === "forward" ? points.right : points.before, true);
                }
            }
        }
        assert.deepEqual(await win.webContents.executeJavaScript(`(() => {
            const math = document.querySelector('[data-type="inline-math"]');
            const range = document.createRange();
            range.selectNodeContents(math.querySelector(".mathnormal"));
            range.collapse(true);
            getSelection().removeAllRanges();
            getSelection().addRange(range);
            window.mathSelectionAPI.normalizeInlineMathCaret(range);
            return {collapsed: getSelection().isCollapsed, outside: !math.contains(getSelection().anchorNode)};
        })()`), {collapsed: true, outside: true});
        const points = await win.webContents.executeJavaScript(`(${setupEdge.toString()})("right")`);
        await drag(points.before, points.right, true);
        assert.equal(await win.webContents.executeJavaScript(`document.execCommand("delete");
            document.querySelectorAll('[data-type="inline-math"]').length;`), 0);
        console.log("Inline math native selection cases passed");
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
    require("node:test").test("inline math permits native selection across paragraph-end boundary characters", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-math-selection-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Inline math native selection cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-math-selection-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
