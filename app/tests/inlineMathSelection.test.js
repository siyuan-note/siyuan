const assert = require("node:assert/strict");
const {readFileSync, writeFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const setup = async (source, suffix) => {
    const dependencies = {
        addScript: () => Promise.resolve(), addStyle: () => {},
        Constants: {PROTYLE_CDN: "", ZWSP: "\u200b"}, looseJsonParse: JSON.parse,
        getHostCapabilities: () => ({remoteKernel: false}),
        genRenderFrame: () => { throw new Error("Unexpected block formula"); },
    };
    const mathRender = new Function(...Object.keys(dependencies), source + "\nreturn mathRender;")(
        ...Object.values(dependencies));
    window.siyuan = {config: {editor: {katexMacros: "{}"}}};
    window.Lute = {UnEscapeHTMLStr: value => value};
    document.body.innerHTML = '<div class="protyle-wysiwyg"><div data-node-id="20260929143659-b77z50y" ' +
        'data-type="NodeParagraph"><div contenteditable="true">发达复赛<span data-type="inline-math" ' +
        'data-subtype="math" contenteditable="false"></span>你好你好11111<span data-type="inline-math" ' +
        'data-subtype="math" contenteditable="false" data-content="M"></span></div></div></div>';
    const formulas = document.querySelectorAll('[data-type="inline-math"]');
    // 保留原始测试文档中的公式及段末边界字符，不能用重新解析的 Markdown 替代。
    formulas[0].dataset.content = String.raw`\sum\limits_{n=1}\limits^{n_{0}-1}\Delta(m,n)`;
    formulas[1].after(document.createTextNode(suffix));
    await mathRender(document.querySelector(".protyle-wysiwyg"));
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

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    const ts = require("typescript");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, width: 1000, height: 600,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false}});
    let exitCode = 0;
    try {
        const root = path.join(__dirname, "../src/protyle");
        const source = ["render/mathRender.ts", "render/mathRenderSecurity.ts", "render/foldedContent.ts",
            "util/hasClosest.ts", "wysiwyg/getBlock.ts"].map(file => {
            const parsed = ts.createSourceFile(file, readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true);
            const statements = parsed.statements.filter(statement => !ts.isImportDeclaration(statement) &&
                (file !== "wysiwyg/getBlock.ts" || ts.isVariableStatement(statement) &&
                    statement.declarationList.declarations.some(declaration =>
                        ["hasNextSibling", "hasPreviousSibling"].includes(declaration.name.getText(parsed)))));
            return statements.map(statement => statement.getText(parsed)).join("\n").replace(/^export /gm, "");
        }).join("\n");
        const compiled = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2021}}).outputText;
        const css = require("sass").compile(path.join(__dirname, "../src/assets/scss/base.scss"), {
            logger: require("sass").Logger.silent,
        }).css;
        const katexRoot = path.join(__dirname, "../stage/protyle/js/katex");
        const html = path.join(process.argv[2], "test.html");
        writeFileSync(html, '<html><head><meta charset="utf-8"><link rel="stylesheet" href="' +
            require("node:url").pathToFileURL(path.join(katexRoot, "katex.min.css")) + '"><style>' + css +
            "body {margin:32px;font-size:16px} .protyle-wysiwyg {padding:0}</style></head><body></body></html>");
        await win.loadFile(html);
        await win.webContents.executeJavaScript(`window.katex = require(${JSON.stringify(path.join(katexRoot, "katex.min.js"))}); true;`);
        win.webContents.debugger.attach("1.3");
        const send = params => win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", params);
        const drag = async (from, to) => {
            await win.webContents.executeJavaScript("getSelection().removeAllRanges(); true;");
            await send({type: "mouseMoved", ...from});
            await send({type: "mousePressed", ...from, button: "left", clickCount: 1});
            for (let step = 1; step <= 15; step++) {
                await send({type: "mouseMoved", x: from.x + (to.x - from.x) * step / 15,
                    y: from.y + (to.y - from.y) * step / 15, button: "left", buttons: 1});
            }
            await send({type: "mouseReleased", ...to, button: "left", clickCount: 1});
            const text = await win.webContents.executeJavaScript("getSelection().toString()");
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
