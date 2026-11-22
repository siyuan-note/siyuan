const assert = require("node:assert/strict");
const {execFile} = require("node:child_process");
const {mkdtempSync, readFileSync, rmSync, writeFileSync} = require("node:fs");
const {tmpdir} = require("node:os");
const path = require("node:path");
const {test} = require("node:test");
const {promisify} = require("node:util");
const ts = require("typescript");

async function checkGestures(win, source) {
    const check = require("node:assert/strict");
    const web = win.webContents;
    const evaluate = script => web.executeJavaScript(script);
    await evaluate(`document.body.innerHTML = '<main><div class="agent-chat__msg" data-message-id="m"><div class="agent-chat__body">alpha bravo charlie</div><div class="agent-chat__msg-actions"></div></div></main>';
        window.siyuan = {languages: {agentQuoteText: "Quote text"}, zIndex: 1};
        const messages = document.querySelector("main"), body = messages.querySelector(".agent-chat__body");
        const mod = {};
        new Function("exports", "require", ${JSON.stringify(source)})(mod, () => ({getTopBarHeight: () => 0, setPosition() {}}));
        const dispose = mod.bindSelectionQuote(messages, (msg, text) => window.quoted = text);
        const button = () => document.querySelector(".agent-chat__selection-quote");
        const select = (start, end) => { getSelection().setBaseAndExtent(body.firstChild, start, body.firstChild, end); document.dispatchEvent(new Event("selectionchange")); };
        const touch = (type, target) => target.dispatchEvent(new TouchEvent(type, {bubbles: true}));`);
    await evaluate(`const mouse = (target, type) => target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, button: 0, pointerType: "mouse", pointerId: 1, isPrimary: true,
    }));
    mouse(body, "pointerdown"); select(0, 5); select(0, 11)`);
    check.equal(await evaluate("!!button()"), false);
    await evaluate('mouse(document, "pointerup")');
    check.equal(await evaluate("button().click(); window.quoted"), "alpha bravo");

    await evaluate(`const touchPointer = type => body.dispatchEvent(new PointerEvent(type, {
        bubbles: true, button: 0, pointerType: "touch", pointerId: 7, isPrimary: true,
    }));
    touchPointer("pointerdown"); touch("touchstart", body); touchPointer("pointercancel"); select(0, 5); select(6, 11)`);
    check.equal(await evaluate("!!button()"), false);
    await evaluate('touch("touchend", document)');
    check.equal(await evaluate("button().click(); window.quoted"), "bravo");
    await evaluate('touch("touchstart", body); select(0, 0); touch("touchend", document)');
    check.equal(await evaluate("!!button()"), false);
    check.equal(await evaluate("select(0, 5); button().click(); window.quoted"), "alpha");
    await evaluate("dispose()");
}

test("agent selection quotes wait for mouse or touch release and follow keyboard selections", async () => {
    const source = ts.transpileModule(readFileSync("src/layout/dock/agent/selectionQuote.ts", "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-selection-quote-"));
    const script = path.join(temporary, "test.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
        app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
        app.commandLine.appendSwitch("disable-gpu");
        app.whenReady().then(async () => {
            const win = new BrowserWindow({show: false, webPreferences: {backgroundThrottling: false}});
            await win.loadURL("data:text/html,<body></body>");
            await (${checkGestures.toString()})(win, ${JSON.stringify(source)});
            console.log("gestures passed");
            app.exit(0);
        }).catch(error => { console.error(error); app.exit(1); });`);
    const env = {...process.env, XDG_CACHE_HOME: path.join(temporary, "cache")};
    delete env.ELECTRON_RUN_AS_NODE;
    const args = process.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY ? ["--ozone-platform=headless", script] : [script];
    try {
        const result = await promisify(execFile)(require("electron"), args, {env, timeout: 30000, windowsHide: true});
        assert.match(result.stdout, /gestures passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        rmSync(temporary, {recursive: true, force: true});
    }
});
