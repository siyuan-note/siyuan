import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import test from "node:test";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, css: string) => {
    const check = require("node:assert/strict");
    const style = document.createElement("style"); style.textContent = css; document.head.append(style);
    const api = new Function("Constants", "mathRender", "tabsRender", "destroyTabsRender", source +
        ";return {ListMindmapView, readListMindmap};")(
        {CUSTOM_SY_LIST_MINDMAP_DATA: "custom-sy-list-mindmap-data"}, () => {}, () => {}, () => {});
    const lute = Lute.New(); lute.SetProtyleWYSIWYG(true);
    const settle = async () => {
        for (let i = 0; i < 3; i++) { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); }
    };
    for (const width of [240, 320, 700]) {
        for (const scale of [1, .75]) {
            document.body.className = width < 700 ? "body--android" : "body--windows";
            const outer = document.createElement("div");
            outer.style.cssText = `position:absolute;left:20px;top:20px;width:${width}px;height:360px;overflow:auto;` +
                `transform:scale(${scale});transform-origin:top left`;
            const host = document.createElement("div");
            host.style.cssText = "--mindmap-view-height:1000px;--b3-border-color:#888";
            outer.append(host); document.body.append(outer);
            const holder = document.createElement("div"); holder.innerHTML = lute.Md2BlockDOM("- Root\n  - Node\n");
            const model = api.readListMindmap(holder.firstElementChild);
            const original = holder.innerHTML;
            let undo = 0;
            let redo = 0;
            let finishAllowed = true;
            let release: () => void;
            const view = new api.ListMindmapView({host, model, onExit() {}, onSettingsMenu() {}, onExpandLevelMenu() {},
                finishEdit: () => finishAllowed,
                onUndo: () => { undo++; return new Promise<void>(resolve => release = resolve); },
                onRedo: () => { redo++; },
            });
            await settle();
            view.setInteractionActive(true); view.clearSelection();
            outer.scrollTop = 220; await settle();
            const toolbar = host.querySelector<HTMLElement>(".mindmap-view__toolbar");
            const button = (key: string) => toolbar.querySelector<HTMLButtonElement>(`[data-type="${key}"]`);
            let stage = "initial";
            const visible = () => {
                const rect = toolbar.getBoundingClientRect();
                const clip = view.fullscreenMarker ? {left: 0, top: 0, right: innerWidth, bottom: innerHeight} : outer.getBoundingClientRect();
                check.equal(getComputedStyle(toolbar).visibility, "visible",
                    `${stage}: toolbar ${JSON.stringify(rect.toJSON())}, clip ${JSON.stringify(clip)}, style ${toolbar.style.cssText}`);
                check.ok(rect.top >= clip.top - 1 && rect.bottom <= clip.bottom + 1);
                for (const key of ["undo", "redo"]) {
                    const bounds = button(key).getBoundingClientRect();
                    check.ok(bounds.left >= clip.left - 1 && bounds.right <= clip.right + 1,
                        `${key} fits the ${width}px canvas at scale ${scale}`);
                }
            };
            check.equal(button("undo").disabled, true); check.equal(button("redo").disabled, true);
            check.equal(button("undo").getClientRects().length, 0, "empty history hides both controls");
            check.equal(button("redo").getClientRects().length, 0);
            view.setUndoState({canUndo: true, canRedo: false});
            await settle(); visible();
            const bounds = button("undo").getBoundingClientRect();
            await require("electron").ipcRenderer.invoke("mindmap-history-touch", [
                {type: "touchStart", touchPoints: [{id: 1, x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2}]},
                {type: "touchEnd", touchPoints: []},
            ]);
            await settle();
            check.equal(undo, 1, "canvas undo works without a selected node or a text editor");
            check.equal(button("undo").disabled, true); check.equal(button("redo").disabled, true);
            button("undo").click(); await settle(); check.equal(undo, 1, "pending history cannot repeat");
            check.ok(!document.activeElement.matches("input, textarea, [contenteditable='true']"), "undo does not focus text input");
            check.equal(outer.scrollTop, 220, "history activation preserves document scroll position");
            view.setUndoState({canUndo: false, canRedo: true}); release(); await settle();
            visible();
            view.offsetX = 500; view.offsetY = -500; view.draw(); await settle();
            view.focusNode(model.root.id, false); await settle();
            check.deepEqual([view.offsetX, view.offsetY, outer.scrollTop], [500, -500, 220],
                "history restores an offscreen node selection without panning the canvas or scrolling the document");
            check.equal(button("undo").disabled, true); check.equal(button("redo").disabled, false);
            button("redo").focus();
            check.equal(document.activeElement, button("redo"));
            await require("electron").ipcRenderer.invoke("mindmap-history-key"); await settle();
            check.equal(redo, 1, "the history control supports keyboard activation");
            view.setUndoState({canUndo: true, canRedo: false}); finishAllowed = false;
            button("undo").click(); await settle();
            check.equal(undo, 1, "failed pending edits prevent history execution");
            check.equal(button("undo").disabled, false, "canceled execution releases the local busy state");
            finishAllowed = true;
            const selectedID = model.root.children[0].id;
            const selectedNode = host.querySelector<HTMLElement>(`[data-mindmap-id="${selectedID}"]`);
            view.focusNode(selectedID, false);
            const mouseClick = async (key: string) => {
                const rect = button(key).getBoundingClientRect();
                await require("electron").ipcRenderer.invoke("mindmap-history-mouse", {
                    x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2,
                });
                await settle();
                check.equal(view.getSelectedId(), selectedID, "history pointerdown preserves the selected node");
                check.equal(selectedNode.classList.contains("mindmap-view__node--selected"), true,
                    "the node selection cannot disappear while history is pending");
            };
            await mouseClick("undo");
            check.equal(undo, 2);
            check.equal(button("undo").disabled, true);
            view.setUndoState({canUndo: false, canRedo: true}); release(); await settle();
            await mouseClick("redo");
            check.equal(redo, 2);
            view.setUndoState({canUndo: true, canRedo: false});
            const touchBounds = button("undo").getBoundingClientRect();
            await require("electron").ipcRenderer.invoke("mindmap-history-touch", [
                {type: "touchStart", touchPoints: [{id: 1, x: (touchBounds.left + touchBounds.right) / 2,
                    y: (touchBounds.top + touchBounds.bottom) / 2}]},
                {type: "touchEnd", touchPoints: []},
            ]);
            await settle();
            check.equal(undo, 3);
            check.equal(view.getSelectedId(), selectedID, "touch undo also keeps the selected node visible while pending");
            check.equal(selectedNode.classList.contains("mindmap-view__node--selected"), true);
            view.setUndoState({canUndo: true, canRedo: false}); release(); await settle();
            stage = "short";
            outer.style.height = "60px"; outer.dispatchEvent(new Event("scroll")); await settle(); visible();
            outer.style.height = "360px"; outer.dispatchEvent(new Event("scroll")); await settle();
            const scrollTop = outer.scrollTop;
            stage = "fullscreen";
            view.enterFullscreen(); await settle(); visible();
            view.exitFullscreen(); await settle(); check.equal(outer.scrollTop, scrollTop); visible();
            view.setReadOnly(true); await settle();
            check.equal(button("undo"), null); check.equal(button("redo"), null);
            view.setReadOnly(false); await settle(); visible();
            check.equal(button("undo").disabled, false);
            view.setUndoState({canUndo: false, canRedo: false}); await settle();
            check.equal(button("undo").getClientRects().length, 0, "clearing both histories hides the controls again");
            check.equal(button("redo").getClientRects().length, 0);
            check.equal(holder.innerHTML, original, "history controls never write document metadata");
            view.destroy(); outer.remove();
        }
    }
    return "Mindmap history controls passed";
};

