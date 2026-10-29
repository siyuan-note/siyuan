import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("native touch swipes preserve selected blocks and scroll even after a sustained press", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const source = transpileModule(readFileSync("src/protyle/wysiwyg/blockDragSelectionGesture.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-block-selection-scroll-"));
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
        await evaluate(
            'window.gestures = {}; new Function("exports", ' + ${JSON.stringify(JSON.stringify(source))} +
            ')(window.gestures);'
        );
        const setup = async () => {
            await evaluate(
                'window.dispose?.(); document.body.innerHTML = ' + JSON.stringify(
                    '<style>body{margin:0}.scroll{height:400px;overflow:auto}.protyle-wysiwyg{user-select:none}' +
                    '.block{height:100px}.selected{background:#def}</style><div class="scroll">' +
                    '<div class="protyle-wysiwyg" contenteditable="false">' +
                    Array.from({length: 20}, (_, i) => '<div class="block' + (i < 2 ? ' selected' : '') +
                        '" data-id="' + i + '">Block ' + i + '</div>').join('') + '</div></div>'
                ) + ';' +
                'window.root = document.querySelector(".protyle-wysiwyg");' +
                'window.scroller = document.querySelector(".scroll");' +
                'window.blocks = Array.from(root.children); window.selections = []; window.ends = [];' +
                'window.dispose = gestures.bindBlockDragSelectionGesture(root, () => scroller, {' +
                'canStart: () => true, getStartBlock: target => target.closest(".block"),' +
                'getBlockAtPoint: p => document.elementFromPoint(p.clientX, p.clientY)?.closest(".block"),' +
                'select: (start, end) => { selections.push([start.dataset.id, end.dataset.id]);' +
                'const a = blocks.indexOf(start), b = blocks.indexOf(end);' +
                'blocks.forEach((block, i) => block.classList.toggle("selected", i >= Math.min(a,b) && i <= Math.max(a,b))); },' +
                'scroll: () => {}, finish: cancelled => ends.push(cancelled) }); void 0;'
            );
            await delay(100);
        };
        const touch = (type, y) => win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", {
            type, touchPoints: type === "touchEnd" ? [] : [{x: 100, y, id: 1}],
        });
        const state = () => evaluate('({scroll: scroller.scrollTop, selections, ends,' +
            ' selected: blocks.filter(block => block.classList.contains("selected")).map(block => block.dataset.id)})');
        for (const duration of [0, 1600]) {
            await setup();
            await touch("touchStart", 250);
            if (duration) await delay(duration);
            for (const y of [230, 190, 150, 100]) {
                await delay(30);
                await touch("touchMove", y);
            }
            await touch("touchEnd");
            await delay(150);
            const result = await state();
            assert.ok(result.scroll > 50, "swiping scrolls the editor regardless of the press duration");
            assert.deepEqual(result.selections, []);
            assert.deepEqual(result.ends, []);
            assert.deepEqual(result.selected, ["0", "1"], "scrolling preserves the existing selection");
        }
        console.log("Native block selection scrolling passed");
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
        assert.match(stdout, /Native block selection scrolling passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-block-selection-scroll-"));
        rmSync(temporary, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
    }
});
