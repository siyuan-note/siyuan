const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const runCases = sources => {
    const assert = require("node:assert/strict");
    const setup = (rich = true, resize = false, sidebarSwipe = true) => {
        document.body.innerHTML = `<div class="side-mask fn__none"></div><div id="sidebar"></div>
<div id="sidebarRight"></div><div id="keyboardToolbar" class="fn__none"></div>
<div class="protyle-wysiwyg" style="width:360px;padding:0">
<div class="av" data-type="NodeAttributeView" data-node-id="database" data-av-type="table">
<div class="av__container"><div class="av__scroll"><div class="av__body" style="float:left">
<div class="av__row"><div class="av__cell" data-dtype="text" style="width:1000px">
<div class="av__celltext${rich ? " av__celltext--rich b3-typography" : ""}"><p><span id="target">Cell text</span></p></div>
<div class="av__widthdrag"><span></span></div></div></div></div></div></div></div></div>`;
        window.getSelection().removeAllRanges();
        window.siyuan = {mobile: {}, zIndex: 0};
        const actions = [];
        const dependencies = {
            "./sidebar": {
                getSidebarElement: side => document.getElementById(side === "left" ? "sidebar" : "sidebarRight"),
                getSidebarDock: () => ({}),
                popSidebar: side => actions.push(`open:${side}`),
            },
            "./mobileBarsConfig": {getMobileSidebarConfig: () => ({sidebarSwipe})},
            "./closePanel": {closePanel: () => actions.push("close"), showPanelMask: () => {
                actions.push("mask");
                document.querySelector(".side-mask").classList.remove("fn__none");
            }},
            "./keyboardToolbar": {activeBlur() {}, resetAndroidBoundedSelectionGesture() {}},
            "../../protyle/util/compatibility": {isInHarmony: () => false, isInAndroid: () => false, isIPhone: () => true},
            "../editor": {getCurrentEditor: () => undefined},
            "../../constants": {Constants: {SIZE_DRAG_THRESHOLD: 5, TIMEOUT_LONGPRESS: 500, TIMEOUT_MULTIPLE_SELECT: 500}},
        };
        const load = name => {
            if (!dependencies[name]) {
                const exports = {};
                new Function("exports", "require", sources[name])(exports, id => sources[id] ? load(id) : dependencies[id] || {});
                dependencies[name] = exports;
            }
            return dependencies[name];
        };
        const handlers = load("touch");
        const target = document.querySelector(resize ? ".av__widthdrag span" : "#target");
        const block = document.querySelector(".av");
        const scroll = document.querySelector(".av__scroll");
        scroll.scrollLeft = 100;
        assert.ok(scroll.scrollWidth > scroll.clientWidth);
        if (rich && !resize) {
            assert.equal(load("../../protyle/util/hasClosest")
                .hasClosestByAttribute(target, "data-type", "NodeAttributeView"), false);
        }
        for (const [type, handler] of Object.entries({touchstart: "handleTouchStart", touchmove: "handleTouchMove",
            touchend: "handleTouchEnd", touchcancel: "handleTouchCancel"})) {
            block.addEventListener(type, handlers[handler], {passive: false});
        }
        const dispatch = (type, x = 180, y = 200, count = 1) => {
            const touches = Array.from({length: count}, (_, identifier) => new Touch({identifier, target, clientX: x, clientY: y}));
            const event = new TouchEvent(type, {bubbles: true, cancelable: true,
                touches: type === "touchend" || type === "touchcancel" ? [] : touches, changedTouches: touches});
            target.dispatchEvent(event);
            return event;
        };
        return {actions, scroll, dispatch};
    };
    for (const rich of [false, true]) {
        for (const x of [80, 280]) {
            const h = setup(rich);
            h.dispatch("touchstart");
            assert.equal(h.dispatch("touchmove", x).defaultPrevented, false, `${rich ? "rich" : "plain"} cell, x=${x}`);
            assert.deepEqual(h.actions, []);
            h.dispatch("touchend", x);
            assert.deepEqual(h.actions, ["close"]);
        }
    }
    for (const x of [80, 280]) {
        const h = setup();
        h.dispatch("touchstart");
        assert.equal(h.dispatch("touchmove", x).defaultPrevented, false);
        h.scroll.scrollLeft = x < 180 ? h.scroll.scrollWidth - h.scroll.clientWidth : 0;
        assert.equal(h.dispatch("touchmove", x).defaultPrevented, false);
        assert.deepEqual(h.actions, []);
        h.dispatch("touchend", x);
        assert.deepEqual(h.actions, ["close"]);
        // 内容抵达边缘后，同一手势继续滚动；重新起手才允许侧栏接管。
        h.dispatch("touchstart");
        assert.equal(h.dispatch("touchmove", x).defaultPrevented, true);
        h.dispatch("touchend", x);
        assert.deepEqual(h.actions, ["close", "mask", `open:${x < 180 ? "right" : "left"}`]);
    }
    const reverse = setup();
    reverse.dispatch("touchstart");
    reverse.dispatch("touchmove", 80);
    reverse.scroll.scrollLeft = reverse.scroll.scrollWidth - reverse.scroll.clientWidth;
    assert.equal(reverse.dispatch("touchmove", 280).defaultPrevented, false);
    reverse.dispatch("touchend", 280);
    assert.deepEqual(reverse.actions, ["close"]);

    const canceled = setup();
    canceled.dispatch("touchstart");
    canceled.dispatch("touchmove", 80);
    canceled.dispatch("touchcancel", 80);
    assert.deepEqual(canceled.actions, []);
    canceled.scroll.scrollLeft = 0;
    canceled.dispatch("touchstart");
    assert.equal(canceled.dispatch("touchmove", 280).defaultPrevented, true);
    canceled.dispatch("touchend", 280);
    assert.deepEqual(canceled.actions, ["mask", "open:left"]);

    for (const x of [80, 280]) {
        const resize = setup(true, true);
        resize.dispatch("touchstart");
        resize.dispatch("touchmove", x);
        resize.dispatch("touchend", x);
        resize.dispatch("touchcancel", x);
        assert.deepEqual(resize.actions, []);
    }
    const vertical = setup();
    vertical.dispatch("touchstart");
    assert.equal(vertical.dispatch("touchmove", 185, 300).defaultPrevented, false);
    vertical.dispatch("touchend", 185, 300);
    assert.deepEqual(vertical.actions, ["close"]);
    const disabled = setup(true, false, false);
    disabled.dispatch("touchstart");
    assert.equal(disabled.dispatch("touchmove", 80).defaultPrevented, false);
    disabled.dispatch("touchend", 80);
    assert.deepEqual(disabled.actions, []);
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, width: 600, height: 900,
        webPreferences: {nodeIntegration: true, contextIsolation: false}});
    let exitCode = 0;
    try {
        const ts = require("typescript");
        const files = {touch: "mobile/util/touch", "./touchPanelGesture": "mobile/util/touchPanelGesture",
            "./touchGesture": "mobile/util/touchGesture", "../../protyle/util/hasClosest": "protyle/util/hasClosest"};
        const sources = Object.fromEntries(Object.entries(files).map(([name, file]) => [name,
            ts.transpileModule(readFileSync(path.join(__dirname, `../src/${file}.ts`), "utf8"), {
                compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
            }).outputText]));
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.insertCSS(require("sass").compile(path.join(__dirname, "../src/assets/scss/mobile.scss"),
            {logger: {warn() {}}}).css);
        const error = await win.webContents.executeJavaScript(`(() => {
            try { (${runCases.toString()})(${JSON.stringify(sources)}); return ""; }
            catch (error) { return error.stack; }
        })()`);
        assert.equal(error, "");
        console.log("Mobile database swipe cases passed");
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
    require("node:test").test("mobile database swipes keep rich cell scrolling separate from sidebar gestures", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-mobile-db-swipe-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Mobile database swipe cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-mobile-db-swipe-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
