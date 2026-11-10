import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compileString, Logger} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

const browserCases = async (sources: Record<string, string>, mobile: boolean, css: string) => {
    const check: typeof assert = require("node:assert/strict");
    const notebook = "20260101000000-aaaaaaa", ancestor = "20260101000000-bbbbbbb";
    const root = "20260101000000-ccccccc", leaf = "20260101000000-ddddddd";
    const folder = "20260101000000-eeeeeee";
    const opened: string[] = [];
    const requested: string[] = [];
    const style = document.createElement("style");
    style.textContent = css + ".fn__none{display:none!important}svg{width:16px;height:16px}.b3-menu__item{font-size:20px}";
    document.head.append(style);
    let closed = 0;
    const menuElement = document.createElement("div");
    menuElement.className = "fn__none";
    document.body.append(menuElement);
    const menu = {
        element: menuElement,
        remove() { closed++; menuElement.replaceChildren(); },
        showSubMenu(element: HTMLElement) { element.parentElement.classList.add("b3-menu__item--show"); },
        fullscreen() {}, resetPosition() {}, closeSheet() {},
    };
    const keys = new Proxy({}, {get: () => ({custom: ""})});
    Object.assign(window, {siyuan: {
        notebooks: [{id: notebook, name: "Notebook & <literal>", closed: false}],
        languages: new Proxy({}, {get: (_target, key) => String(key)}), menus: {menu},
        config: {readonly: false, editor: {globalBreadcrumb: true}, keymap: {editor: {general: keys}}},
    }});
    const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    const escapeExports: any = {};
    new Function("exports", sources.escape)(escapeExports);
    const iconValue: any = {};
    new Function("exports", "require", sources.iconValue)(iconValue, () => escapeExports);
    const icon: any = {};
    new Function("exports", "require", sources.icon)(icon, () => iconValue);
    const appearance: any = {};
    new Function("exports", "require", sources.appearance)(appearance, () => ({hasClosestByAttribute: (): null => null}));
    const blocks = [{id: root, name: "Current", type: "NodeDocument"},
        {id: leaf, name: "Block", type: "NodeParagraph"}];
    const pathItems = [
        {id: notebook, name: escape("Notebook & <literal>"), type: "NodeNotebook", globalType: "notebook", icon: "1f4d2"},
        {id: ancestor, name: escape("Parent / & <literal>"), type: "NodeDocument", globalType: "document", icon: "custom.png"},
        {id: root, name: escape('Current <img src=x onerror="alert(1)"> & 日本語'), type: "NodeDocument", icon: "1f600"},
        blocks[1],
    ];
    let globalResult = async () => pathItems;
    const exports: any = {};
    new Function("exports", "window", "document", "isMobile", "updateMenuItemGroupClasses", "applyMenuConfig",
        "updateHotkeyTip", "escapeAttr", "CUSTOM_EVENT_LOAD_SUBMENU", sources.menu)(exports, window, document,
        () => mobile, () => {}, () => {}, (value: string) => value, escape, "load-submenu");
    const MenuItem: typeof import("../../menus/Menu").MenuItem = exports.MenuItem;
    let callbackWork: Promise<void>;
    class PluginMenu {
        isOpen = false;
        element = menuElement;
        constructor(name: string) { menuElement.setAttribute("data-name", name); }
        addItem(item: IMenu) { menuElement.append(new MenuItem(item, menu as any).element); }
    }
    const dependency: Record<string, any> = {
        ...escapeExports, ...appearance, ...icon,
        Constants: new Proxy({}, {get: (_target, key) => String(key)}),
        isMobile: () => mobile, isMac: () => false, isIPad: () => false, isInAndroid: () => false,
        isInHarmony: () => false, updateHotkeyTip: (value: string) => value,
        mountBreadcrumbButtons() {}, bindMobileMenuKeyboard: () => (): void => undefined,
        DocumentHistory: class { refresh() {} destroy() {} },
        getNoContainerElement: (element: Element) => element,
        waitForPendingTransactions: async () => {},
        refreshUndoButtons() {},
        getIconByType: () => "iconFile",
        getDocDisplayName: (value: string) => escape(value),
        isBreadcrumbNotebookAvailable: () => true,
        getGlobalBreadcrumb: async (items: typeof blocks, _notebook: string, _root: string, enabled: boolean) =>
            enabled ? globalResult() : items,
        openMobileFileById: (_app: unknown, id: string) => opened.push(id),
        openFileById: ({id}: {id: string}) => opened.push(id),
        zoomOut: ({id}: {id: string}) => opened.push(id),
        Menu: PluginMenu, MenuItem,
        toggleMenu: async ({build}: {build: (menu: unknown, session: unknown) => Promise<void>}) => {
            await build(menu, {isCurrent: () => true, show: (callback: () => void) => callback()});
        },
        fetchPost: (_url: string, _request: unknown, callback: (response: unknown) => Promise<void>) => {
            callbackWork = callback({code: 0, data: blocks});
        },
        fetchSyncPost: async (_url: string, request: {parentID: string}) => {
            requested.push(request.parentID);
            const files = request.parentID === ancestor ? [{id: folder, name: "Folder & <safe>", subFileCount: 1, icon: "1f4c1"},
                {id: leaf, name: "Leaf", subFileCount: 0, icon: "leaf.png"}] : [{id: leaf, name: "Leaf", subFileCount: 0, icon: "leaf.png"}];
            return {code: 0, data: {files, total: files.length, revision: "v1", stale: false}};
        },
    };
    const compiled: any = {};
    new Function("require", "exports", sources.breadcrumb)(() => dependency, compiled);
    const wysiwyg = document.createElement("div");
    wysiwyg.innerHTML = `<div data-node-id="${root}"></div>`;
    document.body.append(wysiwyg);
    const protyle: any = {app: {}, element: wysiwyg, notebookId: notebook, block: {rootID: root, id: root, showAll: true},
        wysiwyg: {element: wysiwyg}, toolbar: {isMultiSelectMode: () => false}, options: {render: {}}};
    if (mobile) {
        const breadcrumb = Object.create(compiled.Breadcrumb.prototype);
        breadcrumb.element = document.createElement("button");
        await breadcrumb.genMobileMenu(protyle);
        await callbackWork;
        const parent = menuElement.children[1] as HTMLElement;
        check.match(menuElement.children[0].querySelector(".protyle-breadcrumb__graphic").textContent, /📒/);
        check.ok(parent.querySelector("img.protyle-breadcrumb__graphic"));
        check.equal(getComputedStyle(parent.querySelector(".protyle-breadcrumb__graphic")).objectFit, "contain");
        check.equal(getComputedStyle(menuElement.children[0].querySelector(".protyle-breadcrumb__graphic")).fontSize, "16px");
        check.equal(parent.querySelector(".b3-menu__label").textContent, "Parent / & <literal>");
        parent.querySelector(".b3-menu__icon--small").dispatchEvent(new MouseEvent("click", {bubbles: true}));
        await new Promise(resolve => setTimeout(resolve, 0));
        check.equal(closed, 0, "Tapping an ancestor arrow must not close the menu or navigate");
        check.deepEqual(opened, []);
        check.deepEqual(requested, [ancestor]);
        const children = parent.querySelector(".b3-menu__submenu > .b3-menu__items");
        check.equal(children.firstElementChild.textContent, "openBy");
        const folderElement = children.children[1] as HTMLElement;
        check.equal(folderElement.querySelector(".b3-menu__label").textContent, "Folder & <safe>");
        check.match(folderElement.querySelector(".protyle-breadcrumb__graphic").textContent, /📁/);
        check.ok(children.children[2].querySelector("img.protyle-breadcrumb__graphic"));
        folderElement.querySelector(".b3-menu__icon--small").dispatchEvent(new MouseEvent("click", {bubbles: true}));
        await new Promise(resolve => setTimeout(resolve, 0));
        check.deepEqual(requested, [ancestor, folder]);
        check.deepEqual(opened, []);
        folderElement.querySelector<HTMLElement>(".b3-menu__submenu .b3-menu__items > .b3-menu__item").click();
        check.deepEqual(opened, [folder], "The explicit Open action navigates to the selected parent");
        check.equal(closed, 1);
        menuElement.removeAttribute("data-name");
        await breadcrumb.genMobileMenu(protyle);
        await callbackWork;
        const secondParent = menuElement.children[1] as HTMLElement;
        secondParent.click();
        await new Promise(resolve => setTimeout(resolve, 0));
        secondParent.querySelector<HTMLElement>(`[data-id="${leaf}"]`).click();
        check.deepEqual(opened, [folder, leaf], "Leaf documents open directly");
    } else {
        const breadcrumb = new compiled.Breadcrumb(protyle);
        protyle.breadcrumb = breadcrumb;
        document.body.append(breadcrumb.element.parentElement);
        breadcrumb.element.parentElement.style.width = "360px";
        const render = async (update = true) => {
            await breadcrumb.render(protyle, update, wysiwyg.firstElementChild);
            await callbackWork;
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        };
        window.siyuan.config.editor.globalBreadcrumb = false;
        await render();
        check.equal(breadcrumb.element.querySelectorAll(".protyle-breadcrumb__item").length, 2);
        check.equal(breadcrumb.element.querySelector(".protyle-breadcrumb__item").querySelector(".protyle-breadcrumb__text"), null,
            "Disabled global breadcrumbs retain the existing icon-only root when breadcrumbDocName is off");
        check.equal(breadcrumb.element.querySelector("[data-global-type]"), null);
        window.siyuan.config.editor.globalBreadcrumb = true;
        await render(false);
        check.deepEqual(Array.from(breadcrumb.element.querySelectorAll(".protyle-breadcrumb__item"),
            (item: Element) => item.getAttribute("data-node-id")), [null, ancestor, root, leaf]);
        check.equal(breadcrumb.element.querySelectorAll(`[data-node-id="${root}"]`).length, 1);
        check.equal(breadcrumb.element.querySelector(`[data-node-id="${root}"] .protyle-breadcrumb__text`).textContent,
            'Current <img src=x onerror="alert(1)"> & 日本語');
        check.equal(breadcrumb.element.querySelector("script, img[onerror]"), null);
        for (const global of [false, true]) {
            let finish: () => void;
            dependency.waitForPendingTransactions = () => new Promise<void>(resolve => { finish = resolve; });
            window.siyuan.config.editor.globalBreadcrumb = global;
            const oldBlock = wysiwyg.firstElementChild;
            const pendingRender = breadcrumb.render(protyle, true, oldBlock);
            oldBlock.replaceWith(oldBlock.cloneNode(true));
            finish();
            await pendingRender;
            dependency.waitForPendingTransactions = async () => {};
            await render(false);
            check.equal(breadcrumb.element.querySelectorAll('[data-global-type="notebook"]').length, global ? 1 : 0,
                "reloading the same block during a settings refresh must not leave the previous breadcrumb");
        }
        const ancestorIcon = breadcrumb.element.querySelector(`[data-node-id="${ancestor}"] .popover__block`) as HTMLElement;
        check.equal(ancestorIcon.getAttribute("data-id"), ancestor);
        check.ok(ancestorIcon.querySelector("img"));
        check.equal(getComputedStyle(ancestorIcon.querySelector("img")).objectFit, "contain");
        check.equal(getComputedStyle(ancestorIcon).width, "16px");
        check.equal(getComputedStyle(breadcrumb.element.querySelector(`[data-node-id="${root}"] .protyle-breadcrumb__graphic`)).fontSize, "16px");
        const calls: {id: string, keyboard: boolean, parentID: string | undefined}[] = [];
        breadcrumb.openChildrenMenu = (_protyle: unknown, id: string, _position: unknown, keyboard: boolean,
                                       parentID: string | undefined) => calls.push({id, keyboard, parentID});
        const items = breadcrumb.element.querySelectorAll(".protyle-breadcrumb__item");
        breadcrumb.element.querySelector(".protyle-breadcrumb__arrow").click();
        items[1].dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true}));
        items[1].dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true}));
        items[2].dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
        check.deepEqual(calls.map(({id, parentID}) => ({id, parentID})), [
            {id: notebook, parentID: ""}, {id: ancestor, parentID: ancestor},
            {id: ancestor, parentID: ancestor}, {id: root, parentID: undefined},
        ]);
        check.equal(calls[2].keyboard, true);
        check.equal(calls[3].keyboard, true);
        (ancestorIcon.querySelector("img") as HTMLElement).click();
        check.deepEqual(opened, [ancestor]);
        const previousFocus = document.createElement("input");
        document.body.append(previousFocus);
        previousFocus.focus();
        check.equal(breadcrumb.focus(), true);
        check.equal(document.activeElement, items[2]);
        items[2].dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowLeft", bubbles: true, cancelable: true}));
        check.equal(document.activeElement, items[1]);
        check.equal(items[1].getAttribute("tabindex"), "0");
        check.equal(items[2].getAttribute("tabindex"), "-1");
        items[1].dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true}));
        check.equal(document.activeElement, items[2]);
        items[2].dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
        check.equal(document.activeElement, previousFocus);

        Object.assign(pathItems[1], {icon: ""});
        await render();
        check.equal(breadcrumb.element.querySelector(`[data-node-id="${ancestor}"] img`), null);
        check.ok(breadcrumb.element.querySelector(`[data-node-id="${ancestor}"] svg`));
        globalResult = async () => [pathItems[0], ...Array.from({length: 12}, (_, index) => ({
            ...pathItems[1], id: `${ancestor}-${index}`, name: escape(`Long parent ${index} / 日本語 & literal title`),
        })), ...pathItems.slice(2)];
        await render();
        check.equal(getComputedStyle(breadcrumb.element).flexWrap, "nowrap");
        check.ok(breadcrumb.element.clientWidth > 0 && breadcrumb.element.clientWidth < 360);
        check.ok(breadcrumb.element.scrollWidth > breadcrumb.element.clientWidth,
            "A long unified path overflows horizontally in a narrow editor");
        breadcrumb.element.scrollLeft = 0;
        breadcrumb.element.dispatchEvent(new WheelEvent("mousewheel", {deltaY: 120, bubbles: true}));
        check.ok(breadcrumb.element.scrollLeft > 0, "Wheel movement scrolls the path horizontally");

        for (const change of ["disable", "navigate", "destroy"]) {
            const existing = breadcrumb.element.innerHTML;
            let release: (items: typeof pathItems) => void;
            globalResult = () => new Promise(resolve => { release = resolve; });
            await breadcrumb.render(protyle, true, wysiwyg.firstElementChild);
            if (change === "disable") window.siyuan.config.editor.globalBreadcrumb = false;
            else if (change === "navigate") protyle.block.rootID = ancestor;
            else breadcrumb.destroy();
            release(pathItems);
            await callbackWork;
            check.equal(breadcrumb.element.innerHTML, existing, `Late global results are ignored after ${change}`);
            window.siyuan.config.editor.globalBreadcrumb = true;
            protyle.block.rootID = root;
        }
    }
    return "Global breadcrumb DOM cases passed";
};

