const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const bindings = () => {
    const source = ts.createSourceFile("event.ts", readFileSync(path.join(__dirname,
        "../src/boot/globalEvent/event.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    const listeners = [];
    const visit = node => {
        if (ts.isCallExpression(node) && node.expression.getText(source) === "window.addEventListener") {
            const type = node.arguments[0]?.text;
            if ((type === "mousedown" && node.arguments[2]?.getText(source) === "true") ||
                (type === "mouseup" && node.getText(source).includes("goBack(app)"))) {
                listeners.push(node.getText(source));
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return ts.transpileModule(listeners.join(";\n"), {
        compilerOptions: {target: ts.ScriptTarget.ES2021},
    }).outputText;
};

const setup = source => {
    document.body.innerHTML = `<div id="editor" contenteditable="true" style="font:24px monospace">
        <p id="first">first position</p><p id="second">second position</p>
        <p id="third">third position</p><p id="fourth">fourth position</p></div>`;
    window.navigationCalls = [];
    window.editorMouseDowns = [];
    window.clicks = 0;
    window.hasHistory = true;
    const navigate = direction => {
        window.navigationCalls.push(direction);
        if (window.hasHistory) {
            getSelection().setPosition(document.getElementById(direction === "back" ? "second" : "first").firstChild, 2);
        }
    };
    Function("app", "goBack", "goForward", source)({}, () => navigate("back"), () => navigate("forward"));
    document.getElementById("editor").addEventListener("mousedown", event => {
        window.editorMouseDowns.push(event.button);
    });
    window.addEventListener("click", () => window.clicks++);
    window.selectionState = () => ({
        anchor: getSelection().anchorNode?.parentElement?.id,
        anchorOffset: getSelection().anchorOffset,
        focus: getSelection().focusNode?.parentElement?.id,
        focusOffset: getSelection().focusOffset,
    });
};

const run = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {offscreen: true}});
    let code = 0;
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(`(${setup.toString()})(${JSON.stringify(bindings())})`);
        win.webContents.debugger.attach("1.3");
        const evaluate = script => win.webContents.executeJavaScript(script);
        const send = params => win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", params);
        for (const button of [0, 1, 2]) {
            const result = await evaluate(`(() => {
                const event = new MouseEvent('mousedown', {button: ${button}, bubbles: true, cancelable: true});
                document.getElementById('fourth').dispatchEvent(event);
                return {prevented: event.defaultPrevented, received: window.editorMouseDowns.at(-1)};
            })()`);
            assert.deepEqual(result, {prevented: false, received: button});
        }
        for (const [button, buttons, direction] of [["back", 8, "back"], ["forward", 16, "forward"]]) {
            for (const selection of [false, true]) {
                for (const hasHistory of [false, true]) {
                    const before = await evaluate(`(() => {
                        document.getElementById('editor').focus();
                        const third = document.getElementById('third').firstChild;
                        getSelection().setBaseAndExtent(third, ${selection ? 9 : 3}, third, 3);
                        window.navigationCalls = [];
                        window.editorMouseDowns = [];
                        window.hasHistory = ${hasHistory};
                        return window.selectionState();
                    })()`);
                    const point = await evaluate(`(() => {
                        const rect = document.getElementById('fourth').getBoundingClientRect();
                        return {x: rect.left + 50, y: rect.top + rect.height / 2};
                    })()`);
                    await send({type: "mouseMoved", ...point});
                    await send({type: "mousePressed", ...point, button, buttons, clickCount: 1});
                    assert.deepEqual(await evaluate("window.selectionState()"), before,
                        `${direction} preserves the caret or backward selection while held`);
                    assert.deepEqual(await evaluate("window.editorMouseDowns"), []);
                    assert.deepEqual(await evaluate("window.navigationCalls"), []);
                    await send({type: "mouseReleased", ...point, button, buttons: 0, clickCount: 1});
                    assert.deepEqual(await evaluate("window.navigationCalls"), [direction]);
                    assert.equal(await evaluate("window.clicks"), 0);
                    if (hasHistory) {
                        assert.equal((await evaluate("window.selectionState()")).anchor,
                            direction === "back" ? "second" : "first");
                    } else {
                        assert.deepEqual(await evaluate("window.selectionState()"), before);
                    }
                }
            }
        }
        const point = await evaluate(`(() => {
            const rect = document.getElementById('fourth').getBoundingClientRect();
            window.navigationCalls = [];
            return {x: rect.left + 50, y: rect.top + rect.height / 2};
        })()`);
        await send({type: "mouseMoved", ...point});
        await send({type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1});
        await send({type: "mouseReleased", ...point, button: "left", buttons: 0, clickCount: 1});
        assert.equal((await evaluate("window.selectionState()")).anchor, "fourth");
        assert.equal(await evaluate("window.clicks"), 1);
        assert.deepEqual(await evaluate("window.navigationCalls"), []);
        console.log("Mouse navigation cases passed");
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
    require("node:test").test("side buttons preserve selection until navigation and ordinary mouse buttons remain usable", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-mouse-navigation-test-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Mouse navigation cases passed/);
        } finally {
            assert.ok(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep));
            rmSync(profile, {recursive: true, force: true});
        }
    });
}
