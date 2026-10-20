import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserFixture = (bridgeSource: string, coreSource: string, gutterVisibilitySource: string,
                        keyboardSource: string, touchSelectionSource: string) => {
    document.body.innerHTML = `<style>
body{margin:0}.protyle-wysiwyg{padding-left:50px}.block{height:100px;padding:12px;box-sizing:border-box}
.protyle-gutters{position:fixed;left:0;top:20px;width:32px;user-select:none}
.protyle-gutters button{display:block;position:relative;width:32px;height:50px;padding:0}
.protyle-gutters span{position:absolute;inset:0;touch-action:none}
.protyle-gutters[data-scrollable=true] span{touch-action:pan-y}
.protyle-gutters--dragging{pointer-events:none;opacity:0}
</style><div class="protyle"><div class="protyle-wysiwyg" contenteditable="false">
<div id="source" class="block"><div contenteditable="true">Heading with an existing editor selection</div></div>
<div id="target" class="block"><div contenteditable="true">Paragraph below the heading</div></div>
</div><div class="protyle-gutters"><button><span draggable="true"></span></button></div></div>`;
    const source = document.getElementById("source");
    const target = document.getElementById("target");
    const gutter = document.querySelector<HTMLElement>(".protyle-gutters");
    const handle = gutter.querySelector<HTMLElement>("span");
    const state = {starts: 0, drops: 0, ends: 0, clicks: 0, sourceText: ""};
    window.siyuan = {touchDragActive: false, touchDragGhost: null, zIndex: 1} as typeof window.siyuan;
    const core = {} as typeof import("./touchDragBridgeCore");
    new Function("exports", coreSource)(core);
    const visibility = {} as typeof import("../protyle/ui/gutterVisibility");
    new Function("exports", gutterVisibilitySource)(visibility);
    const touchSelection = {} as typeof import("../mobile/util/touchSelection");
    new Function("exports", touchSelectionSource)(touchSelection);
    const keyboardDependencies = {
        ...visibility, ...touchSelection,
        inlineMathSelection: {reset() {}}, preventKeyboardToolbarRender() {}, hideKeyboardToolbar() {},
        restoreRecentAndroidTableCellSelectAll: () => false,
        getCurrentEditor: () => ({protyle: {gutter: {element: gutter},
            wysiwyg: {element: document.querySelector(".protyle-wysiwyg")}}}),
        getSelection: () => document.getSelection(), hideElements() {},
        stripSemanticMarkersFromRangeText: (range: Range) => range.toString(),
        keyboardPanelTop: undefined as number | undefined,
    };
    const hideKeyboard = new Function(...Object.keys(keyboardDependencies),
        `${keyboardSource}\nreturn hideKeyboardToolbarByApp;`)(...Object.values(keyboardDependencies));
    const bridge = {} as typeof import("./touchDragBridge");
    new Function("exports", "require", bridgeSource)(bridge, (id: string) => {
        if (id === "./touchDragBridgeCore") {
            return core;
        }
        if (id === "../protyle/ui/gutterVisibility") {
            return visibility;
        }
        return {Constants: {SIZE_DRAG_THRESHOLD: 5, TIMEOUT_LONGPRESS: 460},
            isMobile: () => true, isInAndroid: () => true, isInHarmony: () => false, stopScrollAnimation() {}};
    });
    handle.addEventListener("dragstart", (event: DragEvent) => {
        state.starts++;
        state.sourceText = document.getSelection().toString();
        source.classList.add("protyle-wysiwyg--select");
        const ghost = document.createElement("div");
        ghost.id = "ghost";
        ghost.textContent = source.textContent;
        ghost.style.position = "fixed";
        document.body.append(ghost);
        window.siyuan.touchDragGhost = ghost;
        gutter.classList.add("protyle-gutters--dragging");
        event.dataTransfer.setData("text/plain", source.textContent);
    });
    handle.addEventListener("dragend", () => {
        state.ends++;
        gutter.classList.remove("protyle-gutters--dragging");
    });
    gutter.addEventListener("click", () => { state.clicks++; });
    target.addEventListener("dragover", event => event.preventDefault());
    target.addEventListener("drop", event => { event.preventDefault(); state.drops++; });
    bridge.initTouchDragBridge();
    Object.assign(window, {nativeDrag: {
        selectText: () => {
            const editable = source.firstElementChild as HTMLElement;
            editable.focus();
            document.getSelection().selectAllChildren(editable);
        },
        selectStart: () => source.dispatchEvent(new Event("selectstart", {bubbles: true, cancelable: true})),
        setCaret: () => document.getSelection().collapseToStart(),
        hideKeyboard: (preserveSelection = true) => {
            const result = hideKeyboard(preserveSelection);
            if (result === touchSelection.KeyboardHideResult.Cleanup) {
                // 原生端收到清理结果后会清除 WebView 焦点，触发桥接的失焦取消。
                (document.activeElement as HTMLElement)?.blur();
                window.dispatchEvent(new Event("blur"));
            }
            return result;
        },
        keyboardLayout: () => {
            (document.activeElement as HTMLElement)?.blur();
            visibility.hideGutterElements([gutter], true);
            return handle.isConnected;
        },
        state: () => ({...state, selection: document.getSelection().toString(),
            selected: source.classList.contains("protyle-wysiwyg--select"),
            active: window.siyuan.touchDragActive, ghost: !!document.getElementById("ghost"), scroll: gutter.scrollTop}),
        makeScrollable: () => {
            gutter.dataset.scrollable = "true";
            gutter.style.height = "60px";
            gutter.style.overflowY = "auto";
            for (let i = 0; i < 5; i++) {
                gutter.append(gutter.firstElementChild.cloneNode(true));
            }
        },
    }});
};