for (const mobile of [true, false]) {
    test(`global breadcrumbs support real ${mobile ? "mobile MenuItem navigation" : "desktop pointer and keyboard dispatch"}`,
        {timeout: 45000}, async () => {
        const menuSource = readFileSync(path.join(__dirname, "../../menus/Menu.ts"), "utf8");
        const sources = {
            menu: menuSource.slice(menuSource.indexOf("export class MenuItem {"), menuSource.indexOf("const getActionMenu =")),
            breadcrumb: parse(readFileSync(path.join(__dirname, "index.ts"), "utf8"),
                {MOBILE: mobile, BROWSER: true}, false, true, "index.ts"),
            escape: readFileSync(path.join(__dirname, "../../util/escape.ts"), "utf8"),
            icon: readFileSync(path.join(__dirname, "icon.ts"), "utf8"),
            iconValue: readFileSync(path.join(__dirname, "../../emoji/iconValue.ts"), "utf8"),
            appearance: readFileSync(path.join(__dirname, "appearance.ts"), "utf8"),
        };
        for (const key of Object.keys(sources) as (keyof typeof sources)[]) {
            sources[key] = transpileModule(sources[key], {
                compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
            }).outputText;
        }
        const scss = readFileSync(path.join(__dirname, "../../assets/scss/protyle/_protyle.scss"), "utf8");
        const css = compileString(scss.slice(scss.indexOf(".protyle-breadcrumb {"),
            scss.indexOf('.b3-menu[data-name^="breadcrumb-children-"')), {logger: Logger.silent}).css;
        const source = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(sources)}, ${mobile}, ${JSON.stringify(css)})`;
        const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-breadcrumb-dom-"));
        const script = path.join(temporary, "run.cjs");
        writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        await win.webContents.executeJavaScript(${JSON.stringify(readFileSync(path.join(__dirname, "../../../stage/protyle/js/lute/lute.min.js"), "utf8"))});
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(source)}));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
        const env: NodeJS.ProcessEnv = {...process.env, XDG_CACHE_HOME: path.join(temporary, "cache")};
        delete env.ELECTRON_RUN_AS_NODE;
        const args = process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY ?
            ["--ozone-platform=headless", script] : [script];
        try {
            const result = await promisify(execFile)(require("electron") as unknown as string, args,
                {env, timeout: 40000, windowsHide: true});
            assert.match(result.stdout, /Global breadcrumb DOM cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
            assert.ok(path.basename(temporary).startsWith("siyuan-breadcrumb-dom-"));
            rmSync(temporary, {recursive: true, force: true});
        }
    });
}
