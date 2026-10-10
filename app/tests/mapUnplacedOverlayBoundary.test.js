const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// 使用真实 Electron owner、IPC、sandbox preload 和 DOM；底图及记录仍为合成测试资源。
const run = async profile => {
    const {createHarness} = require("./fixtures/map-unplaced-overlay/harnessSupport.cjs");
    const f = await createHarness({profile, automate: true});
    const owner = source => f.owner.executeJavaScript(source);
    const waitFor = async (check, label) => {
        const deadline = Date.now() + 5000;
        while (!await check()) {
            assert.ok(Date.now() < deadline, label);
            await new Promise(resolve => setTimeout(resolve, 25));
        }
    };
    const open = async () => {
        await owner('document.getElementById("open").click()');
        await waitFor(() => f.manager.inspect()?.ready, "overlay becomes ready");
        const view = f.manager.inspect().view;
        await waitFor(() => view.getVisible(), "overlay becomes visible");
        return {view, contents: view.webContents, evaluate: source => view.webContents.executeJavaScript(source)};
    };
    try {
        f.win.focus();
        let overlay = await open();
        assert.equal(f.win.contentView.children.at(-1), overlay.view);
        assert.equal(await overlay.evaluate('document.getElementById("rows").children.length'), 50);
        assert.equal(await overlay.evaluate('document.querySelectorAll("img").length'), 0);
        assert.equal(await overlay.evaluate('document.getElementById("rows").textContent.includes("<img src=x")'), true);
        assert.equal(await overlay.evaluate("typeof require"), "undefined");
        assert.equal(await f.map.webContents.executeJavaScript('document.body.textContent.includes("PRIVATE_FIXTURE")'), false);
        const security = overlay.contents.getLastWebPreferences();
        assert.equal(security.sandbox, true);
        assert.equal(security.contextIsolation, true);
        assert.equal(security.nodeIntegration, false);
        assert.equal(security.webSecurity, true);
        assert.equal(await overlay.evaluate('fetch("http://127.0.0.1:6806/api/sql").then(() => false, () => true)'), true);
        assert.equal(await overlay.evaluate('fetch("https://tiles.openfreemap.org/private").then(() => false, () => true)'), true);
        await overlay.evaluate('document.getElementById("more").click()');
        await waitFor(() => overlay.evaluate('document.getElementById("rows").children.length === 100'), "pagination appends rows");
        await overlay.evaluate('const input = document.getElementById("search"); input.value = "合成记录 1"; input.dispatchEvent(new Event("input", {bubbles: true}));');
        await waitFor(() => overlay.evaluate('document.getElementById("count").textContent === "34"'), "search result replaces rows");
        await owner('document.getElementById("theme").click()');
        await waitFor(() => overlay.evaluate('document.documentElement.dataset.theme === "dark"'), "theme reaches trusted view");
        assert.equal(await overlay.evaluate('getComputedStyle(document.querySelector(".fixture-menu")).fontSize'), "24px");
        assert.equal(await overlay.evaluate('getComputedStyle(document.querySelector(".fixture-menu")).backgroundColor'), "rgb(41, 41, 41)");
        const before = overlay.view.getBounds();
        await owner('document.getElementById("scroll").scrollTop = 30');
        await waitFor(() => overlay.view.getBounds().y !== before.y, "anchor follows owner scroll");
        await owner('document.getElementById("zoom").click()');
        await waitFor(() => overlay.contents.getZoomFactor() === f.owner.getZoomFactor(), "overlay follows actual owner zoom");
        assert.equal(overlay.view.getVisible(), true);
        assert.deepEqual(f.mapVisible, [true]);
        overlay.contents.sendInputEvent({type: "keyDown", keyCode: "Escape"});
        await waitFor(() => !f.manager.inspect(), "escape destroys overlay");
        await waitFor(() => owner('document.activeElement.id === "open"'), "escape restores owner focus");
        assert.equal(overlay.contents.isDestroyed(), true);
        overlay = await open();
        await owner('document.getElementById("open").click()');
        await waitFor(() => !f.manager.inspect(), "toggle closes once without reopening");
        overlay = await open();
        await owner('document.body.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}))');
        await waitFor(() => !f.manager.inspect(), "owner DOM outside closes overlay");
        assert.equal(f.events.at(-1).restore, false);
        overlay = await open();
        f.map.webContents.sendInputEvent({type: "mouseDown", x: 20, y: 20, button: "left", clickCount: 1});
        f.map.webContents.sendInputEvent({type: "mouseUp", x: 20, y: 20, button: "left", clickCount: 1});
        await waitFor(() => !f.manager.inspect(), "native map outside closes overlay");
        assert.equal(f.events.at(-1).restore, false);
        overlay = await open();
        await owner('document.getElementById("scroll").scrollTop = 180');
        await waitFor(() => !f.manager.inspect(), "fully clipped anchor destroys overlay");
        assert.equal(f.events.at(-1).reason, "anchor-hidden");
        assert.equal(f.events.at(-1).restore, false);
        await owner('document.getElementById("scroll").scrollTop = 0');
        overlay = await open();
        await owner('document.getElementById("permission").click()');
        await waitFor(() => !f.manager.inspect(), "permission revoke destroys overlay");
        assert.equal(overlay.contents.isDestroyed(), true);
        await owner('document.getElementById("permission").click()');
        overlay = await open();
        await f.owner.loadURL("about:blank");
        await waitFor(() => !f.manager.inspect(), "programmatic owner navigation destroys overlay");
        assert.equal(overlay.contents.isDestroyed(), true);
        assert.deepEqual(f.mapVisible, [true]);
    } finally { f.destroy(); }
};

if (process.versions.electron && process.type === "browser") {
    const {app} = require("electron");
    run(process.argv[2]).then(() => app.exit(0), error => { console.error(error); app.exit(1); });
} else {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("real Electron trusted unplaced overlay DOM, IPC, CSP, theme, focus and native outside clicks", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY
            ? "Requires a real display; synthetic Node tests do not validate IME, OFM overlap or production flicker" : false,
    }, async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-unplaced-overlay-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            await promisify(execFile)(require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 45000});
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
