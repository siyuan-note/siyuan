import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile, Logger} from "sass";
import {createSourceFile, forEachChild, isCallExpression, ModuleKind, Node, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: Record<string, string>, handler: string, css: string) => {
    const check: typeof assert = require("node:assert/strict");
    const ipc = require("electron").ipcRenderer;
    const modules: Record<string, {exports: any}> = {};
    const applied: string[] = [];
    const externals: Record<string, unknown> = {
        "util/functions": {isMobile: () => false},
        "protyle/util/compatibility": {getEventName: () => "click", isInMobileApp: () => false, updateHotkeyTip: (value: string) => value},
        "util/zIndex": {isScrollAboveMenu: () => false},
        "layout/getTopBarHeight": {getTopBarHeight: () => 0},
        "constants": {Constants: {INLINE_TYPE: [], TIMEOUT_DBLCLICK: 10, ATTRIBUTE_MENU_KEYMAP: "data-keymap"}},
        "protyle/undo": {electronUndo() {}},
        "menus/menuKeyboard": {setMenuInputCurrent() {}},
        "plugin/EventBusCore": {forEachPluginSubscriber() {}},
        "mobile/util/keyboardToolbar": {activeBlur() {}},
        "block/popoverLifecycle": {setPopoverMenuOpen() {}},
        "config/entryVisibility/runtime": {applyMenuEntryVisibility() {}},
        "protyle/toolbar/fontFamilyMenu": {},
        "protyle/util/selection": {getBlockRanges: (): Range[] => []},
        "protyle/util/selectionOffsets": {focusByRange: (range: Range) => {
            getSelection()!.removeAllRanges();
            getSelection()!.addRange(range);
        }},
        "protyle/toolbar/Font": {
            getFontNodeElements: (): HTMLElement[] => [],
            getFontSizeInfo: () => ({fontSize: "25px", baseFontSize: 25}),
            convertFontSize: (size: string, unit: string, base: number) => unit === "em" ? `${parseFloat(size) / base}em` : `${parseFloat(size) * base}px`,
            fontEvent: (protyle: IProtyle, _nodes: unknown, _type: string, value: string) => {
                check.equal(protyle.toolbar.range.toString(), "selected text");
                applied.push(value);
            },
        },
    };
    const load = (name: string): any => {
        if (name in externals) return externals[name];
        if (modules[name]) return modules[name].exports;
        check.ok(sources[name], `Unexpected dependency ${name}`);
        const module = {exports: {}};
        modules[name] = module;
        new Function("require", "exports", sources[name])((dependency: string) => {
            const parts = name.split("/");
            parts.pop();
            dependency.split("/").forEach(part => part === ".." ? parts.pop() : part !== "." && parts.push(part));
            return load(parts.join("/"));
        }, module.exports);
        return module.exports;
    };
    Object.assign(window, {siyuan: {languages: {back: "Back", fontSize: "Font size", mixed: "Mixed", relativeFontSize: "Relative size", confirm: "Confirm"},
        zIndex: 1, storage: {}, config: {appearance: {}}, menus: {}}});
    document.head.innerHTML = `<style>${css} body{margin:0} .fixture{position:absolute;left:180px;top:200px} .protyle-toolbar{position:absolute;left:180px;top:140px} .fn__none{display:none!important}</style>`;
    document.body.innerHTML = '<div class="fixture" contenteditable="true">selected text</div><div class="protyle-toolbar"></div>' +
        '<div id="commonMenu" class="b3-menu fn__none"><div class="b3-menu__title fn__none"><span class="b3-menu__label"></span></div><div class="b3-menu__items"></div></div>';
    const menu: import("../../menus/Menu").Menu = new (load("menus/Menu").Menu)();
    window.siyuan.menus.menu = menu;
    const closest = load("protyle/util/hasClosest");
    const mousedown = new Function("hasClosestByClassName", "hasClosestByAttribute", "hideAllElements", "formatPainter", "SELECTION_TOOLBAR_SUB_ELEMENT_SOURCE", `${handler}; return handler;`)(
        closest.hasClosestByClassName, closest.hasClosestByAttribute,
        () => document.querySelector(".protyle-toolbar")!.classList.add("fn__none"), {deactivateByPointer() {}}, "selection-toolbar");
    window.addEventListener("mousedown", mousedown);
    const toolbar = document.querySelector<HTMLElement>(".protyle-toolbar")!;
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(".fixture")!);
    getSelection()!.addRange(range);
    const protyle = {toolbar: {range, element: toolbar, subElement: document.createElement("div"), render() {}},
        wysiwyg: {element: document.querySelector(".fixture")}} as unknown as IProtyle;
    const button = new (load("protyle/toolbar/fontControls").FontControl)(protyle, {name: "font-size", lang: "fontSize"}).element;
    toolbar.append(button);
    const settle = () => new Promise(resolve => setTimeout(resolve, 80));
    const click = async (element: Element) => {
        const rect = element.getBoundingClientRect();
        await ipc.invoke("font-size-click", rect.x + rect.width / 2, rect.y + rect.height / 2);
        await settle();
    };
    await click(button);
    const initial = menu.element.getBoundingClientRect();
    check.ok(initial.left > 100 && initial.top > 100, JSON.stringify({rect: initial.toJSON(), menu: menu.element.outerHTML, button: button.getBoundingClientRect().toJSON(), width: innerWidth}));
    const relative = menu.element.querySelector<HTMLInputElement>(".b3-switch")!;
    const input = menu.element.querySelector<HTMLInputElement>('input[type="number"]')!;
    for (let index = 0; index < 4; index++) {
        await click(index % 2 ? relative.parentElement! : relative);
        check.equal(relative.checked, index % 2 === 0);
        check.equal(input.value, index % 2 === 0 ? "100" : "25");
        check.equal(toolbar.classList.contains("fn__none"), false, "picker interactions keep the selection toolbar anchor visible");
        check.equal(protyle.toolbar.range.toString(), "selected text");
        const current = menu.element.getBoundingClientRect();
        check.equal(current.left, initial.left);
        check.equal(current.top, initial.top);
    }
    await click(input);
    input.value = "30";
    input.dispatchEvent(new Event("input", {bubbles: true}));
    await click(menu.element.querySelector("button")!);
    check.deepEqual(applied, ["30px"]);
    check.equal(getSelection()!.toString(), "selected text", "confirm restores the saved editor selection");
    await click(button);
    await ipc.invoke("font-size-key", "Escape");
    await settle();
    check.ok(menu.element.classList.contains("fn__none"));
    check.deepEqual(applied, ["30px"], "cancel does not format the text");
    await click(button);
    await ipc.invoke("font-size-click", 20, 20);
    check.ok(toolbar.classList.contains("fn__none"), "outside pointer still hides the selection toolbar");
    menu.remove();
    menu.addItem({label: "Unrelated menu"});
    check.equal(menu.element.querySelector('[data-sub-element-source="selection-toolbar"]'), null, "shared menu does not retain picker ownership");
    return "Font size selection and positioning passed";
};

