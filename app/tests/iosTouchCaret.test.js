const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const rendererSource = () => {
    const ts = require("typescript");
    const read = name => readFileSync(path.join(__dirname, "../src/protyle", `${name}.ts`), "utf8");
    const selection = ts.createSourceFile("selectionOffsets.ts", read("util/selectionOffsets"), ts.ScriptTarget.Latest, true);
    const focus = selection.statements.find(statement => ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(declaration => declaration.name.getText(selection) === "focusByRange"));
    assert.ok(focus);
    const source = "const Constants = {SIZE_DRAG_THRESHOLD: 5, TIMEOUT_LONGPRESS: 460};\n" +
        "const revealTabsForTarget = () => {};\n" + focus.getText(selection) + "\n" +
        ["wysiwyg/compositionInput", "wysiwyg/touchNavigation", "wysiwyg/touchCaret"].map(name => {
            const parsed = ts.createSourceFile(name + ".ts", read(name), ts.ScriptTarget.Latest, true);
            return parsed.statements.filter(statement => !ts.isImportDeclaration(statement))
                .map(statement => statement.getText(parsed)).join("\n");
        }).join("\n");
    return ts.transpileModule(source, {compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021,
    }}).outputText;
};

const runCases = async () => {
    const check = require("node:assert/strict");
    const {bindIOSTouchCaret} = window.touchCaret;
    const selection = document.getSelection();
    let time = 1000;
    const originalNow = Date.now;
    Date.now = () => time;
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const errors = [];
    const onError = event => errors.push(event.message);
    window.addEventListener("error", onError);
    let cases = 0;
    const fixture = (focused = true) => {
        document.body.innerHTML = `<div class="protyle-wysiwyg" contenteditable="false" style="font: 20px monospace">
            <div data-node-id="one"><div contenteditable="true">97997974949464649</div></div>
            <div data-node-id="two"><div contenteditable="true">点击定位文字</div></div>
        </div><input id="outside">`;
        const root = document.querySelector(".protyle-wysiwyg");
        const editable = root.querySelector('[contenteditable="true"]');
        const text = editable.firstChild;
        let enabled = true;
        const dispose = bindIOSTouchCaret(root, () => enabled);
        const place = (offset, node = text, end = offset) => {
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, end);
            selection.removeAllRanges();
            selection.addRange(range);
        };
        const pointAt = (offset, node = text) => {
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            const rect = range.getBoundingClientRect();
            return {clientX: rect.left + 0.1, clientY: (rect.top + rect.bottom) / 2};
        };
        const send = (type, point, target = editable, options = {}) => {
            const touch = new Touch({identifier: 1, target, ...point});
            const event = new TouchEvent(type, {bubbles: true, cancelable: true,
                touches: type === "touchend" || type === "touchcancel" ? [] : [touch], changedTouches: [touch], ...options});
            Object.defineProperty(event, "timeStamp", {value: time});
            target.dispatchEvent(event);
            return event;
        };
        const tap = (offset, target = editable, node = text) => {
            const point = pointAt(offset, node);
            send("touchstart", point, target);
            return send("touchend", point, target);
        };
        const caret = (offset, node = text) => {
            check.equal(selection.isCollapsed, true);
            check.equal(selection.anchorNode, node);
            check.equal(selection.anchorOffset, offset);
        };
        if (focused) {
            editable.focus();
            place(text.length);
        } else {
            selection.removeAllRanges();
        }
        return {root, editable, text, place, pointAt, send, tap, caret, dispose,
            disable: () => { enabled = false; }};
    };
    const run = async (callback, focused = true) => {
        time += 1000;
        const f = fixture(focused);
        try {
            await callback(f);
            cases++;
        } finally {
            f.dispose();
        }
    };
    try {
        await run(async f => {
            check.equal(selection.rangeCount, 0);
            f.tap(4);
            check.equal(document.activeElement, f.editable);
            f.caret(4);
            await nextFrame();
            f.caret(4);
            time += 100;
            f.tap(4);
            await nextFrame();
            check.equal(selection.toString(), f.text.textContent);
        }, false);
        await run(async f => {
            f.disable();
            f.tap(4);
            await nextFrame();
            check.equal(document.activeElement, document.body);
            check.equal(selection.rangeCount, 0);
        }, false);
        await run(async f => {
            const point = f.pointAt(4);
            f.send("touchstart", point);
            f.root.style.marginTop = "100px";
            f.send("touchend", point);
            await nextFrame();
            f.caret(4);
        }, false);
        await run(async f => {
            const point = f.pointAt(4);
            f.send("touchstart", point);
            f.root.style.paddingTop = "100px";
            f.send("touchend", point);
            await nextFrame();
            time += 100;
            f.send("touchstart", point, f.root);
            f.send("touchend", point, f.root);
            await nextFrame();
            check.equal(selection.toString(), f.text.textContent);
        }, false);
        await run(async f => {
            const point = f.pointAt(4);
            f.send("touchstart", point);
            f.root.style.paddingTop = "100px";
            f.send("touchend", point);
            await nextFrame();
            f.editable.blur();
            selection.removeAllRanges();
            const event = new MouseEvent("click", {bubbles: true, cancelable: true, detail: 1, ...point});
            f.root.dispatchEvent(event);
            check.equal(event.defaultPrevented, true);
            await nextFrame();
            check.equal(document.activeElement, f.editable);
            f.caret(4);
        }, false);
        await run(async f => {
            f.text.textContent = "alpha beta";
            const character = document.createRange();
            character.setStart(f.text, 4);
            character.setEnd(f.text, 5);
            const rect = character.getBoundingClientRect();
            const point = {clientX: rect.right - 0.1, clientY: (rect.top + rect.bottom) / 2};
            f.send("touchstart", point);
            f.send("touchend", point);
            await nextFrame();
            time += 100;
            f.send("touchstart", point);
            f.send("touchend", point);
            await nextFrame();
            check.equal(selection.toString(), "alpha");
        });
        await run(async f => {
            f.tap(4);
            await nextFrame();
            let changed = new Promise(resolve => document.addEventListener("selectionchange", resolve, {once: true}));
            f.place(f.text.length);
            await changed;
            await nextFrame();
            f.caret(4);
            time += 100;
            f.tap(4);
            await nextFrame();
            changed = new Promise(resolve => document.addEventListener("selectionchange", resolve, {once: true}));
            f.place(f.text.length);
            await changed;
            await nextFrame();
            check.equal(selection.toString(), f.text.textContent);
        });
        await run(async f => {
            f.editable.innerHTML = "hel<b>lo</b> world";
            const target = f.editable.querySelector("b");
            const text = target.firstChild;
            f.tap(1, target, text);
            await nextFrame();
            time += 100;
            f.tap(1, target, text);
            await nextFrame();
            check.equal(selection.toString(), "hello");
        });
        await run(async f => {
            const editable = f.root.querySelectorAll('[contenteditable="true"]')[1];
            const text = editable.firstChild;
            f.tap(2, editable, text);
            await nextFrame();
            time += 100;
            f.tap(2, editable, text);
            await nextFrame();
            check.ok(selection.toString().includes("定"));
            check.ok(editable.contains(selection.anchorNode));
            check.ok(editable.contains(selection.focusNode));
        }, false);
        await run(async f => {
            f.text.textContent = "a 😀 b";
            f.tap(2);
            await nextFrame();
            time += 100;
            f.tap(2);
            await nextFrame();
            check.equal(selection.toString(), "😀");
        });
        await run(async f => {
            f.text.textContent = "hel";
            f.editable.insertAdjacentHTML("beforeend", "<span data-type='a'>lo</span>");
            f.tap(1);
            await nextFrame();
            time += 100;
            f.tap(1);
            await nextFrame();
            check.equal(selection.isCollapsed, true);
        });
        await run(async f => {
            check.equal(f.tap(4).defaultPrevented, false);
            f.place(f.text.length);
            await nextFrame();
            f.caret(4);
            // 快速点击不同字符时，不能将第二次定位误判为双击。
            time += 100;
            f.tap(11);
            f.place(f.text.length);
            await nextFrame();
            f.caret(11);
        });
        await run(async f => {
            const editable = f.root.querySelectorAll('[contenteditable="true"]')[1];
            const text = editable.firstChild;
            f.tap(2, editable, text);
            editable.focus();
            f.place(text.length, text);
            await nextFrame();
            f.caret(2, text);
        });
        await run(async f => {
            f.root.setAttribute("contenteditable", "true");
            f.root.focus();
            f.tap(4);
            f.place(f.text.length);
            await nextFrame();
            f.caret(4);
        });
        await run(async f => {
            const point = f.pointAt(4);
            f.tap(4);
            await nextFrame();
            f.place(f.text.length);
            time += 100;
            f.editable.dispatchEvent(new MouseEvent("click", {bubbles: true, detail: 1, ...point}));
            await nextFrame();
            f.caret(4);
        });
        await run(async f => {
            f.tap(4);
            await nextFrame();
            time += 100;
            f.tap(4);
            f.place(0, f.text, f.text.length);
            await nextFrame();
            check.equal(selection.toString(), f.text.textContent);
        });
        await run(async f => {
            f.tap(4);
            f.place(2, f.text, 6);
            await nextFrame();
            check.equal(selection.toString(), f.text.textContent.slice(2, 6));
        });
        for (const kind of ["longpress", "scroll", "cancel", "multitouch"]) {
            await run(async f => {
                const point = f.pointAt(4);
                f.send("touchstart", point);
                if (kind === "longpress") {
                    time += 500;
                } else if (kind === "scroll") {
                    f.send("touchmove", {...point, clientY: point.clientY + 10});
                } else if (kind === "cancel") {
                    f.send("touchcancel", point);
                } else {
                    const touch = new Touch({identifier: 2, target: f.editable, ...point});
                    f.send("touchstart", point, f.editable, {touches: [touch, touch]});
                }
                f.send("touchend", point);
                await nextFrame();
                f.caret(f.text.length);
            });
        }
        for (const kind of ["disabled", "removed", "outside", "disposed", "beforeinput", "keydown", "scroll"]) {
            await run(async f => {
                f.tap(4);
                if (kind === "disabled") {
                    f.disable();
                } else if (kind === "removed") {
                    f.editable.remove();
                } else if (kind === "outside") {
                    document.getElementById("outside").focus();
                } else if (kind === "disposed") {
                    f.dispose();
                } else {
                    f.editable.dispatchEvent(new Event(kind, {bubbles: true}));
                }
                const node = selection.anchorNode;
                const offset = selection.anchorOffset;
                await nextFrame();
                check.equal(selection.anchorNode, node);
                check.equal(selection.anchorOffset, offset);
            });
        }
        await run(async f => {
            f.editable.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
            f.tap(4);
            await nextFrame();
            f.caret(f.text.length);
            f.editable.dispatchEvent(new InputEvent("input", {bubbles: true, isComposing: false, inputType: "insertText"}));
            time += 1000;
            f.tap(4);
            await nextFrame();
            f.caret(4);
        });
        for (const markup of ["<a href='#'>link</a>", "<span data-type='block-ref'>reference</span>",
            "<span data-type='inline-math'>math</span>", "<span contenteditable='false'>readonly</span>"]) {
            await run(async f => {
                f.editable.insertAdjacentHTML("beforeend", markup);
                const target = f.editable.lastElementChild;
                const point = f.pointAt(4);
                f.send("touchstart", point, target);
                f.send("touchend", point, target);
                await nextFrame();
                f.caret(f.text.length);
            });
        }
        await run(async f => {
            const caretRangeFromPoint = document.caretRangeFromPoint;
            try {
                document.caretRangeFromPoint = () => null;
                f.tap(4);
                await nextFrame();
                f.caret(f.text.length);
            } finally {
                document.caretRangeFromPoint = caretRangeFromPoint;
            }
        });
        await run(async f => {
            const text = f.root.querySelectorAll('[contenteditable="true"]')[1].firstChild;
            const point = f.pointAt(2, text);
            f.send("touchstart", point);
            f.send("touchend", point);
            await nextFrame();
            f.caret(f.text.length);
        });
        await nextFrame();
        check.deepEqual(errors, []);
        return cases;
    } finally {
        Date.now = originalNow;
        window.removeEventListener("error", onError);
    }
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    // 字符坐标和原生选区校正依赖实际渲染帧，测试窗口保持可见。
    const win = new BrowserWindow({show: true, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    let exitCode = 0;
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(`window.touchCaret = {};
            new Function("exports", ${JSON.stringify(rendererSource())})(window.touchCaret);`);
        const cases = await win.webContents.executeJavaScript(`(${runCases.toString()})()`);
        console.log(`iOS touch caret: ${cases} DOM cases passed`);
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
    require("node:test").test("places iOS short-tap carets at character coordinates and preserves native selection gestures", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-ios-touch-caret-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /iOS touch caret: 35 DOM cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-ios-touch-caret-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
