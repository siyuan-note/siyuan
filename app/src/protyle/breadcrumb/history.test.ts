import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import test from "node:test";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, css: string) => {
    const check = require("node:assert/strict");
    const style = document.createElement("style"); style.textContent = css; document.head.append(style);
    window.siyuan = {languages: {undo: "Undo", redo: "Redo", breadcrumb: "Breadcrumb", more: "More", gutterTip2: "Document"},
        config: {keymap: {editor: {general: new Proxy({}, {get: () => ({custom: ""})})}}, editor: {}}, readonly: false} as any;
    const menuElement = document.createElement("div"); menuElement.id = "commonMenu";
    menuElement.innerHTML = '<div class="b3-menu__items"></div>';
    menuElement.style.cssText = "position:fixed;top:80px;left:0;background:white;z-index:10";
    document.body.append(menuElement);
    const menu = {
        element: menuElement,
        append: (element: HTMLElement) => menuElement.lastElementChild.append(element),
        remove: () => { menuElement.lastElementChild.replaceChildren(); menuElement.classList.add("fn__none"); },
        fullscreen: () => menuElement.classList.remove("fn__none"),
    };
    window.siyuan.menus = {menu} as unknown as typeof window.siyuan.menus;
    let finishAllowed = true;
    let finishPending: Promise<boolean>;
    const calls: string[] = [];
    const dependencies = {
        Constants: {SIYUAN_APPID: "test"}, isMobile: () => true, isMac: () => false,
        updateHotkeyTip: () => "", mountBreadcrumbButtons: () => {}, bindMobileMenuKeyboard: () => () => {},
        toggleMenu: async (options: {build: (menu: unknown, session: unknown) => Promise<void>}) => {
            await options.build(menu, {isCurrent: () => true, show: (show: () => void) => show()});
        },
        getEditorRange: (element: HTMLElement) => { const range = document.createRange(); range.selectNodeContents(element); return range; },
        hasClosestBlock: (): undefined => undefined, isEncryptedBox: () => false, isInAndroid: () => false,
        hasTopClosestByClassName: (): undefined => undefined, emitOpenMenu: () => {},
        getHostCapabilities: () => ({}), updateMenuItemGroupClasses: () => {},
        finishListMindmaps: async () => { calls.push("finish"); return finishPending || finishAllowed; },
        waitForPendingTransactions: async () => {}, isKnownTransactionOperation: () => true,
        getCurrentEditor: (): undefined => undefined, getMobileToolbarProtyle: (): undefined => undefined,
        fetchPost: async (url: string, data: {rootID: string}, callback: (value: unknown) => void) => {
            if (url.endsWith("getTreeStat")) {
                callback({data: {stat: {runeCount: 1, wordCount: 1, linkCount: 0, imageCount: 0, refCount: 0, blockCount: 1}}});
                return;
            }
            check.equal(data.rootID, "document", "the menu always uses document history");
            if (url.endsWith("undoState")) {
                callback({data: {canUndo: true, canRedo: true}});
            } else {
                calls.push(url.endsWith("redo") ? "redo" : "undo");
                callback({data: {canUndo: true, canRedo: true, mutatedRootIDs: ["document"],
                    doOperations: [{action: "update", id: "body"}], undoOperations: [{action: "update", id: "body"}]}});
            }
        },
    };
    const api = new Function(...Object.keys(dependencies), source +
        ";return {Breadcrumb, markMirror, getMirror, refreshUndoButtons, showFullscreenDocumentBar};")(...Object.values(dependencies));
    const settle = async () => {
        for (let i = 0; i < 3; i++) { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); }
    };
    for (const width of [320, 375, 768]) {
        document.body.className = "body--android";
        document.body.style.cssText = "margin:0;--b3-ui-panel-height:42px;--b3-theme-background:white;--b3-theme-on-surface:black";
        const editor = document.createElement("div"); editor.id = "editor"; editor.style.width = `${width}px`;
        const root = document.createElement("div"); root.className = "protyle-wysiwyg";
        root.innerHTML = '<p contenteditable="true">Document body</p>';
        const owner = {element: editor, block: {rootID: "document"}, notebookId: "box", id: "editor",
            options: {upload: {}}, contentElement: root, preview: {element: document.createElement("div")},
            scroll: {element: document.createElement("div")},
            wysiwyg: {element: root, flushPendingInput: () => calls.push("flush")},
            undo: {renderLocal: (_owner: unknown, operations: {id: string}[]) => {
                check.equal(operations[0].id, "body", "undo can affect body text outside the mind map");
                calls.push("replay");
            }}, toolbar: {}, disabled: false} as unknown as IProtyle;
        owner.breadcrumb = new api.Breadcrumb(owner);
        owner.scroll.element.classList.add("fn__none");
        const bar = owner.breadcrumb.element.parentElement;
        editor.append(bar, root); document.body.append(editor);
        check.equal(bar.querySelector('[data-type="undo"], [data-type="redo"]'), null,
            "mobile breadcrumb contains no duplicate history buttons");
        let buttons: HTMLButtonElement[];
        const button = (type: string) => buttons.find(item => item.dataset.id === type);
        const open = async (expected = owner.disabled ? 0 : 2) => {
            menuElement.style.width = `${width}px`;
            bar.querySelector<HTMLButtonElement>('[data-type="more"]').click();
            await settle();
            buttons = Array.from(menuElement.querySelectorAll<HTMLButtonElement>('[data-id="undo"], [data-id="redo"]'));
            check.equal(buttons.length, expected);
            if (expected) {
                check.deepEqual(Array.from(menuElement.lastElementChild.children).slice(0, 2).map(item => (item as HTMLElement).dataset.id),
                    ["undo", "redo"], "document history is at the start of More");
            }
        };
        api.markMirror("document", {canUndo: false, canRedo: false}); api.refreshUndoButtons(owner);
        await open();
        check.equal(button("undo").disabled, true); check.equal(button("redo").disabled, true);
        api.markMirror("document", {canUndo: true, canRedo: false}); await settle();
        check.equal(button("undo").disabled, false); check.equal(button("redo").disabled, true);
        api.markMirror("embedded-source", {canUndo: false, canRedo: false});
        api.refreshUndoButtons(owner, "embedded-source");
        check.equal(button("undo").disabled, false,
            "embedded source history does not replace the document menu history");
        api.markMirror("document", {canUndo: false, canRedo: true}); await settle();
        check.equal(button("undo").disabled, true); check.equal(button("redo").disabled, false);
        api.markMirror("document", {canUndo: true, canRedo: false});
        for (const fontSize of [16, 32]) {
            root.style.fontSize = `${fontSize}px`;
            for (const item of Array.from(bar.querySelectorAll<HTMLButtonElement>("button"))) {
                const rect = item.getBoundingClientRect();
                check.ok(rect.left >= -1 && rect.right <= width + 1, `${width}px breadcrumb contains ${item.dataset.type}`);
            }
        }
        root.firstElementChild.dispatchEvent(new Event("focus"));
        const touch = async (type: string) => {
            const rect = button(type).getBoundingClientRect();
            await require("electron").ipcRenderer.invoke("history-touch", [
                {type: "touchStart", touchPoints: [{id: 1, x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2}]},
                {type: "touchEnd", touchPoints: []},
            ]);
            await settle();
        };
        calls.length = 0;
        let release: (value: boolean) => void;
        finishPending = new Promise(resolve => release = resolve);
        await touch("undo");
        check.deepEqual(calls, ["finish"]);
        check.equal(button("undo").disabled, true); check.equal(button("redo").disabled, true);
        button("undo").click(); check.deepEqual(calls, ["finish"], "pending edits cannot trigger duplicate undo");
        release(true); finishPending = undefined; await settle();
        check.deepEqual(calls, ["finish", "flush", "undo", "replay"]);
        check.ok(!document.activeElement.matches("input, textarea, [contenteditable='true']"), "keyboard stays closed");
        await open();
        calls.length = 0; finishAllowed = false; button("undo").click(); await settle();
        check.deepEqual(calls, ["finish"], "failed node saves prevent document undo"); finishAllowed = true;
        await open();
        calls.length = 0; button("redo").focus();
        await require("electron").ipcRenderer.invoke("history-key"); await settle();
        check.deepEqual(calls, ["finish", "flush", "redo", "replay"]);
        owner.disabled = true; api.refreshUndoButtons(owner);
        check.equal(button("undo").disabled, true);
        await open();
        owner.disabled = false; api.refreshUndoButtons(owner);
        const host = document.createElement("div"); host.className = "mindmap-view fullscreen";
        document.body.append(host);
        const restore = api.showFullscreenDocumentBar(owner, host); await settle();
        check.equal(bar.parentElement, document.body);
        check.ok(host.getBoundingClientRect().top >= bar.getBoundingClientRect().bottom - 1, "canvas leaves room for the document bar");
        await open();
        calls.length = 0; await touch("undo"); check.deepEqual(calls, ["finish", "flush", "undo", "replay"]);
        restore(); check.equal(bar.parentElement, editor);
        check.equal(Array.from(editor.childNodes).some(node => node.nodeType === Node.COMMENT_NODE), false);
        await open();
        calls.length = 0; finishPending = new Promise(resolve => release = resolve);
        button("undo").click(); owner.block.rootID = "another-document";
        release(true); finishPending = undefined; await settle();
        check.deepEqual(calls, ["finish"], "switching documents while a save is pending cancels history execution");
        calls.length = 0; button("redo").click(); await settle();
        check.deepEqual(calls, [], "stale menu actions cannot run in a different document");
        owner.block.rootID = "document";
        await open();
        owner.notebookId = "another-box";
        calls.length = 0; button("undo").click(); await settle();
        check.deepEqual(calls, [], "stale menu actions cannot run in a different notebook");
        owner.notebookId = "box";
        owner.block.rootID = "another-document";
        owner.breadcrumb.refreshHistory();
        api.markMirror("document", {canUndo: false, canRedo: false});
        api.markMirror("another-document", {canUndo: false, canRedo: true});
        check.equal(button("redo").disabled, false, "the menu follows its new document subscription");
        owner.block.rootID = "document";
        api.markMirror("document", {canUndo: true, canRedo: true}); owner.breadcrumb.refreshHistory();
        await open();
        calls.length = 0; finishPending = new Promise(resolve => release = resolve);
        button("undo").click();
        owner.breadcrumb.destroy();
        release(true); finishPending = undefined; await settle();
        check.deepEqual(calls, ["finish"], "destroying the editor while saving cancels history execution");
        owner.block.rootID = "late-document";
        owner.breadcrumb.refreshHistory();
        api.markMirror("late-document", {canUndo: false, canRedo: false});
        api.markMirror("document", {canUndo: false, canRedo: false});
        check.equal(button("redo").disabled, true, "destroyed menus unsubscribe from history updates");
        await open(0);
        check.equal(buttons.length, 0, "destroyed history controllers cannot create menu actions");
        host.remove(); editor.remove();
    }
    return "Document history passed";
};

