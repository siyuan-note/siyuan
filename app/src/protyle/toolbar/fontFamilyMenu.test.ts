import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile, Logger} from "sass";
import {createSourceFile, forEachChild, isCallExpression, isVariableStatement, ModuleKind, Node, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: Record<string, string>, toolbarSource: string, dropdown: string, css: string, themes: string[]) => {
    const check: typeof assert = require("node:assert/strict");
    let mobile = true;
    let readonly = false;
    let fonts = Array.from({length: 60}, (_, index) => ({family: `Font ${index}`, displayName: `Font ${index}`, weight: 400}));
    let pendingFonts: Promise<{fontItems: typeof fonts}>;
    let pendingPreviews: Promise<FontFace[]>;
    Object.defineProperty(document.fonts, "load", {value: () => pendingPreviews || Promise.resolve([])});
    const modules: Record<string, {exports: any}> = {};
    const externals = {
        "util/functions": {isMobile: () => mobile},
        "protyle/util/compatibility": {getEventName: () => "click", isInMobileApp: () => false, updateHotkeyTip: (value: string) => value},
        "util/zIndex": {isScrollAboveMenu: () => false},
        "layout/getTopBarHeight": {getTopBarHeight: () => 0},
        constants: {Constants: {TIMEOUT_DBLCLICK: 10, ATTRIBUTE_MENU_KEYMAP: "data-keymap"}},
        "protyle/undo": {electronUndo() {}},
        "menus/menuKeyboard": {setMenuInputCurrent() {}},
        "plugin/EventBusCore": {forEachPluginSubscriber() {}},
        "mobile/util/keyboardToolbar": {activeBlur: () => (document.activeElement as HTMLElement)?.blur()},
        "block/popoverLifecycle": {setPopoverMenuOpen() {}},
        "config/entryVisibility/runtime": {applyMenuEntryVisibility() {}},
        "util/availableFont": {loadAvailableFonts: () => pendingFonts || Promise.resolve({fontItems: fonts})},
        "protyle/util/selection": {},
    };
    const load = (name: string): any => {
        if (name in externals) return externals[name as keyof typeof externals];
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
    const style = document.createElement("style");
    style.textContent = css + ":root {--b3-font-size:16px;} body {margin:0;} button {font:inherit;}";
    document.head.append(style);
    const themeStyle = document.createElement("style");
    document.head.append(themeStyle);
    Object.assign(window, {siyuan: {languages: {default: "Default", back: "Back", close: "Close", searchPlaceholder: "Search",
        fontFamily: "Font", loading: "Loading", expand: "Expand", collapse: "Collapse"}, zIndex: 1, storage: {},
        config: {get readonly() { return readonly; }}, mobile: {size: {portrait: {height1: innerHeight}}}, menus: {}}});
    const menuElement = document.createElement("div");
    menuElement.id = "commonMenu";
    menuElement.className = "b3-menu fn__none";
    menuElement.innerHTML = '<div class="b3-menu__title fn__none"><span class="b3-menu__label"></span></div><div class="b3-menu__items"></div>';
    const scrim = document.createElement("div");
    scrim.id = "commonMenuScrim";
    scrim.className = "b3-menu__scrim";
    document.body.append(scrim, menuElement);
    const {Menu}: typeof import("../../menus/Menu") = load("menus/Menu");
    const menu = new Menu(menuElement);
    window.siyuan.menus.menu = menu;
    const api: typeof import("./fontFamilyMenu") = load("protyle/toolbar/fontFamilyMenu");
    const escape = load("util/escape");
    const toolbar = document.createElement("div");
    toolbar.id = "keyboardToolbar";
    toolbar.className = "keyboard";
    toolbar.style.height = "300px";
    toolbar.innerHTML = '<div class="keyboard__bar"><button class="keyboard__action protyle-toolbar__item--current" data-type="text">Appearance</button></div><div class="keyboard__util"></div>';
    const util = toolbar.querySelector<HTMLElement>(".keyboard__util");
    util.innerHTML = new Function("disableFontFamily", "escapeHtml", "getInlineFontFamilyLabel", "fontFamilyState",
        "return `" + dropdown + "`;")(false, escape.escapeHtml, () => "Default", {});
    document.body.append(toolbar);
    const button = util.querySelector<HTMLElement>('[data-action="fontFamilyMenu"]');
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.textContent = "Selected text";
    document.body.prepend(editor);
    const range = document.createRange();
    range.selectNodeContents(editor);
    const protyle = {disabled: false, toolbar: {range}, wysiwyg: {element: editor}};
    let current = protyle;
    const applied: string[] = [];
    let restored = 0;
    const dependencies = {
        getCurrentEditor: () => ({protyle: current}),
        getFontNodeElements: () => [editor],
        preventKeyboardToolbarRender() {},
        ...api,
        fontEvent: (_owner: unknown, _nodes: unknown, _style: string, value: string) => applied.push(value),
        renderTextMenu: () => { button.querySelector("span").textContent = "Font 12"; },
        restoreKeyboardToolbarRange: () => restored++,
        activeBlur: () => (document.activeElement as HTMLElement)?.blur(),
        keyboardPanelTop: 200,
        notifyMobileKeyboardChange() {},
        hideKeyboardToolbarUtil: () => check.fail("font searches must preserve the appearance panel"),
        hasClosestByClassName: load("protyle/util/hasClosest").hasClosestByClassName,
        takeMenuKeyboard() {}, moved: false,
    };
    const controls = new Function(...Object.keys(dependencies), "let fontFamilyMenu;\n" + toolbarSource +
        "\nreturn {openMobileFontFamilyMenu, hideKeyboardToolbarUtilOnEditorClick, showKeyboardToolbarElement, handler};")(...Object.values(dependencies));
    toolbar.addEventListener("touchend", controls.handler);
    const settle = async () => {
        await new Promise(resolve => setTimeout(resolve, 350));
    };
    const tap = async (element: Element) => {
        check.ok(element, "touch target is present");
        const rect = element.getBoundingClientRect();
        const x = element === scrim ? 20 : rect.left + rect.width / 2;
        const y = element === scrim ? 20 : rect.top + rect.height / 2;
        check.ok(element.contains(document.elementFromPoint(x, y)),
            "touch target is not obscured by another control");
        await require("electron").ipcRenderer.invoke("font-tap", x, y);
        await settle();
    };
    const search = () => menuElement.querySelector<HTMLInputElement>('[data-type="font-family-search"]');
    const swipeDown = async () => {
        const rect = menuElement.firstElementChild.getBoundingClientRect();
        await require("electron").ipcRenderer.invoke("font-swipe", rect.left + rect.width / 2, rect.top + rect.height / 2);
        await settle();
    };
    for (const theme of themes) {
        themeStyle.textContent = theme;
        for (const size of [320, 420]) {
            for (const fontSize of [16, 32]) {
                toolbar.style.fontSize = `${fontSize}px`;
                util.style.width = size + "px";
                check.ok(button.getBoundingClientRect().width >= size - 20, "font dropdown spans both appearance columns");
                check.ok(button.getBoundingClientRect().height >= 40, "dropdown retains a mobile touch target");
                check.notEqual(getComputedStyle(button).backgroundImage, "none", "shared select styling provides the dropdown arrow");
            }
        }
    }
    toolbar.style.fontSize = "";
    util.style.width = "";
    let finishPreviews: (fonts: FontFace[]) => void;
    pendingPreviews = new Promise(resolve => { finishPreviews = resolve; });
    await tap(button);
    const previewLoading = menuElement.querySelector<HTMLElement>('[data-type="font-loading"]');
    const previewLabel = menuElement.querySelector<HTMLElement>('[data-family="Font 0"] .b3-menu__label');
    check.ok(!previewLoading.classList.contains("fn__none"), "font preview waiting shows a spinner beside search");
    check.equal(previewLoading.querySelector(".fn__rotate use").getAttribute("xlink:href"), "#iconRefresh");
    check.equal(previewLabel.style.visibility, "hidden");
    check.equal(menuElement.querySelector<HTMLElement>('[data-family=""] .b3-menu__label').style.visibility, "");
    finishPreviews([]);
    await settle();
    check.ok(previewLoading.classList.contains("fn__none"));
    check.equal(previewLabel.style.visibility, "");
    pendingPreviews = undefined;
    check.ok(menuElement.classList.contains("b3-menu--sheet"));
    check.equal(button.getAttribute("aria-expanded"), "true");
    check.equal(menuElement.querySelector('[data-action="fontFamilyBack"]'), null);
    check.equal(menuElement.querySelector('[data-type="sheet-expand"]'), null, "font sheet has no fullscreen button");
    check.equal(menuElement.querySelector('[data-type="sheet-close"]'), null, "font sheet has no close button");
    check.equal(menuElement.getAttribute("data-sheet-expandable"), "true", "gesture and viewport behavior remain enabled");
    check.ok(util.contains(button), "font list opens outside the original appearance panel");
    check.notEqual(document.activeElement, search(), "opening does not summon the search keyboard");
    check.ok(menuElement.getBoundingClientRect().top > 100, "font sheet opens from the bottom");
    await swipeDown();
    check.ok(menuElement.classList.contains("fn__none"), "a downward touch gesture closes the font sheet");
    check.ok(util.contains(button));
    check.equal(button.getAttribute("aria-expanded"), "false");
    await tap(button);
    await tap(search());
    check.equal(document.activeElement, search());
    controls.showKeyboardToolbarElement();
    controls.hideKeyboardToolbarUtilOnEditorClick();
    await require("electron").ipcRenderer.invoke("font-resize", 350);
    await settle();
    // 断言跟随本次 resize 传入的高度，不是与 innerHeight 自比；设备像素取整会差 1px。
    check.ok(Math.abs(parseFloat(menuElement.style.height) - 350) <= 1,
        "font sheet still tracks the available viewport while searching");
    check.ok(search().getBoundingClientRect().top >= menuElement.getBoundingClientRect().top);
    check.ok(search().getBoundingClientRect().bottom <= innerHeight);
    search().value = "Font 12";
    search().dispatchEvent(new InputEvent("input", {bubbles: true}));
    const visible = menuElement.querySelectorAll('[role="option"]:not(.fn__none)');
    check.equal(visible.length, 1);
    await tap(visible[0]);
    check.ok(menuElement.classList.contains("fn__none"));
    check.equal(applied.length, 1);
    check.match(applied[0], /Font 12/);
    check.equal(restored, 0, "appearance selection does not reopen the editor keyboard");
    check.equal(button.querySelector("span").textContent, "Font 12");
    await require("electron").ipcRenderer.invoke("font-resize", 850);
    await settle();
    await tap(button);
    search().dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    await settle();
    check.ok(menuElement.classList.contains("fn__none"));
    await tap(button);
    await tap(scrim);
    check.ok(menuElement.classList.contains("fn__none"));
    let failPreviews: (error: Error) => void;
    pendingPreviews = new Promise((_resolve, reject) => { failPreviews = reject; });
    await tap(button);
    const failedLoading = menuElement.querySelector<HTMLElement>('[data-type="font-loading"]');
    check.ok(!failedLoading.classList.contains("fn__none"));
    failPreviews(new Error("Font unavailable"));
    await settle();
    check.ok(failedLoading.classList.contains("fn__none"), "failed previews also finish loading");
    const failedLabel = menuElement.querySelector<HTMLElement>('[data-family="Font 0"] .b3-menu__label');
    check.equal(failedLabel.style.visibility, "");
    check.equal(failedLabel.style.fontFamily, "", "font failures retain readable fallback labels");
    await tap(scrim);
    pendingPreviews = new Promise(resolve => { finishPreviews = resolve; });
    await tap(button);
    const closedLoading = menuElement.querySelector<HTMLElement>('[data-type="font-loading"]');
    check.ok(!closedLoading.classList.contains("fn__none"));
    await tap(scrim);
    const closedHTML = closedLoading.outerHTML;
    finishPreviews([]);
    await settle();
    check.equal(closedLoading.outerHTML, closedHTML, "late preview completion does not update a closed picker");
    check.ok(menuElement.classList.contains("fn__none"));
    pendingPreviews = undefined;
    let resolve: (value: {fontItems: typeof fonts}) => void;
    pendingFonts = new Promise(done => { resolve = done; });
    const opening = api.openFontFamilyMenu(button, {disabled: false, mixed: false, onSelect() {}});
    await settle();
    check.equal(menuElement.querySelector(".fn__rotate use").getAttribute("xlink:href"), "#iconRefresh", "font list requests show the spinner too");
    await tap(scrim);
    resolve({fontItems: fonts});
    await opening;
    check.ok(menuElement.classList.contains("fn__none"));
    check.equal(search(), null, "late loading cannot reopen a dismissed font menu");
    pendingFonts = undefined;
    await tap(button);
    current = {...protyle};
    await tap(menuElement.querySelector('[role="option"]'));
    check.equal(applied.length, 1, "changing editors invalidates the saved font operation");
    current = protyle;
    readonly = true;
    await tap(button);
    check.ok(menuElement.classList.contains("fn__none"));
    readonly = false;
    const direct = document.createElement("button");
    document.body.append(direct);
    controls.openMobileFontFamilyMenu(protyle, direct);
    await settle();
    await tap(menuElement.querySelector('[role="option"]'));
    check.equal(restored, 1, "the independent font entry resumes editor input after selection");
    check.equal(applied.length, 2);
    direct.remove();
    toolbar.removeEventListener("touchend", controls.handler);
    toolbar.addEventListener("click", controls.handler);
    await tap(button);
    check.ok(menuElement.classList.contains("b3-menu--sheet"), "click-based mobile entry opens the same font sheet");
    menuElement.dispatchEvent(new CustomEvent("click", {detail: "back"}));
    await settle();
    check.ok(menuElement.classList.contains("fn__none"), "system back closes the font sheet without action buttons");
    toolbar.removeEventListener("click", controls.handler);
    mobile = false;
    fonts = [];
    await api.openFontFamilyMenu(button, {disabled: false, mixed: false, onSelect() {}});
    check.ok(!menuElement.classList.contains("b3-menu--sheet"));
    check.equal(document.activeElement, search(), "desktop keeps automatic search focus");
    search().dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    check.equal(document.activeElement, button, "desktop Escape returns focus to the dropdown");
    check.ok(menuElement.classList.contains("fn__none"));
    check.equal(menuElement.hasAttribute("data-sheet-actions"), false, "closing clears the font-only action preference");
    mobile = true;
    menuElement.setAttribute("data-sheet-expandable", "true");
    menu.addItem({label: "Other menu"});
    menu.fullscreen("bottom");
    await settle();
    check.ok(menuElement.querySelector('[data-type="sheet-expand"]'), "other expandable menus keep their fullscreen button");
    await tap(menuElement.querySelector('[data-type="sheet-close"]'));
    check.ok(menuElement.classList.contains("fn__none"));
    return "Font menu touch and layout cases passed";
};

test("font menus show loading for list requests and previews while retaining mobile and desktop interactions", {timeout: 45000}, async () => {
    const names = ["menus/Menu", "menus/menuPosition", "menus/menuMouseScroll", "menus/menuGroup", "menus/sheetOpen", "menus/sheetActions",
        "menus/menuToggle", "plugin/Menu", "util/setPosition", "protyle/util/hasClosest", "protyle/toolbar/fontFamilyMenu",
        "protyle/toolbar/fontFamilyCore", "util/systemFontCore", "util/fontPreview", "util/escape", "util/upDownHint"];
    const sources = Object.fromEntries(names.map(name => [name, transpileModule(readFileSync(path.join(__dirname, "../..", name + ".ts"), "utf8"), {
        compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
    }).outputText]));
    const toolbarText = readFileSync(path.join(__dirname, "../../mobile/util/keyboardToolbar.ts"), "utf8");
    const file = createSourceFile("keyboardToolbar.ts", toolbarText, ScriptTarget.Latest);
    const declarations = file.statements.filter(node => isVariableStatement(node) && node.declarationList.declarations.some(item =>
        ["openMobileFontFamilyMenu", "hideKeyboardToolbarUtilOnEditorClick", "showKeyboardToolbarElement"].includes(item.name.getText(file))));
    let handler: string;
    const visit = (node: Node) => {
        if (isCallExpression(node) && node.expression.getText(file) === "toolbarElement.addEventListener" &&
            node.arguments[0].getText(file).includes('"touchend"')) handler = node.arguments[1].getText(file);
        forEachChild(node, visit);
    };
    visit(file);
    assert.equal(declarations.length, 3);
    assert.ok(handler);
    const toolbarSource = transpileModule(declarations.map(node => node.getText(file).replace("export ", "")).join("\n") +
        `\nconst handler = ${handler};`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const dropdown = toolbarText.slice(toolbarText.indexOf('<div data-id="fontFamilyWrap"'), toolbarText.indexOf('<div data-id="fontSize"'));
    const css = ["component/_menu.scss", "component/_list.scss", "component/_text-field.scss", "component/_select.scss", "component/_button.scss", "business/_block.scss", "util/_function.scss", "main/_mobile.scss"]
        .map(name => compile(path.join(__dirname, "../../assets/scss", name), {logger: Logger.silent}).css).join("\n");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-font-menu-test-"));
    const script = path.join(temporary, "run.cjs");
    const themes = ["daylight", "midnight"].map(name => readFileSync(path.join(__dirname, `../../../appearance/themes/${name}/theme.css`), "utf8"));
    const invocation = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(toolbarSource)}, ${JSON.stringify(dropdown)}, ${JSON.stringify(css)}, ${JSON.stringify(themes)})`;
    writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false, width:420, height:850, useContentSize:true,
        webPreferences:{nodeIntegration:true, contextIsolation:false, offscreen:true, backgroundThrottling:false}});
    win.webContents.debugger.attach("1.3");
    ipcMain.handle("font-tap", async (_event, x, y) => {
        await win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", {type:"touchStart", touchPoints:[{x,y}]});
        await win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", {type:"touchEnd", touchPoints:[]});
    });
    ipcMain.handle("font-swipe", async (_event, x, y) => {
        await win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", {type:"touchStart", touchPoints:[{x,y}]});
        await win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", {type:"touchMove", touchPoints:[{x,y:y+150}]});
        await win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", {type:"touchEnd", touchPoints:[]});
    });
    ipcMain.handle("font-resize", (_event, height) => win.setContentSize(420, height));
    try {
        await win.loadURL("about:blank");
        await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {enabled:true, maxTouchPoints:1});
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(invocation)}));
        win.destroy(); app.exit(0);
    } catch (error) {
        console.error(error); win.destroy(); app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script], {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Font menu touch and layout cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-font-menu-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
