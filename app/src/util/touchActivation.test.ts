import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {test} from "node:test";
import * as path from "node:path";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = (source: string) => {
    const check: typeof assert = require("node:assert/strict");
    document.body.innerHTML = `<button id="button"><span>Button</span></button>
<div class="b3-menu__item" id="menu"><span>Submenu</span></div>
<li role="button" id="tab">Settings</li>
<label id="label">Switch<input id="switch" type="checkbox"></label>
<button disabled id="disabled">Disabled</button>
<div class="b3-menu__item"><input id="text"><select id="select"><option>One</option></select></div>
<div contenteditable="true" id="editor">Text</div>
<div class="b3-dialog__scrim" id="dialogScrim"></div><div class="b3-menu__scrim" id="menuScrim"></div>`;
    window.siyuan = {touchDragActive: false} as typeof window.siyuan;
    const exports = {} as typeof import("./touchActivation");
    new Function("exports", "require", source)(exports, () => ({Constants: {SIZE_DRAG_THRESHOLD: 5, TIMEOUT_LONGPRESS: 460}}));
    let cleaned = false;
    document.addEventListener("touchend", () => { cleaned = true; });
    exports.bindTouchActivation(window);
    let hit: Element;
    document.elementFromPoint = () => hit;
    const send = (target: Element, type: string, time = 0, x = 10, count = 1) => {
        const event = new Event(type, {bubbles: true, cancelable: true});
        const touch = {identifier: 1, clientX: x, clientY: 10};
        Object.defineProperties(event, {timeStamp: {value: time}, touches: {
            value: type === "touchend" ? [] : Array(count).fill(touch)}, changedTouches: {value: [touch]}});
        target.dispatchEvent(event);
        return event;
    };
    for (const id of ["button", "menu", "tab", "switch", "label", "dialogScrim", "menuScrim"]) {
        const control = document.getElementById(id);
        const target = id === "button" || id === "menu" ? control.firstElementChild : control;
        hit = target;
        let clicks = 0;
        control.addEventListener("click", event => {
            if (event.target !== target) return;
            clicks++;
            check.equal(cleaned, true, "activation runs after document touch cleanup");
        });
        cleaned = false;
        send(target, "touchstart");
        check.equal(send(target, "touchend", 3).defaultPrevented, true);
        check.equal(clicks, 1, id + " activates on the first short tap");
    }
    check.equal((document.getElementById("switch") as HTMLInputElement).checked, false,
        "checkbox and its label each toggle exactly once");
    for (const id of ["disabled", "text", "select", "editor"]) {
        const target = document.getElementById(id);
        hit = target;
        send(target, "touchstart");
        check.equal(send(target, "touchend", 3).defaultPrevented, false, id + " retains native handling");
    }
    const target = document.getElementById("button");
    for (const kind of ["move", "long", "cancel", "multi", "miss", "prevented", "drag"]) {
        hit = target;
        let clicks = 0;
        const count = () => { clicks++; };
        target.addEventListener("click", count);
        send(target, "touchstart");
        if (kind === "move") send(target, "touchmove", 1, 16);
        if (kind === "cancel") send(target, "touchcancel");
        if (kind === "multi") send(target, "touchstart", 1, 10, 2);
        if (kind === "miss") hit = null;
        if (kind === "prevented") target.addEventListener("touchend", event => event.preventDefault(), {once: true});
        window.siyuan.touchDragActive = kind === "drag";
        send(target, "touchend", kind === "long" ? 500 : 3);
        check.equal(clicks, 0, kind);
        target.removeEventListener("click", count);
    }
    window.siyuan.touchDragActive = false;
    let clicks = 0;
    target.addEventListener("click", () => { clicks++; });
    target.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, pointerType: "mouse"}));
    target.dispatchEvent(new PointerEvent("pointerup", {bubbles: true, pointerType: "mouse"}));
    check.equal(clicks, 0, "mouse input is not synthesized");
    const menu = document.getElementById("menu");
    const order: string[] = [];
    ["mouseenter", "mouseover", "click"].forEach(type => menu.addEventListener(type, () => order.push(type)));
    hit = menu;
    send(menu, "touchstart");
    send(menu, "touchend", 3);
    check.deepEqual(order, ["mouseenter", "mouseover", "click"], "lazy submenus load before activation");
    return true;
};

test("iOS short taps activate shared controls once and preserve native gestures", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const source = transpileModule(readFileSync(__dirname + "/touchActivation.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-touch-activation-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app,BrowserWindow}=require("electron");
app.setPath("userData",${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,
webPreferences:{nodeIntegration:true,contextIsolation:false,offscreen:true}});
try{await win.loadURL("data:text/html,<html><body></body></html>");
await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" + browserCases.toString() + ")(" + JSON.stringify(source) + ")")});
win.destroy();app.exit(0);}catch(e){console.error(e);win.destroy();app.exit(1);}});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        await promisify(execFile)(require("electron") as unknown as string, [script], {env, timeout: 25000});
    } finally {
        rmSync(temporary, {recursive: true, force: true});
    }
});