test("mobile More history replaces breadcrumb buttons and supports touch, pending edits, readonly and fullscreen", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY, timeout: 60000,
}, async () => {
    const menuSource = createSourceFile("Menu.ts", readFileSync(path.join(__dirname, "../../menus/Menu.ts"), "utf8"), ScriptTarget.ES2021, true);
    const menuItem = menuSource.statements.find(statement => isClassDeclaration(statement) && statement.name?.text === "MenuItem");
    const source = transpileModule(menuItem.getText(menuSource).replace(/^export /, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText +
        ["../../util/escape.ts", "../undo/globalUndo.ts", "history.ts", "index.ts", "../../mobile/util/documentBar.ts"]
        .map(file => transpileModule(require("ifdef-loader/preprocessor").parse(readFileSync(path.join(__dirname, file), "utf8"),
            {BROWSER: true, MOBILE: true}, false, true).replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText).join("\n");
    const css = ["util/_function.scss", "business/_block.scss", "component/_menu.scss", "protyle/_protyle.scss", "protyle/_mindmap-view.scss", "main/_mobile.scss"]
        .map(file => require("sass").compile(path.resolve(__dirname, "../../assets/scss", file),
            {logger: require("sass").Logger.silent}).css).join("\n");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-document-history-"));
    const script = path.join(temporary, "run.cjs");
    const browserSource = transpileModule(`(${browserCases.toString()})`, {compilerOptions: {target: ScriptTarget.ES2021}})
        .outputText.trim().replace(/^"use strict";\s*/, "").replace(/;$/, "");
    writeFileSync(script, `const {app,BrowserWindow,ipcMain}=require("electron");
app.setPath("userData",${JSON.stringify(path.join(temporary, "profile"))});app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1000,height:800,
webPreferences:{offscreen:true,nodeIntegration:true,contextIsolation:false}});
ipcMain.handle("history-touch",async(_event,events)=>{
if(!win.webContents.debugger.isAttached())win.webContents.debugger.attach("1.3");
await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled",{enabled:true});
try{for(const event of events){await win.webContents.debugger.sendCommand("Input.dispatchTouchEvent",event);await new Promise(resolve=>setTimeout(resolve,30));}}
finally{await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled",{enabled:false});}});
ipcMain.handle("history-key",()=>{win.webContents.sendInputEvent({type:"keyDown",keyCode:"Return"});win.webContents.sendInputEvent({type:"char",keyCode:"\\r"});win.webContents.sendInputEvent({type:"keyUp",keyCode:"Return"});});
try{await win.loadURL("data:text/html,<html><body></body></html>");
console.log(await win.webContents.executeJavaScript(${JSON.stringify(`const __name=value=>value;(${browserSource})(${JSON.stringify(source)},${JSON.stringify(css)})`)}));
win.destroy();app.exit(0);}catch(error){console.error(error);win.destroy();app.exit(1);}});`, "utf8");
    const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script], {env, timeout: 55000, windowsHide: true});
        assert.match(result.stdout, /Document history passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        rmSync(temporary, {recursive: true, force: true});
    }
});
