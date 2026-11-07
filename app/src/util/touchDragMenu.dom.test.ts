import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isCallExpression, ModuleKind, Node, ScriptTarget, transpileModule} from "typescript";

const browserCase = (bridgeCode: string, coreCode: string, touchEnd: string) => {
    const check = require("node:assert/strict");
    let now = 1000;
    Date.now = () => now;
    const Constants = {SIZE_DRAG_THRESHOLD: 5, TIMEOUT_LONGPRESS: 460, TIMEOUT_MOUSE_DRAG_DELAY: 150};
    Object.assign(window, {siyuan: {touchDragActive: false}});
    const core = {exports: {}};
    new Function("exports", coreCode)(core.exports);
    const bridge = {exports: {} as {initTouchDragBridge: () => void, cancelManualTouch: () => void,
        isLastPointerMouse: () => boolean}};
    new Function("require", "exports", bridgeCode)((id: string) => id === "./touchDragBridgeCore" ? core.exports : {
        Constants, isInAndroid: () => true, isInHarmony: () => false, isMobile: () => false,
        stopScrollAnimation: () => {}, setGutterTouchDragging: () => {},
    }, bridge.exports);
    // 沿用生产监听器顺序：全局长按菜单处理先注册，桥接 touchend 后注册。
    document.addEventListener("touchend", new Function("cancelManualTouch", "isLastPointerMouse", "Constants",
        "time", "startX", "startY", "return " + touchEnd)(bridge.exports.cancelManualTouch,
        bridge.exports.isLastPointerMouse, Constants, now, 80, 100));
    bridge.exports.initTouchDragBridge();
    const tree = document.createElement("div");
    tree.className = "sy__file";
    tree.innerHTML = '<div class="b3-list-item" data-type="navigation-file" draggable="true"><span>Document</span></div>';
    document.body.append(tree);
    const row = tree.firstElementChild as HTMLElement;
    const label = row.firstElementChild;
    let dragStarts = 0;
    let menus = 0;
    row.addEventListener("dragstart", () => dragStarts++);
    const menu = document.createElement("div");
    menu.className = "b3-menu";
    row.addEventListener("contextmenu", () => { menus++; document.body.append(menu); });
    const touch = (type: string, target: Element, y = 100) => {
        const event = new Event(type, {bubbles: true, cancelable: true});
        const point = {identifier: 1, clientX: 80, clientY: y, radiusX: 1, radiusY: 1};
        Object.defineProperties(event, {touches: {value: type === "touchend" ? [] : [point]},
            changedTouches: {value: [point]}});
        target.dispatchEvent(event);
        return event.defaultPrevented;
    };
    touch("touchstart", label);
    check.equal(row.draggable, false);
    now += 600;
    check.equal(touch("touchend", label), true);
    check.equal(menus, 1);
    check.equal(row.draggable, true, "long-press menu must restore its source draggable state");
    touch("touchstart", menu);
    now += 600;
    check.equal(touch("touchmove", menu, 180), false, "menu scrolling stays native");
    touch("touchend", menu, 180);
    check.equal(dragStarts, 0);
    check.equal((window as unknown as {siyuan: {touchDragActive: boolean}}).siyuan.touchDragActive, false);
    return "touch-menu-lifecycle-ok";
};

test("global long-press touchend cannot leak a file drag into menu scrolling", {timeout: 45000}, async () => {
    const {parse} = require("ifdef-loader/preprocessor");
    const compile = (source: string) => transpileModule(source,
        {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021}}).outputText;
    const bridge = compile(parse(readFileSync("src/util/touchDragBridge.ts", "utf8"),
        {BROWSER: true, MOBILE: false}, false, true));
    const core = compile(readFileSync("src/util/touchDragBridgeCore.ts", "utf8"));
    const ast = createSourceFile("event.ts", readFileSync("src/boot/globalEvent/event.ts", "utf8"), ScriptTarget.ES2021, true);
    let handler: string;
    const visit = (node: Node) => {
        if (isCallExpression(node) && node.expression.getText(ast) === "document.addEventListener" &&
            node.arguments[0]?.getText(ast) === '"touchend"' && node.arguments[1]?.getText(ast).includes("contextmenu")) {
            handler = node.arguments[1].getText(ast);
        }
        node.forEachChild(visit);
    };
    visit(ast);
    assert.ok(handler);
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-touch-menu-"));
    const script = path.join(directory, "main.cjs");
    const renderer = `const __name=value=>value;(()=>{try{return (${browserCase.toString()})(${JSON.stringify(bridge)},${JSON.stringify(core)},${JSON.stringify(handler)})}catch(e){return "FAIL: "+e.stack}})()`;
    writeFileSync(script, `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(directory, "profile"))});app.disableHardwareAcceleration();
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,offscreen:true}});
try{await win.loadURL('about:blank');console.log(await win.webContents.executeJavaScript(${JSON.stringify(renderer)}));app.exit(0);}
catch(e){console.error(e);app.exit(1)}});`);
    const env: NodeJS.ProcessEnv = {...process.env, XDG_CACHE_HOME: path.join(directory, "cache")};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const args = process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY ?
            ["--ozone-platform=headless", script] : [script];
        const result = await promisify(execFile)(require("electron") as unknown as string, args,
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /touch-menu-lifecycle-ok/);
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});