test("desktop and mobile canvas history hides empty controls and preserves selection through touch, mouse and keyboard", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY, timeout: 60000,
}, async () => {
    const source = ["../av/richTextValue.ts", "summary.ts", "connectors.ts", "appearance.ts", "model.ts", "fold.ts", "routing.ts", "pan.ts", "view.ts"]
        .map(file => transpileModule(readFileSync(path.join(__dirname, file), "utf8")
            .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText).join("\n");
    const css = ["business/_block.scss", "business/_color.scss", "component/_svg.scss", "protyle/_mindmap-view.scss"]
        .map(file => require("sass").compile(path.resolve(__dirname, "../../../assets/scss", file),
            {logger: require("sass").Logger.silent}).css).join("\n");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-mindmap-history-"));
    const script = path.join(temporary, "run.cjs");
    const browserSource = transpileModule(`(${browserCases.toString()})`, {compilerOptions: {target: ScriptTarget.ES2021}})
        .outputText.trim().replace(/^"use strict";\s*/, "").replace(/;$/, "");
    writeFileSync(script, `const {app,BrowserWindow,ipcMain}=require("electron");
app.setPath("userData",${JSON.stringify(path.join(temporary, "profile"))});app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1000,height:800,
webPreferences:{offscreen:true,nodeIntegration:true,contextIsolation:false}});
ipcMain.handle("mindmap-history-touch",async(_event,events)=>{
if(!win.webContents.debugger.isAttached())win.webContents.debugger.attach("1.3");
await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled",{enabled:true});
try{for(const event of events){await win.webContents.debugger.sendCommand("Input.dispatchTouchEvent",event);await new Promise(resolve=>setTimeout(resolve,30));}}
finally{await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled",{enabled:false});}});
ipcMain.handle("mindmap-history-key",()=>{win.webContents.sendInputEvent({type:"keyDown",keyCode:"Return"});win.webContents.sendInputEvent({type:"char",keyCode:"\\r"});win.webContents.sendInputEvent({type:"keyUp",keyCode:"Return"});});
ipcMain.handle("mindmap-history-mouse",(_event,point)=>{for(const type of ["mouseDown","mouseUp"]){win.webContents.sendInputEvent({type,...point,button:"left",clickCount:1});}});
try{await win.loadURL("data:text/html,<html><body></body></html>");
await win.webContents.executeJavaScript(require("fs").readFileSync(${JSON.stringify(path.resolve(__dirname, "../../../../stage/protyle/js/lute/lute.min.js"))},"utf8"));
console.log(await win.webContents.executeJavaScript(${JSON.stringify(`const __name=value=>value;(${browserSource})(${JSON.stringify(source)},${JSON.stringify(css)})`)}));
win.destroy();app.exit(0);}catch(error){console.error(error);win.destroy();app.exit(1);}});`, "utf8");
    const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script], {env, timeout: 55000, windowsHide: true});
        assert.match(result.stdout, /Mindmap history controls passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        rmSync(temporary, {recursive: true, force: true});
    }
});