test("native mobile gutter gestures preserve taps and scrolling while excluding text selection", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const {parse} = require("ifdef-loader/preprocessor");
    const compile = (file: string) => transpileModule(
        parse(readFileSync(file, "utf8"), {BROWSER: true, MOBILE: true}, false, true), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
    const bridge = compile("src/util/touchDragBridge.ts");
    const core = compile("src/util/touchDragBridgeCore.ts");
    const visibility = compile("src/protyle/ui/gutterVisibility.ts");
    const touchSelection = compile("src/mobile/util/touchSelection.ts");
    const keyboardFile = createSourceFile("keyboardToolbar.ts", readFileSync("src/mobile/util/keyboardToolbar.ts", "utf8"),
        ScriptTarget.Latest, true);
    const keyboardDeclaration = keyboardFile.statements.find(node => isVariableStatement(node) &&
        node.declarationList.declarations.some(item => item.name.getText(keyboardFile) === "hideKeyboardToolbarByApp"));
    assert.ok(keyboardDeclaration);
    const keyboard = transpileModule(keyboardDeclaration.getText(keyboardFile).replace(/^export /, ""), {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-touch-drag-selection-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const assert = require("node:assert/strict");
const {app, BrowserWindow} = require("electron");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 400, height: 600,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        win.webContents.debugger.attach("1.3");
        await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {enabled: true});
        const evaluate = code => win.webContents.executeJavaScript(code);
        await evaluate(${JSON.stringify("const __name = value => value; (" + browserFixture.toString() + ")(" +
            [bridge, core, visibility, keyboard, touchSelection].map(value => JSON.stringify(value)).join(",") + ");")});
        const touch = (type, x = 15, y = 45) => win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", {
            type, touchPoints: ["touchEnd", "touchCancel"].includes(type) ? [] : [{x, y, id: 1}],
        });
        for (let attempt = 1; attempt <= 2; attempt++) {
            await evaluate("nativeDrag.selectText()");
            await touch("touchStart");
            if (attempt === 1) {
                assert.equal(await evaluate("nativeDrag.keyboardLayout()"), true,
                    "keyboard cleanup before activation preserves the touch target");
            }
            await delay(550);
            let state = await evaluate("nativeDrag.state()");
            assert.equal(state.starts, attempt);
            assert.ok(state.sourceText.length > 0, "dragstart can still resolve blocks from the original text range");
            assert.equal(state.selection, "", "block activation clears the editor's native text selection");
            assert.equal(state.selected, true);
            assert.equal(state.active, true);
            assert.equal(state.ghost, true);
            assert.equal(await evaluate("nativeDrag.keyboardLayout()"), true,
                "keyboard cleanup during dragging preserves the touch target and bubbling dragend");
            assert.equal(await evaluate("nativeDrag.selectStart()"), false);
            await evaluate("nativeDrag.selectText()");
            await delay(30);
            assert.equal((await evaluate("nativeDrag.state()")).selection, "");
            await touch("touchMove", 80, 90);
            await touch("touchMove", 80, 150);
            await touch("touchEnd");
            await delay(100);
            state = await evaluate("nativeDrag.state()");
            assert.equal(state.drops, attempt);
            assert.equal(state.ends, attempt);
            assert.equal(state.active, false);
            assert.equal(state.ghost, false);
            assert.equal(await evaluate("nativeDrag.selectStart()"), true);
        }
        await evaluate("nativeDrag.selectText(); nativeDrag.setCaret()");
        await touch("touchStart");
        await delay(100);
        assert.equal(await evaluate("nativeDrag.hideKeyboard()"), 1,
            "native keyboard dismissal preserves WebView focus while the gutter long press is pending");
        await delay(450);
        assert.equal((await evaluate("nativeDrag.state()")).active, true);
        assert.equal(await evaluate("nativeDrag.hideKeyboard(false)"), 1,
            "explicit keyboard dismissal preserves focus after block dragging clears the text range");
        await touch("touchMove", 80, 90);
        await touch("touchMove", 80, 150);
        await touch("touchEnd");
        await delay(100);
        const keyboardDrag = await evaluate("nativeDrag.state()");
        assert.equal(keyboardDrag.starts, 3);
        assert.equal(keyboardDrag.drops, 3);
        assert.equal(keyboardDrag.ends, 3);
        assert.equal(keyboardDrag.active, false);
        assert.equal(keyboardDrag.ghost, false);
        assert.equal(await evaluate("nativeDrag.hideKeyboard()"), 0,
            "the keyboard callback resumes ordinary focus cleanup after release");
        await touch("touchStart");
        await delay(50);
        await touch("touchEnd");
        await delay(100);
        assert.equal((await evaluate("nativeDrag.state()")).clicks, 1, "short taps still activate the block menu once");
        await evaluate("nativeDrag.selectText(); nativeDrag.makeScrollable()");
        await touch("touchStart");
        for (const y of [35, 20, 5]) {
            await delay(25);
            await touch("touchMove", 15, y);
        }
        await touch("touchEnd");
        await delay(150);
        const scrolled = await evaluate("nativeDrag.state()");
        assert.ok(scrolled.scroll > 0, "full gutter swipes still scroll natively");
        assert.equal(scrolled.starts, 3);
        assert.equal(await evaluate("nativeDrag.selectStart()"), true);
        console.log("Native gutter selection exclusion passed");
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const {stdout} = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 25000, windowsHide: true});
        assert.match(stdout, /Native gutter selection exclusion passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-touch-drag-selection-"));
        rmSync(temporary, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
    }
});