test("font size picker retains its selection toolbar while toggling units and restores selection on close", {timeout: 45000}, async () => {
    const names = ["menus/Menu", "menus/menuPosition", "menus/menuMouseScroll", "menus/menuGroup", "menus/sheetOpen", "menus/sheetActions",
        "mobile/util/mobileSheetGesture", "mobile/util/keyboardSheetState", "menus/menuToggle", "plugin/Menu", "menus/overlayOwnership", "util/setPosition", "protyle/util/hasClosest",
        "protyle/toolbar/fontControls", "protyle/toolbar/ToolbarItem", "protyle/toolbar/subElementLifecycle", "protyle/toolbar/fontSizeCore",
        "protyle/toolbar/fontSizeSelection", "util/escape", "util/upDownHint"];
    const sources = Object.fromEntries(names.map(name => [name, transpileModule(readFileSync(join(__dirname, "../..", `${name}.ts`), "utf8"), {
        compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
    }).outputText]));
    const eventFile = createSourceFile("event.ts", readFileSync(join(__dirname, "../../boot/globalEvent/event.ts"), "utf8"), ScriptTarget.Latest);
    let handler: string;
    const visit = (node: Node) => {
        if (isCallExpression(node) && node.expression.getText(eventFile) === "window.addEventListener" &&
            node.arguments[0].getText(eventFile) === '"mousedown"' && node.arguments[1].getText(eventFile).includes("hideAllElements")) {
            handler = node.arguments[1].getText(eventFile);
        }
        forEachChild(node, visit);
    };
    visit(eventFile);
    assert.ok(handler);
    handler = transpileModule(`const handler = ${handler};`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const css = ["component/_menu.scss", "component/_switch.scss", "component/_text-field.scss", "component/_button.scss", "util/_function.scss", "protyle/_toolbar.scss"]
        .map(name => compile(join(__dirname, "../../assets/scss", name), {logger: Logger.silent}).css).join("\n");
    const directory = mkdtempSync(join(tmpdir(), "siyuan-font-size-"));
    const script = join(directory, "run.cjs");
    const invocation = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(sources)},${JSON.stringify(handler)},${JSON.stringify(css)})`;
    writeFileSync(script, `const {app,BrowserWindow,ipcMain}=require("electron");
app.setPath("userData",${JSON.stringify(join(directory, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:900,height:720,webPreferences:{nodeIntegration:true,contextIsolation:false,offscreen:true,backgroundThrottling:false}});
 ipcMain.handle("font-size-click",(_event,x,y)=>{for(const type of ["mouseDown","mouseUp"])win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:"left",clickCount:1});});
 ipcMain.handle("font-size-key",(_event,keyCode)=>{for(const type of ["keyDown","keyUp"])win.webContents.sendInputEvent({type,keyCode});});
 try{await win.loadURL("about:blank");console.log(await win.webContents.executeJavaScript(${JSON.stringify(invocation)}));win.destroy();app.exit(0);}
 catch(error){console.error(error);win.destroy();app.exit(1);}
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const args = process.env.SIYUAN_ELECTRON_HEADLESS === "1" ? ["--ozone-platform=headless", "--ozone-override-screen-size=1920,1080", script] : [script];
        const result = await promisify(execFile)(require("electron") as unknown as string, args, {env, timeout: 40000});
        assert.match(result.stdout, /Font size selection and positioning passed/);
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});
