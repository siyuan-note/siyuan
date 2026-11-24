const assert = require("node:assert/strict");
const {execFile} = require("node:child_process");
const {mkdtempSync, readFileSync, rmSync, writeFileSync} = require("node:fs");
const {tmpdir} = require("node:os");
const path = require("node:path");
const {test} = require("node:test");
const {promisify} = require("node:util");
const ts = require("typescript");

function checkGestures(source) {
    document.body.innerHTML = "<style>.agent-chat__selection-quote {position: absolute}</style>" +
        '<aside style="position: absolute; top: 40px; left: 360px; width: 220px">' +
        '<div style="position: relative"><main style="height: 120px; overflow: auto">' +
        '<div class="agent-chat__msg" data-message-id="m"><div class="agent-chat__body">alpha bravo charlie</div>' +
        '<div class="agent-chat__msg-actions"></div></div></main></div></aside>';
    window.siyuan = {languages: {agentQuoteText: "Quote text"}};
    const panel = document.querySelector("aside");
    const messages = document.querySelector("main");
    const body = messages.querySelector(".agent-chat__body");
    const mod = {};
    new Function("exports", source)(mod);
    let quoted;
    const dispose = mod.bindSelectionQuote(messages, (msg, text) => { quoted = text; });
    const button = () => document.querySelector(".agent-chat__selection-quote");
    const equal = (actual, expected, stage) => {
        if (actual !== expected) {
            throw new Error(`${stage}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        }
    };
    const quote = (stage, expected) => {
        equal(!!button(), true, `${stage}: quote button visible`);
        button().click();
        equal(quoted, expected, stage);
    };
    const select = (start, end) => {
        getSelection().setBaseAndExtent(body.firstChild, start, body.firstChild, end);
        document.dispatchEvent(new Event("selectionchange"));
    };
    const pointer = (target, type, pointerType, pointerId) => target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, button: 0, pointerType, pointerId, isPrimary: true,
    }));
    // 模拟处理器读取的触点列表，不依赖桌面设备是否支持触摸。
    const touch = (target, type, touches = []) => {
        const event = new Event(type, {bubbles: true});
        Object.defineProperty(event, "touches", {value: touches});
        target.dispatchEvent(event);
    };
    try {
        pointer(body, "pointerdown", "mouse", 1);
        select(0, 5);
        select(0, 11);
        equal(!!button(), false, "mouse still down");
        pointer(document, "pointerup", "mouse", 1);
        quote("mouse selection", "alpha bravo");

        pointer(body, "pointerdown", "touch", 7);
        touch(body, "touchstart", [{}]);
        pointer(body, "pointercancel", "touch", 7);
        select(0, 5);
        select(6, 11);
        equal(!!button(), false, "touch still down after pointer cancellation");
        touch(document, "touchend", [{}]);
        equal(!!button(), false, "another touch still down");
        touch(document, "touchend");
        quote("touch selection", "bravo");

        touch(body, "touchstart", [{}]);
        select(0, 0);
        touch(document, "touchend");
        equal(!!button(), false, "collapsed selection");
        select(0, 5);
        const visible = button().getBoundingClientRect();
        equal(panel.contains(document.elementFromPoint(visible.left + 1, visible.top + 1)), true, "hover stays in the panel");
        equal(panel.contains(button()), true, "quote button belongs to the panel");
        panel.style.transform = "translateX(300px)";
        equal(button().getBoundingClientRect().left, visible.left + 300, "quote button follows the collapsing panel");
        panel.style.transform = "";
        quote("keyboard selection", "alpha");
    } finally {
        dispose();
    }
}

test("agent selection quotes wait for mouse or touch release and follow keyboard selections", async () => {
    const source = ts.transpileModule(readFileSync("src/layout/dock/agent/selectionQuote.ts", "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-selection-quote-"));
    const script = path.join(temporary, "test.cjs");
    const renderer = `(() => {
        try { (${checkGestures.toString()})(${JSON.stringify(source)}); return ""; }
        catch (error) { return error.stack || String(error); }
    })()`;
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
        app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
        app.commandLine.appendSwitch("disable-gpu");
        app.whenReady().then(async () => {
            const win = new BrowserWindow({show: false, width: 640, height: 480,
                webPreferences: {offscreen: true, backgroundThrottling: false}});
            await win.loadURL("data:text/html,<body></body>");
            const failure = await win.webContents.executeJavaScript(${JSON.stringify(renderer)});
            if (failure) throw new Error(failure);
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
