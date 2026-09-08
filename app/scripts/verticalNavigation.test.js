const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const rendererModules = () => {
    const ts = require("typescript");
    const root = path.join(__dirname, "../src/protyle");
    const modules = {};
    for (const name of ["verticalGeometry", "verticalVisibility", "verticalCaret"]) {
        modules[`./${name}`] = readFileSync(path.join(root, "wysiwyg", `${name}.ts`), "utf8");
    }
    // 使用实际选区函数；这些几何用例不挂载页签控制器。
    const selection = ts.createSourceFile("selection.ts",
        readFileSync(path.join(root, "util/selection.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    const names = ["setFirstNodeRange", "setLastNodeRange", "focusByRange"];
    modules["../util/selection"] = "const revealTabsForTarget = () => {};\n" + selection.statements.filter(statement =>
        ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration =>
            names.includes(declaration.name.getText(selection)))).map(statement => statement.getText(selection)).join("\n");
    return Object.fromEntries(Object.entries(modules).map(([name, source]) => [name,
        ts.transpileModule(source, {compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        }}).outputText]));
};

const runGeometryCases = async () => {
    const assert = require("node:assert/strict");
    const {ipcRenderer} = require("electron");
    const {focusEditableAtGoalX, isCaretAtVerticalBoundary, getCaretGoalX} = window.verticalCaret;
    const {getReachableVerticalRects} = window.verticalVisibility;
    const select = (node, offset) => {
        const range = document.createRange();
        range.setStart(node, offset);
        range.collapse(true);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        return range;
    };
    const setup = (text, whiteSpace = "pre", height = 320) => {
        document.body.innerHTML = `<div class="layout" style="height:${height}px;width:500px;overflow:hidden">
            <div class="protyle-content" style="height:100%;overflow:auto">
                <div class="protyle-wysiwyg" contenteditable="true" style="font:20px/30px monospace">
                    <div data-node-id="before"><div id="before">before</div></div>
                    <div data-node-id="code" class="code-block"><div class="hljs" style="overflow:auto;max-height:140px">
                        <div id="code" contenteditable="true" style="white-space:${whiteSpace};min-height:30px"></div>
                    </div></div>
                    <div data-node-id="after"><div id="after">after</div></div>
                </div>
            </div>
        </div>`;
        const code = document.getElementById("code");
        code.textContent = text;
        const content = document.querySelector(".protyle-content");
        const editor = document.querySelector(".protyle-wysiwyg");
        const before = document.getElementById("before");
        const after = document.getElementById("after");
        editor.addEventListener("keydown", event => {
            if (!["ArrowUp", "ArrowDown"].includes(event.key)) {
                return;
            }
            const range = getSelection().getRangeAt(0);
            const source = [before, code, after].find(element => element.contains(range.startContainer));
            const direction = event.key === "ArrowUp" ? "up" : "down";
            if (!source || !isCaretAtVerticalBoundary(source, range, direction)) {
                return;
            }
            const index = [before, code, after].indexOf(source) + (direction === "up" ? -1 : 1);
            const target = [before, code, after][index];
            if (target) {
                focusEditableAtGoalX(target, direction, getCaretGoalX(range), content);
                event.preventDefault();
            }
        });
        editor.focus();
        select(after.firstChild, 0);
        return {code, content, before, after, scroller: code.parentElement};
    };
    const press = key => ipcRenderer.invoke("vertical-navigation-key", key);
    let cases = 0;
    for (const whiteSpace of ["pre", "pre-wrap"]) {
        for (const text of ["\na\n", "a\nb\n\nc\n", "x\n\n", "\n", "\n\n\n"]) {
            const {code, content} = setup(text, whiteSpace);
            const starts = [0];
            for (let offset = 0; offset < text.length - 1; offset++) {
                if (text[offset] === "\n") {
                    starts.push(offset + 1);
                }
            }
            for (const [index, offset] of starts.entries()) {
                const range = select(code.firstChild, offset);
                assert.equal(isCaretAtVerticalBoundary(code, range, "up"), index === 0,
                    `${whiteSpace} ${JSON.stringify(text)} offset ${offset} up`);
                assert.equal(isCaretAtVerticalBoundary(code, range, "down"), index === starts.length - 1,
                    `${whiteSpace} ${JSON.stringify(text)} offset ${offset} down`);
            }
            for (const direction of ["up", "down"]) {
                assert.equal(focusEditableAtGoalX(code, direction, 40, content), true, `enter ${JSON.stringify(text)}`);
                assert.equal(isCaretAtVerticalBoundary(code, getSelection().getRangeAt(0),
                    direction === "up" ? "down" : "up"), true);
                assert.ok(getSelection().anchorOffset < text.length);
            }
            cases++;
        }
        const {code, before, after} = setup("x\n\n", whiteSpace);
        await press("Up");
        assert.equal(getSelection().anchorNode, code.firstChild, `first up ${whiteSpace}`);
        assert.equal(getSelection().anchorOffset, 2);
        await press("Up");
        assert.equal(getSelection().anchorNode, code.firstChild,
            `second up ${whiteSpace}: ${getSelection().anchorNode.parentElement.outerHTML}, ${getSelection().anchorOffset}`);
        assert.ok(getSelection().anchorOffset <= 1);
        await press("Up");
        assert.equal(getSelection().anchorNode, before.firstChild, `third up ${whiteSpace}`);
        await press("Down");
        await press("Down");
        assert.equal(getSelection().anchorNode, code.firstChild);
        assert.equal(isCaretAtVerticalBoundary(code, getSelection().getRangeAt(0), "down"), true);
        await press("Down");
        assert.equal(getSelection().anchorNode, after.firstChild);
        cases++;
    }
    for (const whiteSpace of ["pre", "pre-wrap"]) {
        for (const markup of ["<span>a\nb\n</span><span>\nc\n</span>", "<span>a\nb\n\nc</span>\n"]) {
            const {code, content} = setup("", whiteSpace);
            code.innerHTML = markup;
            const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
            let offset = 4;
            let node = walker.nextNode();
            while (node && offset > node.textContent.length) {
                offset -= node.textContent.length;
                node = walker.nextNode();
            }
            const range = select(node, offset);
            assert.equal(isCaretAtVerticalBoundary(code, range, "up"), false, markup);
            assert.equal(isCaretAtVerticalBoundary(code, range, "down"), false, markup);
            assert.equal(focusEditableAtGoalX(code, "up", 40, content), true);
            cases++;
        }
        const {code, content} = setup("", whiteSpace);
        code.innerHTML = "<span>x\n</span><span>\n</span>";
        const range = select(code.firstChild.firstChild, 2);
        assert.equal(isCaretAtVerticalBoundary(code, range, "up"), false);
        assert.equal(isCaretAtVerticalBoundary(code, range, "down"), true);
        assert.equal(focusEditableAtGoalX(code, "up", 40, content), true);
        assert.equal(isCaretAtVerticalBoundary(code, getSelection().getRangeAt(0), "up"), false);
        cases++;
    }
    for (const height of [180, 320]) {
        for (const direction of ["up", "down"]) {
            const {code, content, scroller} = setup(Array.from({length: 30}, (_, i) => `line ${i}`).join("\n") + "\n",
                "pre", height);
            scroller.scrollTop = direction === "down" ? scroller.scrollHeight : 0;
            content.scrollTop = direction === "down" ? content.scrollHeight : 0;
            assert.equal(focusEditableAtGoalX(code, direction, 40, content), true, `nested scroll ${height} ${direction}`);
            assert.equal(isCaretAtVerticalBoundary(code, getSelection().getRangeAt(0),
                direction === "up" ? "down" : "up"), true);
            assert.ok(direction === "up" ? scroller.scrollTop > 0 : scroller.scrollTop < 30);
            cases++;
        }
    }
    for (const font of ["14px/23px monospace", "28px/46px monospace"]) {
        const {code, content, scroller} = setup(`${"wrapped ".repeat(30)}\n\n`, "pre-wrap");
        code.style.font = font;
        const goalX = scroller.getBoundingClientRect().right - 25;
        assert.equal(focusEditableAtGoalX(code, "down", goalX, content), true);
        assert.equal(isCaretAtVerticalBoundary(code, getSelection().getRangeAt(0), "up"), true);
        const contentRange = document.createRange();
        contentRange.selectNodeContents(code);
        const firstLine = contentRange.getClientRects()[0];
        const expectedX = Math.max(firstLine.left, Math.min(goalX, firstLine.right));
        assert.ok(Math.abs(getSelection().getRangeAt(0).getBoundingClientRect().left - expectedX) < parseFloat(font),
            `${font}: goal ${goalX}, caret ${getSelection().getRangeAt(0).getBoundingClientRect().left}, offset ${getSelection().anchorOffset}`);
        assert.equal(focusEditableAtGoalX(code, "up", goalX, content), true);
        assert.equal(isCaretAtVerticalBoundary(code, getSelection().getRangeAt(0), "up"), false);
        assert.equal(isCaretAtVerticalBoundary(code, getSelection().getRangeAt(0), "down"), true);
        cases++;
    }
    {
        const {code, content} = setup("");
        for (const direction of ["up", "down"]) {
            assert.equal(focusEditableAtGoalX(code, direction, 40, content), true);
            assert.equal(isCaretAtVerticalBoundary(code, getSelection().getRangeAt(0), direction), true);
        }
        assert.equal(code.innerHTML, "");
        cases++;
    }
    for (const direction of ["up", "down"]) {
        const text = direction === "down" ? `x\n${"long".repeat(200)}\n` : `${"long".repeat(200)}\nx\n`;
        const {code, content, scroller} = setup(text);
        scroller.scrollLeft = 1000;
        assert.equal(focusEditableAtGoalX(code, direction, 40, content), true, `horizontal scroll ${direction}`);
        assert.equal(scroller.scrollLeft, 0);
        cases++;
    }
    {
        const {code, content, scroller} = setup(`${"long".repeat(200)}\nlast\n`);
        scroller.scrollLeft = 1000;
        assert.equal(focusEditableAtGoalX(code, "down", 100, content), true);
        assert.equal(scroller.scrollLeft, 1000);
        assert.ok(Math.abs(getSelection().getRangeAt(0).getBoundingClientRect().left - 100) < 10);
        cases++;
    }
    for (const style of ["display:none", "visibility:hidden", "height:0;overflow:hidden", "height:0;overflow:clip"]) {
        const {code, content, after} = setup("hidden\n");
        code.parentElement.setAttribute("style", style);
        assert.equal(focusEditableAtGoalX(code, "up", 40, content), false, style);
        assert.equal(getSelection().anchorNode, after.firstChild);
        cases++;
    }
    const {code, content, after} = setup("folded\n");
    code.closest(".code-block").setAttribute("fold", "1");
    assert.equal(focusEditableAtGoalX(code, "down", 40, content), false);
    assert.equal(getSelection().anchorNode, after.firstChild);
    const range = document.createRange();
    range.selectNodeContents(code);
    code.closest(".code-block").removeAttribute("fold");
    code.parentElement.style.marginTop = "600px";
    content.style.overflow = "hidden";
    assert.deepEqual(getReachableVerticalRects(code, Array.from(range.getClientRects())), []);
    assert.equal(focusEditableAtGoalX(code, "down", 40, content), false);
    cases++;
    return cases;
};

const runElectron = async () => {
    const {app, BrowserWindow, ipcMain} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, width: 1000, height: 800, webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        backgroundThrottling: false,
    }});
    ipcMain.handle("vertical-navigation-key", async (event, keyCode) => {
        const key = `Arrow${keyCode}`;
        const code = keyCode === "Up" ? 38 : 40;
        await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
            type: "keyDown", key, code: key, windowsVirtualKeyCode: code,
        });
        await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
            type: "keyUp", key, code: key, windowsVirtualKeyCode: code,
        });
    });
    let exitCode = 0;
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        win.webContents.debugger.attach("1.3");
        await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {enabled: true});
        await win.webContents.executeJavaScript(`(() => {
            const sources = ${JSON.stringify(rendererModules())};
            const cache = {};
            const load = name => {
                if (!cache[name]) {
                    cache[name] = {};
                    new Function("require", "exports", sources[name])(load, cache[name]);
                }
                return cache[name];
            };
            window.verticalCaret = load("./verticalCaret");
            window.verticalVisibility = load("./verticalVisibility");
        })()`);
        const cases = await win.webContents.executeJavaScript(`(${runGeometryCases.toString()})()`);
        console.log(`Vertical navigation: ${cases} Electron geometry cases passed`);
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
    const {it} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    it("keeps vertical caret lines and scroll reachability consistent in Electron", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-navigation-"));
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile], {
                env,
                windowsHide: true,
                timeout: 40000,
            });
            assert.match(stdout, /Electron geometry cases passed/);
        } finally {
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
