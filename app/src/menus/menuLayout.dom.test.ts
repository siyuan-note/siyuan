import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile, Logger} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: Record<string, string>, css: string,
                            themeLabels: {language: string, labels: Record<string, string>}[]) => {
    const check: typeof assert = require("node:assert/strict");
    let mobile = false;
    let mobileApp = false;
    const sessionRows = Array.from({length: 90}, (_, i) => ({id: String(i), title: `Session ${i}`}));
    let sessionRequests = 0;
    const calendarRows = Array.from({length: 50}, (_, i) => ({id: String(i), cells: [
        {id: `block-${i}`, value: {id: `block-${i}`, type: "block", block: {content: `Undated ${i}`, id: `block-${i}`}}},
        {id: `date-${i}`, value: {id: `date-${i}`, keyID: "date", type: "date", date: {}}},
    ]}));
    const modules: Record<string, {exports: any}> = {};
    const externals = {
        "protyle/util/compatibility": {getEventName: () => "click", isInMobileApp: () => mobileApp, isPhablet: () => false,
            updateHotkeyTip: (value: string) => value},
        "util/functions": {isMobile: () => mobile},
        "util/zIndex": {isScrollAboveMenu: () => false},
        "layout/getTopBarHeight": {getTopBarHeight: () => 32},
        constants: {Constants: {TIMEOUT_DBLCLICK: 10, ATTRIBUTE_MENU_KEYMAP: "data-keymap",
            CUSTOM_SY_EMBED_BREADCRUMB_PARENT_PATH: "custom-sy-embed-breadcrumb-parent-path"}},
        "protyle/render/blockRender": {blockRender() {}},
        "protyle/undo": {electronUndo() {}},
        "util/escape": {escapeAttr: (value: string) => value || "", escapeHtml: (value: string) => value || ""},
        "menus/menuKeyboard": {setMenuInputCurrent() {}},
        "plugin/EventBusCore": {forEachPluginSubscriber() {}},
        "mobile/util/keyboardToolbar": {activeBlur() {}},
        "block/popoverLifecycle": {setPopoverMenuOpen() {}},
        "config/entryVisibility/runtime": {applyMenuEntryVisibility() {}},
        "menus/menuToggle": {},
        "protyle/render/av/panels/registry": {getAVPanelDescriptor: () => ({
            render: (context: {html: string}) => {
                context.html = '<div class="b3-menu__items"><input style="height:32px">' +
                    '<div style="height:2000px">Automation settings</div></div>';
                return true;
            },
            bind: (context: {menuElement: HTMLElement}) => context.menuElement.classList.add("av__automation-panel"),
        })},
        "protyle/render/av/panels/drag": {bindAVPanelDrag() {}},
        "protyle/render/av/panels/inputs": {bindAVPanelInputs() {}},
        "protyle/render/av/viewType": {},
        "protyle/wysiwyg/transaction": {},
        "util/fetch": {fetchPost: (_url: string, _data: unknown, callback: () => void) => callback(),
            fetchSyncPost: async (url: string) => {
            check.equal(url, "/api/av/getAttributeViewCalendarUndated");
            return {code: 0, data: {rows: calendarRows, total: calendarRows.length}};
        }},
        "protyle/render/av/automationPosition": {},
        "protyle/render/av/select": {},
        "protyle/render/av/filter": {},
        "protyle/ui/hideElements": {},
        "protyle/render/av/mobilePanel": {},
        "protyle/render/av/view": {getFieldsByData: (): IAVColumn[] => []},
        "protyle/util/selection": {},
        "protyle/render/av/row": {},
        "protyle/render/av/groups": {getPageSize: () => ({})},
        "protyle/render/av/color": {applyAVColorPalette() {}, getAVCustomColors: (): string[] => []},
        "protyle/render/av/panelTarget": {},
        "protyle/render/av/selectPosition": {},
        "protyle/render/av/calendar/date": {},
        "protyle/render/av/calendar/hitTest": {},
        "layout/dock/agent/SessionStore": {SessionStore: {list: async ({page = 1, pageSize = 30}) => {
            sessionRequests++;
            return {sessions: sessionRows.slice((page - 1) * pageSize, page * pageSize), total: sessionRows.length, page};
        }}},
        "layout/dock/agent/path": {},
        "util/pathName": {},
        "util/upDownHint": {},
        "dialog/message": {},
        "util/hostCapabilities": {getHostCapabilities: () => ({localFileSystem: false})},
        "asset/pdf/internal_evt.js": {internalOpt: {}},
        "asset/pdf/pdf_viewer.js": {PagesCountLimit: {FORCE_SCROLL_MODE_PAGE: 10000}},
        "asset/pdf/ui_utils.js": {CursorTool: {SELECT: 0, HAND: 1},
            ScrollMode: {VERTICAL: 0, HORIZONTAL: 1, WRAPPED: 2, PAGE: 3}, SpreadMode: {NONE: 0, ODD: 1, EVEN: 2},
            toggleCheckedBtn: (button: HTMLElement, checked: boolean) => button.classList.toggle("toggled", checked),
            toggleExpandedBtn: (button: HTMLElement, expanded: boolean, panel: HTMLElement) => {
                button.setAttribute("aria-expanded", String(expanded));
                panel.classList.toggle("fn__hidden", !expanded);
            }},
    };
    const load = (name: string): any => {
        if (name in externals) {
            return externals[name as keyof typeof externals];
        }
        if (modules[name]) {
            return modules[name].exports;
        }
        check.ok(sources[name], `Unexpected menu fixture dependency: ${name}`);
        const module = {exports: {}};
        modules[name] = module;
        new Function("require", "module", "exports", sources[name])((dependency: string) => {
            const parts = name.split("/");
            parts.pop();
            dependency.split("/").forEach(part => {
                if (part === "..") {
                    parts.pop();
                } else if (part !== ".") {
                    parts.push(part);
                }
            });
            return load(parts.join("/"));
        }, module, module.exports);
        return module.exports;
    };
    const style = document.createElement("style");
    style.textContent = css + `
        :root { --b3-font-size: 16px; --b3-theme-surface-lighter: #aaa; }
        body { margin: 0; }
        button { font: inherit; }
        .fn__none { display: none !important; }
        .fn__hidden { visibility: hidden !important; }
    `;
    document.head.append(style);
    Object.assign(window, {siyuan: {languages: {back: "Back"}, zIndex: 0, storage: {}, config: {appearance: {}},
        mobile: {size: {portrait: {height1: innerHeight}}}, menus: {}}});
    const {Menu, MenuItem, markMenuInnerScroll}: typeof import("./Menu") = load("menus/Menu");
    const {Menu: PluginMenu}: typeof import("../plugin/Menu") = load("plugin/Menu");
    const settle = async () => {
        for (let i = 0; i < 3; i++) {
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
    };
    const createMenu = () => {
        const element = document.createElement("div");
        element.id = "commonMenu";
        element.className = "b3-menu fn__none";
        element.innerHTML = '<div class="b3-menu__title fn__none"><span class="b3-menu__label"></span></div>' +
            '<div class="b3-menu__items"></div>';
        document.body.append(element);
        const menu = new Menu(element);
        window.siyuan.menus.menu = menu;
        return menu;
    };
    const addItems = (menu: InstanceType<typeof Menu>, count: number) => {
        for (let i = 0; i < count; i++) {
            menu.addItem({label: `Item ${i}`});
        }
    };
    const fitsViewport = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        check.ok(rect.top >= 31.5, `Menu top ${rect.top}`);
        check.ok(rect.bottom <= innerHeight + .5, `Menu bottom ${rect.bottom}, viewport ${innerHeight}`);
        check.ok(rect.left >= 0 && rect.right <= innerWidth + .5,
            `Menu horizontal bounds ${rect.left}, ${rect.right}, viewport ${innerWidth}`);
    };
    const fullyVisible = (element: Element) => check.ok(element.scrollHeight <= element.clientHeight + 1,
        `Content height ${element.scrollHeight}, visible ${element.clientHeight}`);
    const dispose = (menu: InstanceType<typeof Menu>) => {
        menu.remove();
        menu.element.remove();
    };

    const {embedBreadcrumbMenu}: typeof import("../protyle/gutter/embedBreadcrumbMenu") = load("protyle/gutter/embedBreadcrumbMenu");
    Object.assign(window.siyuan.languages, {embedBlockBreadcrumb: "Breadcrumb", embedBlockBreadcrumbParentPath: "Parent path",
        enable: "Enable", disable: "Disable", default: "Default"});
    for (const touch of [false, true]) {
        mobile = touch;
        const embed = document.createElement("div");
        embed.dataset.nodeId = "embed";
        for (const [index, attribute] of ["breadcrumb", "custom-sy-embed-breadcrumb-parent-path"].entries()) {
            for (const [choice, value] of [[0, "true"], [1, "false"], [2, null]] as const) {
                const instance = createMenu();
                instance.addItem(embedBreadcrumbMenu({} as IProtyle, embed)[index]);
                instance.popup({x: 40, y: 40});
                const parent = instance.element.querySelector<HTMLElement>(".b3-menu__item");
                check.equal(parent.querySelector(":scope > svg:not(.b3-menu__icon--small)"), null,
                    "breadcrumb menus have no empty leading icon");
                check.equal(parent.querySelector(":scope > .b3-menu__icon--small use")?.getAttribute("xlink:href"), "#iconRight",
                    "breadcrumb submenu retains the standard arrow");
                parent.dispatchEvent(new MouseEvent(touch ? "click" : "mouseover", {bubbles: true}));
                await settle();
                check.ok(parent.classList.contains("b3-menu__item--show"), "desktop hover and mobile tap open the submenu");
                const options = parent.querySelectorAll<HTMLElement>(".b3-menu__submenu .b3-menu__item");
                check.equal(options.length, 3);
                options[choice].click();
                check.equal(embed.getAttribute(attribute), value);
                dispose(instance);
            }
        }
    }
    mobile = false;

    const menu = createMenu();
    addItems(menu, 2);
    menu.popup({x: 760, y: 600});
    await settle();
    const reset = menu.resetPosition.bind(menu);
    let resets = 0;
    menu.resetPosition = () => { resets++; reset(); };
    addItems(menu, 10);
    await settle();
    check.equal(resets, 1);
    check.ok(menu.element.getBoundingClientRect().bottom <= 600);
    fullyVisible(menu.element.lastElementChild);
    fitsViewport(menu.element);
    await settle();
    check.equal(resets, 1, "Layout writes must not schedule another update");
    for (let i = 0; i < 10; i++) {
        menu.element.lastElementChild.lastElementChild.remove();
    }
    await settle();
    check.equal(menu.element.getBoundingClientRect().top, 600);
    for (const count of [3, 4, 2]) {
        addItems(menu, count);
        await settle();
        fullyVisible(menu.element.lastElementChild);
        fitsViewport(menu.element);
    }
    check.ok(menu.element.getBoundingClientRect().bottom <= 600);

    const label = menu.element.lastElementChild.querySelector(".b3-menu__label");
    label.innerHTML = '<div style="width: 160px; white-space: normal">Short</div>';
    await settle();
    const beforeTextChange = menu.element.getBoundingClientRect().height;
    label.firstElementChild.firstChild.textContent = "Long content ".repeat(40);
    await settle();
    check.ok(menu.element.getBoundingClientRect().height > beforeTextChange, "Text mutations resize the menu");
    fitsViewport(menu.element);
    check.ok(menu.element.lastElementChild.scrollHeight > menu.element.lastElementChild.clientHeight, "Long content scrolls");
    await require("electron").ipcRenderer.invoke("resize-menu-test", 640, 520);
    await settle();
    fitsViewport(menu.element);
    await require("electron").ipcRenderer.invoke("resize-menu-test", 1000, 800);
    await settle();
    fitsViewport(menu.element);
    dispose(menu);

    const themed = createMenu();
    themed.element.style.setProperty("--b3-ui-menu-padding", "24px 0");
    themed.element.style.setProperty("--b3-ui-menu-height", "48px");
    themed.element.style.fontSize = "32px";
    themed.element.style.borderWidth = "3px";
    addItems(themed, 2);
    themed.popup({x: 80, y: 650});
    addItems(themed, 30);
    await settle();
    fitsViewport(themed.element);
    check.ok(themed.element.lastElementChild.scrollHeight > themed.element.lastElementChild.clientHeight);
    dispose(themed);

    const anchored = createMenu();
    const anchor = document.createElement("button");
    anchor.style.cssText = "position:fixed;left:700px;top:580px;width:80px;height:30px";
    document.body.append(anchor);
    const rect = anchor.getBoundingClientRect();
    addItems(anchored, 2);
    anchored.popup({x: rect.left, y: rect.bottom, h: rect.height, w: rect.width, target: anchor});
    addItems(anchored, 40);
    await settle();
    fitsViewport(anchored.element);
    check.ok(anchored.element.getBoundingClientRect().bottom <= rect.top + .5);
    dispose(anchored);
    anchor.remove();

    const submenus = createMenu();
    submenus.addItem({label: "Parent", action: "iconMore", submenu: [
        {label: "Child", submenu: [{label: "Grandchild"}]},
    ]});
    submenus.popup({x: 720, y: 650});
    const parent = submenus.element.lastElementChild.firstElementChild;
    const submenu = parent.querySelector<HTMLElement>(":scope > .b3-menu__submenu");
    const nested = submenu.querySelector<HTMLElement>(".b3-menu__submenu");
    parent.classList.add("b3-menu__item--show");
    submenus.showSubMenu(submenu);
    for (let i = 0; i < 30; i++) {
        submenu.lastElementChild.append(new MenuItem({label: `Subitem ${i}`}, submenus).element);
    }
    await settle();
    fitsViewport(submenu);
    check.equal((nested.lastElementChild as HTMLElement).style.maxHeight, "");
    const child = submenu.lastElementChild.firstElementChild;
    child.classList.add("b3-menu__item--show");
    submenus.showSubMenu(nested);
    for (let i = 0; i < 30; i++) {
        nested.lastElementChild.append(new MenuItem({label: `Nested ${i}`}, submenus).element);
    }
    await settle();
    fitsViewport(submenu);
    fitsViewport(nested);
    submenu.dataset.anchor = "action";
    submenus.resetPosition();
    fitsViewport(submenu);
    dispose(submenus);

    const appearance: typeof import("../protyle/render/listMindmap/appearance") = load("protyle/render/listMindmap/appearance");
    for (const touch of [false, true]) {
        mobile = touch;
        await require("electron").ipcRenderer.invoke("resize-menu-test", touch ? 360 : 640, 520);
        await settle();
        window.siyuan.mobile.size.portrait.height1 = innerHeight;
        for (const {fontSize, language, labels} of [16, 24].flatMap(fontSize => themeLabels.map(data => ({fontSize, ...data})))) {
            document.documentElement.style.setProperty("--b3-font-size", `${fontSize}px`);
            const instance = createMenu();
            const metadata: import("../protyle/render/listMindmap/model").ListMindmapMetadata = {version: 1, nodes: {}, relations: []};
            let changes = 0;
            const menu = appearance.getListMindmapAppearanceMenu(metadata, update => { update(metadata); changes++; },
                labels, {id: "connectorStyle"});
            instance.addItem((menu.submenu as IMenu[]).find(item => item.id === "theme"));
            if (touch) {
                instance.fullscreen("bottom");
            } else {
                instance.popup({x: 280, y: 90});
            }
            const parent = instance.element.querySelector<HTMLElement>('[data-id="theme"]');
            parent.dispatchEvent(new MouseEvent(touch ? "click" : "mouseover", {bubbles: true}));
            await settle();
            if (touch) {
                for (let attempt = 0; attempt < 20 && instance.element.style.transform !== "translateY(0px)"; attempt++) {
                    await settle();
                }
                check.equal(instance.element.style.transform, "translateY(0px)");
                instance.element.getAnimations({subtree: true}).forEach(animation => animation.finish());
                await settle();
            }
            const panel = parent.querySelector<HTMLElement>(":scope > .b3-menu__submenu");
            const items = panel.querySelector<HTMLElement>(":scope > .b3-menu__items");
            check.equal(items.children.length, appearance.LIST_MINDMAP_PALETTES.length + 1);
            check.ok(items.scrollHeight > items.clientHeight, "theme choices scroll inside a bounded menu");
            if (!touch) {
                fitsViewport(panel);
                check.ok(items.clientHeight <= Math.min(480, innerHeight * .6) + 1,
                    "desktop themes keep the preferred height within viewport limits");
            } else {
                const bounds = panel.getBoundingClientRect();
                check.ok(bounds.top >= 0 && bounds.bottom <= innerHeight + 1,
                    "mobile theme choices fit the visible sheet after its opening transition");
                check.ok(bounds.left >= 0 && bounds.right <= innerWidth + 1, "mobile themes fit a narrow screen");
            }
            const widestRow = Math.max(...Array.from(items.children, row => {
                const label = row.querySelector<HTMLElement>(".b3-menu__label");
                const range = document.createRange();
                range.selectNodeContents(label);
                const textWidth = range.getBoundingClientRect().width;
                check.ok(textWidth <= label.getBoundingClientRect().width + 1,
                    `${language} ${fontSize}px: localized theme names remain fully visible`);
                const padding = getComputedStyle(row);
                const controlsWidth = Array.from(row.children).filter(child => child !== label).reduce((sum, child) => {
                    const style = getComputedStyle(child);
                    return sum + child.getBoundingClientRect().width + parseFloat(style.marginLeft) + parseFloat(style.marginRight);
                }, 0);
                return textWidth + controlsWidth + parseFloat(padding.paddingLeft) + parseFloat(padding.paddingRight);
            }));
            for (const [index, preset] of appearance.LIST_MINDMAP_PALETTES.entries()) {
                const row = items.children[index + 1];
                const preview = row.querySelector<HTMLElement>(".mindmap-view__theme-preview");
                const label = row.querySelector<HTMLElement>(".b3-menu__label");
                check.equal(preview.getAttribute("aria-hidden"), "true");
                check.ok(getComputedStyle(preview).backgroundImage.startsWith("linear-gradient("));
                check.ok(new Set(getComputedStyle(preview).backgroundImage.match(/rgb\([^)]+\)/g)).size >= 3,
                    "the preview shows multiple representative theme colors");
                check.equal(preview.getBoundingClientRect().width, 48);
                check.ok(label.getBoundingClientRect().left >= preview.getBoundingClientRect().right);
                check.equal(label.textContent, labels[preset.label]);
            }
            if (!touch) {
                const padding = getComputedStyle(items);
                const chromeWidth = panel.getBoundingClientRect().width - items.clientWidth +
                    parseFloat(padding.paddingLeft) + parseFloat(padding.paddingRight);
                check.ok(panel.getBoundingClientRect().width <= widestRow + chromeWidth + 1,
                    `${language} ${fontSize}px: the menu fits its content without a fixed label spacer`);
            }
            const selected = items.querySelector<HTMLElement>(".b3-menu__checked");
            const selectedLabel = selected.previousElementSibling.getBoundingClientRect();
            check.ok(selected.getBoundingClientRect().left >= selectedLabel.right, "the checkmark does not overlap the name");
            const last = items.lastElementChild as HTMLElement;
            items.scrollTop = items.scrollHeight;
            const lastBounds = last.getBoundingClientRect();
            check.ok(lastBounds.bottom <= items.getBoundingClientRect().bottom + 1,
                "the final theme remains reachable without expanding the menu");
            last.click();
            check.equal(changes, 1);
            check.deepEqual(metadata.appearance.palette, appearance.LIST_MINDMAP_PALETTES.at(-1).colors);
            dispose(instance);
        }
    }
    document.documentElement.style.setProperty("--b3-font-size", "16px");
    mobile = false;
    await require("electron").ipcRenderer.invoke("resize-menu-test", 1000, 800);
    await settle();
    window.siyuan.mobile.size.portrait.height1 = innerHeight;

    const shared = createMenu();
    const independent = new PluginMenu(undefined, undefined, true);
    independent.addItem({label: "First"});
    independent.open({x: 400, y: 650});
    for (let i = 0; i < 12; i++) {
        independent.addItem({label: `Plugin ${i}`});
    }
    await settle();
    fitsViewport(independent.element);
    fullyVisible(independent.element.lastElementChild);
    check.ok(independent.element.getBoundingClientRect().bottom <= 650);
    independent.close();
    await settle();
    check.equal(independent.element.isConnected, false);
    dispose(shared);

    const pointer = (element: HTMLElement, ratio: number, pointerType = "mouse", buttons = 0) => {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height * ratio;
        const target = document.elementFromPoint(x, y);
        check.ok(target && element.contains(target),
            `Pointer must hit ${element.className} at ${x}, ${y}; hit ${target?.className}`);
        target.dispatchEvent(new PointerEvent("pointermove", {bubbles: true, pointerType, buttons, clientX: x, clientY: y}));
        return {x, y};
    };
    const following = createMenu();
    let clicked = -1;
    for (let i = 0; i < 80; i++) {
        following.addItem({label: `Mouse item ${i}`, click: () => { clicked = i; return true; }});
    }
    following.popup({x: 60, y: 40});
    await settle();
    const followingItems = following.element.lastElementChild as HTMLElement;
    const maxScroll = () => followingItems.scrollHeight - followingItems.clientHeight;
    pointer(followingItems, .3);
    pointer(followingItems, .6);
    check.equal(followingItems.scrollTop, 0, "The preference defaults to off");
    window.siyuan.config.appearance.menuMouseScroll = true;
    pointer(followingItems, .3);
    check.equal(followingItems.scrollTop, 0, "Entering establishes an anchor without jumping");
    pointer(followingItems, .55);
    const middleScroll = followingItems.scrollTop;
    check.ok(middleScroll > 0 && middleScroll < maxScroll(), "Movement in the middle of the menu scrolls its contents");
    const middlePoint = pointer(followingItems, .55);
    await settle();
    check.equal(followingItems.scrollTop, middleScroll, "A stationary pointer does not keep scrolling");
    const hit = document.elementFromPoint(middlePoint.x, middlePoint.y).closest<HTMLElement>(".b3-menu__item");
    check.ok(hit.classList.contains("b3-menu__item--current"), "Highlight follows the item under the pointer after scrolling");
    hit.click();
    check.equal(clicked, Number(hit.textContent.trim().replace("Mouse item ", "")), "Click activates the highlighted item");
    pointer(followingItems, .8);
    check.ok(followingItems.scrollTop > middleScroll);
    pointer(followingItems, .55);
    check.ok(Math.abs(followingItems.scrollTop - middleScroll) <= 1, "Reversing direction scrolls back");
    pointer(followingItems, .99);
    check.equal(followingItems.scrollTop, maxScroll(), "The last item is reachable");
    pointer(followingItems, .01);
    check.equal(followingItems.scrollTop, 0, "The first item is reachable");
    pointer(followingItems, .5, "touch");
    pointer(followingItems, .8, "touch");
    check.equal(followingItems.scrollTop, 0, "Touch movement preserves native scrolling");
    pointer(followingItems, .3);
    pointer(followingItems, .7, "mouse", 1);
    check.equal(followingItems.scrollTop, 0, "Dragging does not scroll the menu");
    pointer(followingItems, .3);
    pointer(followingItems, .55);
    followingItems.scrollTop = 100;
    followingItems.dispatchEvent(new WheelEvent("wheel", {bubbles: true, deltaY: -30}));
    pointer(followingItems, .6);
    check.equal(followingItems.scrollTop, 100, "Wheel scrolling establishes a new anchor");
    pointer(followingItems, .7);
    const beforeLeave = followingItems.scrollTop;
    following.element.dispatchEvent(new PointerEvent("pointerleave"));
    pointer(followingItems, .4);
    check.equal(followingItems.scrollTop, beforeLeave, "Reentering does not jump");
    following.addItem({label: "Loaded later"});
    await settle();
    check.equal(followingItems.scrollTop, beforeLeave, "Layout measurement preserves the existing scroll position");
    const beforeMutationMove = followingItems.scrollTop;
    pointer(followingItems, .6);
    check.equal(followingItems.scrollTop, beforeMutationMove, "Dynamic content establishes a new anchor");
    window.siyuan.config.appearance.menuMouseScroll = false;
    pointer(followingItems, .8);
    check.equal(followingItems.scrollTop, beforeMutationMove, "Disabling takes effect on an open menu");
    window.siyuan.config.appearance.menuMouseScroll = true;
    followingItems.scrollTop = 0;
    following.resetMouseScroll();
    const nativePointer = (type: string, x: number, y: number) =>
        require("electron").ipcRenderer.invoke("menu-test-pointer", type, Math.round(x), Math.round(y));
    await nativePointer("mouseMove", 0, 0);
    await settle();
    const nativeRect = followingItems.getBoundingClientRect();
    const nativeX = nativeRect.left + nativeRect.width / 2;
    await nativePointer("mouseMove", nativeX, nativeRect.top + nativeRect.height * .3);
    await settle();
    const nativeY = nativeRect.top + nativeRect.height * .55;
    await nativePointer("mouseMove", nativeX, nativeY);
    await settle();
    check.ok(followingItems.scrollTop > 0, "Real browser mouse movement scrolls the whole menu");
    const nativeHit = document.elementFromPoint(Math.round(nativeX), Math.round(nativeY)).closest<HTMLElement>(".b3-menu__item");
    check.ok(nativeHit.classList.contains("b3-menu__item--current"), "Native hover matches the scrolled target");
    await nativePointer("mouseDown", nativeX, nativeY);
    await nativePointer("mouseUp", nativeX, nativeY);
    check.equal(clicked, Number(nativeHit.textContent.trim().replace("Mouse item ", "")), "Native click selects the visible item");
    dispose(following);

    const abovePointer = createMenu();
    addItems(abovePointer, 80);
    abovePointer.popup({x: 60, y: innerHeight - 30, h: 20});
    await settle();
    const aboveItems = abovePointer.element.lastElementChild as HTMLElement;
    check.ok(aboveItems.getBoundingClientRect().bottom <= innerHeight - 30);
    for (const entry of [.99, .7, .4]) {
        aboveItems.scrollTop = 0;
        abovePointer.resetMouseScroll();
        pointer(aboveItems, entry);
        check.equal(aboveItems.scrollTop, 0, "Opening above the pointer still starts at the first item");
        pointer(aboveItems, entry - .05);
        check.ok(aboveItems.scrollTop > 0, "Moving upward after entry follows the pointer without a wheel event");
        pointer(aboveItems, .99);
        check.equal(aboveItems.scrollTop, aboveItems.scrollHeight - aboveItems.clientHeight);
        pointer(aboveItems, .01);
        check.equal(aboveItems.scrollTop, 0);
    }
    aboveItems.scrollTop = aboveItems.scrollHeight - aboveItems.clientHeight;
    abovePointer.resetMouseScroll();
    pointer(aboveItems, .01);
    pointer(aboveItems, .06);
    check.ok(aboveItems.scrollTop < aboveItems.scrollHeight - aboveItems.clientHeight,
        "Moving downward after entry at the last item also follows the pointer");
    dispose(abovePointer);

    window.siyuan.config.appearance.menuMouseScroll = true;
    const mouseSubmenus = createMenu();
    mouseSubmenus.addItem({label: "Scrollable children", submenu: Array.from({length: 80}, (_, i) => ({label: `Child ${i}`}))});
    addItems(mouseSubmenus, 50);
    mouseSubmenus.popup({x: 40, y: 40});
    await settle();
    const mouseParent = mouseSubmenus.element.lastElementChild.firstElementChild;
    mouseParent.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    const mouseSubmenu = mouseParent.querySelector<HTMLElement>(".b3-menu__submenu");
    const mouseChildren = mouseSubmenu.lastElementChild as HTMLElement;
    pointer(mouseChildren, .3);
    pointer(mouseChildren, .65);
    check.ok(mouseChildren.scrollTop > 0, "Submenus support movement across their own visible area");
    const mouseRootItems = mouseSubmenus.element.lastElementChild as HTMLElement;
    check.equal(mouseRootItems.scrollTop, 0, "Moving within a submenu leaves its parent stationary");
    pointer(mouseRootItems, .3);
    pointer(mouseRootItems, .65);
    check.ok(mouseRootItems.scrollTop > 0);
    check.equal(mouseParent.classList.contains("b3-menu__item--show"), false, "Scrolling the parent closes its detached submenu");
    dispose(mouseSubmenus);

    const lazyMouse = createMenu();
    for (let i = 0; i < 60; i++) {
        lazyMouse.addItem({label: `Lazy ${i}`, loadSubmenu: async () => [{label: `Loaded ${i}`}]});
    }
    lazyMouse.popup({x: 40, y: 40});
    await settle();
    const lazyItems = lazyMouse.element.lastElementChild as HTMLElement;
    pointer(lazyItems, .3);
    pointer(lazyItems, .6);
    await settle();
    const lazyScroll = lazyItems.scrollTop;
    check.ok(lazyScroll > 0, "Asynchronous submenu loading preserves the parent's scroll position");
    const loadedMenu = lazyItems.querySelector(".b3-menu__item--show > .b3-menu__submenu");
    check.match(loadedMenu.textContent, /Loaded \d+/, "The item under a scrolled pointer loads its asynchronous submenu");
    pointer(lazyItems, .75);
    check.ok(lazyItems.scrollTop > lazyScroll, "Loading a child does not interrupt scrolling of its unchanged parent");
    dispose(lazyMouse);

    const form = createMenu();
    form.addItem({type: "empty", label: '<input class="b3-text-field" style="height:32px"><div style="height:80px;overflow:auto"><div style="height:400px">Custom list</div></div>'});
    addItems(form, 50);
    form.popup({x: 40, y: 40});
    await settle();
    const formItems = form.element.lastElementChild as HTMLElement;
    const input = formItems.querySelector("input");
    input.focus();
    pointer(formItems, .4);
    pointer(formItems, .7);
    check.equal(formItems.scrollTop, 0, "Editing a menu input keeps the form stationary");
    input.blur();
    const customList = input.nextElementSibling as HTMLElement;
    pointer(customList, .2);
    pointer(customList, .7);
    check.equal(formItems.scrollTop, 0, "Nested scrollable widgets keep their own interaction");
    dispose(form);

    const avMenu = createMenu();
    const avBlock = document.createElement("div");
    avBlock.className = "av";
    avBlock.innerHTML = '<div class="av__views" style="position:fixed;left:200px;top:40px;width:100px;height:20px"></div>';
    document.body.append(avBlock);
    const {openMenuPanel}: typeof import("../protyle/render/av/openMenuPanel") = load("protyle/render/av/openMenuPanel");
    openMenuPanel({type: "config", blockElement: avBlock, data: {} as IAV, protyle: {} as IProtyle});
    await settle();
    const avPanel = document.querySelector<HTMLElement>(".av__panel");
    const avItems = avPanel.querySelector<HTMLElement>(".b3-menu__items");
    check.ok(avPanel.querySelector(".av__automation-panel"));
    check.ok(avItems.scrollHeight > avItems.clientHeight, "The database panel has overflowing form content");
    window.siyuan.config.appearance.menuMouseScroll = false;
    pointer(avItems, .3);
    pointer(avItems, .7);
    check.equal(avItems.scrollTop, 0, "Database panels respect the disabled preference");
    window.siyuan.config.appearance.menuMouseScroll = true;
    pointer(avItems, .3);
    pointer(avItems, .7);
    check.equal(avItems.scrollTop, 0, "Database forms stay stationary even with the preference enabled and no focused input");
    avItems.scrollTop = 0;
    const avInput = avItems.querySelector("input");
    avInput.focus();
    pointer(avItems, .3);
    pointer(avItems, .7);
    check.equal(avItems.scrollTop, 0, "Editing database form inputs keeps the panel stationary");
    avInput.blur();
    avPanel.remove();
    avBlock.remove();
    dispose(avMenu);

    const pluginShared = createMenu();
    const followingPlugin = new PluginMenu(undefined, undefined, true);
    for (let i = 0; i < 80; i++) followingPlugin.addItem({label: `Plugin scroll ${i}`});
    followingPlugin.open({x: 40, y: 40});
    await settle();
    const pluginItems = followingPlugin.element.lastElementChild as HTMLElement;
    pointer(pluginItems, .3);
    pointer(pluginItems, .7);
    check.ok(pluginItems.scrollTop > 0, "Independent plugin menus share the same mouse scrolling behavior");
    followingPlugin.close();
    check.equal(followingPlugin.element.isConnected, false);
    dispose(pluginShared);

    const multiple = createMenu();
    addItems(multiple, 80);
    multiple.popup({x: 40, y: 40});
    await settle();
    const hiddenItems = multiple.element.lastElementChild;
    const visibleItems = hiddenItems.cloneNode(true) as HTMLElement;
    hiddenItems.classList.add("fn__none");
    multiple.element.append(visibleItems);
    pointer(visibleItems, .3);
    pointer(visibleItems, .7);
    check.ok(visibleItems.scrollTop > 0, "A hidden sibling must not intercept the visible list's scrolling");
    check.equal(hiddenItems.scrollTop, 0);
    dispose(multiple);

    const innerScroll = createMenu();
    const openModelPicker = new Function("toggleMenu", "Menu", "markMenuInnerScroll", "escapeHTML", "upDownHint",
        sources.modelPicker + "\nreturn openAvailableModelMenu;")(
        ({build}: {build: (menu: unknown, session: {show: (show: () => void) => void}) => void}) =>
            build(undefined, {show: show => show()}), PluginMenu, markMenuInnerScroll, (value: string) => value, () => {});
    const modelInput = document.createElement("input");
    modelInput.style.cssText = "position:fixed;left:40px;top:40px;height:28px";
    document.body.append(modelInput);
    openModelPicker(modelInput, Array.from({length: 60}, (_, index) => `Model ${index}`));
    check.ok(innerScroll.element.querySelector(".b3-menu__filter").getBoundingClientRect().height > innerHeight * .5 + 20,
        "the model picker must enable inner scrolling before popup measures its height");
    fitsViewport(innerScroll.element);
    const innerScrollItems = markMenuInnerScroll(innerScroll.element);
    innerScroll.popup({x: 40, y: 40});
    await settle();
    check.ok(innerScrollItems === innerScroll.element.lastElementChild,
        "markMenuInnerScroll returns the content container");
    check.ok(innerScrollItems.classList.contains("b3-menu__items--inner-scroll"), "the container is marked for inner scrolling");
    check.equal(getComputedStyle(innerScrollItems).overflow, "visible", "the container does not scroll by itself");
    innerScroll.remove();
    check.equal(innerScrollItems.classList.contains("b3-menu__items--inner-scroll"), false,
        "closing the menu clears the inner scroll marker");
    dispose(innerScroll);
    modelInput.remove();

    const {getPdfViewerHTML} = load("asset/pdf/viewerTemplate");
    const {SecondaryToolbar} = load("asset/pdf/secondary_toolbar.js");
    const createPDFMenu = () => {
        const host = document.createElement("div");
        host.innerHTML = getPdfViewerHTML();
        document.body.append(host);
        const buttonIDs = {toggleButton: "secondaryToolbarToggleButton", presentationModeButton: "presentationMode",
            openFileButton: "secondaryOpenFile", printButton: "secondaryPrint", downloadButton: "secondaryDownload",
            viewBookmarkButton: "viewBookmark", firstPageButton: "firstPage", lastPageButton: "lastPage",
            pageRotateCwButton: "pageRotateCw", pageRotateCcwButton: "pageRotateCcw", cursorSelectToolButton: "cursorSelectTool",
            cursorHandToolButton: "cursorHandTool", scrollPageButton: "scrollPage", scrollVerticalButton: "scrollVertical",
            scrollHorizontalButton: "scrollHorizontal", scrollWrappedButton: "scrollWrapped", spreadNoneButton: "spreadNone",
            spreadOddButton: "spreadOdd", spreadEvenButton: "spreadEven", imageAltTextSettingsButton: "imageAltTextSettings",
            documentPropertiesButton: "documentProperties"};
        const buttons = Object.fromEntries(Object.entries(buttonIDs).map(([key, id]) =>
            [key, host.querySelector<HTMLElement>(`#${id}`) || document.createElement("button")]));
        const toolbar = host.querySelector<HTMLElement>("#secondaryToolbar");
        toolbar.style.cssText = "position:fixed;left:40px;top:60px;width:300px";
        const events: string[] = [];
        const controller = new SecondaryToolbar({...buttons, toolbar}, {on() {}, dispatch: (name: string) => events.push(name)});
        controller.setPagesCount(100);
        controller.setPageNumber(5);
        controller.open();
        return {host, controller, events, buttons, items: toolbar.querySelector<HTMLElement>(".b3-menu__items")};
    };
    const pdfMenu = createPDFMenu();
    window.siyuan.config.appearance.menuMouseScroll = false;
    pointer(pdfMenu.items, .3);
    pointer(pdfMenu.items, .7);
    check.equal(pdfMenu.items.scrollTop, 0, "PDF menus respect the disabled preference");
    window.siyuan.config.appearance.menuMouseScroll = true;
    pointer(pdfMenu.items, .3);
    pointer(pdfMenu.items, .7);
    check.ok(pdfMenu.items.scrollTop > 0, "PDF toolbar menus support mouse scrolling");
    const pdfScroll = pdfMenu.items.scrollTop;
    pdfMenu.buttons.firstPageButton.click();
    check.ok(pdfMenu.events.includes("firstpage"), "PDF menu commands still dispatch their original action");
    pdfMenu.controller.open();
    pointer(pdfMenu.items, .4);
    check.equal(pdfMenu.items.scrollTop, pdfScroll, "Reopening a PDF menu resets its pointer anchor");
    pdfMenu.host.remove();

    const {getCalendarUndatedHTML, bindCalendarUndated} = load("protyle/render/av/calendar/undated");
    const createCalendarMenu = () => {
        const editor = document.createElement("div");
        editor.contentEditable = "true";
        const root = document.createElement("div");
        root.className = "av";
        root.contentEditable = "false";
        root.dataset.avType = "calendar";
        const state = {undatedOpen: false, undatedSearch: ""};
        root.innerHTML = "<button data-calendar-undated-toggle></button>" + getCalendarUndatedHTML(state);
        editor.append(root);
        document.body.append(editor);
        const panel = root.querySelector<HTMLElement>("[data-calendar-undated-panel]");
        if (!mobile) {
            panel.style.cssText = "position:fixed;left:40px;top:60px;width:300px";
        }
        const opened: string[] = [];
        bindCalendarUndated({root, blockElement: root, data: {view: {calendar: {dateKeyID: "date"}}}, state, query: "",
            onOpen: (row: {id: string}) => opened.push(row.id), onSchedule() {}});
        const toggle = root.querySelector<HTMLButtonElement>("[data-calendar-undated-toggle]");
        toggle.click();
        return {editor, root, state, toggle, panel, opened, items: panel.querySelector<HTMLElement>("[data-calendar-undated-list]"),
            search: panel.querySelector<HTMLInputElement>("input")};
    };
    const calendarMenu = createCalendarMenu();
    await settle();
    const searchTop = calendarMenu.search.getBoundingClientRect().top;
    calendarMenu.search.value = "Draft search";
    calendarMenu.search.setSelectionRange(2, 5);
    window.siyuan.config.appearance.menuMouseScroll = false;
    pointer(calendarMenu.items, .3);
    pointer(calendarMenu.items, .7);
    check.equal(calendarMenu.items.scrollTop, 0, "Calendar lists respect the disabled preference");
    window.siyuan.config.appearance.menuMouseScroll = true;
    pointer(calendarMenu.items, .3);
    pointer(calendarMenu.items, .7);
    check.ok(calendarMenu.items.scrollTop > 0, "Calendar undated lists support mouse scrolling");
    check.equal(calendarMenu.search.getBoundingClientRect().top, searchTop, "Only calendar results scroll");
    check.equal(calendarMenu.search.value, "Draft search");
    check.equal(calendarMenu.search.selectionStart, 2);
    check.equal(calendarMenu.search.selectionEnd, 5);
    const calendarScroll = calendarMenu.items.scrollTop;
    pointer(calendarMenu.items, .3, "mouse", 1);
    pointer(calendarMenu.items, .7, "mouse", 1);
    check.equal(calendarMenu.items.scrollTop, calendarScroll, "Mouse dragging does not scroll calendar results");
    calendarMenu.toggle.click();
    calendarMenu.toggle.click();
    await settle();
    const reopenedScroll = calendarMenu.items.scrollTop;
    pointer(calendarMenu.items, .4);
    check.equal(calendarMenu.items.scrollTop, reopenedScroll, "Reopening calendar results resets the pointer anchor");
    calendarMenu.items.querySelector<HTMLButtonElement>("[data-calendar-undated-open]").click();
    check.deepEqual(calendarMenu.opened, ["0"]);
    calendarMenu.toggle.click();
    calendarMenu.editor.remove();

    const {AgentSessionPanel} = load("layout/dock/agent/AgentSessionPanel");
    const trigger = document.createElement("button");
    document.body.append(trigger);
    const sessions = new AgentSessionPanel(trigger, document.body, () => "", () => "Untitled", {onRename: async () => {}});
    await sessions.render();
    const sessionRoot = document.querySelector<HTMLElement>(".agent-session-popup");
    sessionRoot.style.cssText = "position:fixed;left:40px;top:60px;width:300px";
    const sessionItems = sessionRoot.querySelector<HTMLElement>(".b3-list");
    const sessionSearch = sessionRoot.querySelector<HTMLInputElement>("input");
    window.siyuan.config.appearance.menuMouseScroll = false;
    pointer(sessionItems, .3);
    pointer(sessionItems, .7);
    check.equal(sessionItems.scrollTop, 0, "Session lists respect the disabled preference");
    window.siyuan.config.appearance.menuMouseScroll = true;
    pointer(sessionItems, .3);
    pointer(sessionItems, .7);
    check.ok(sessionItems.scrollTop > 0, "Session lists use their custom scrolling container");
    check.equal(document.activeElement, sessionSearch, "Scrolling results preserves the fixed search field's focus");
    pointer(sessionItems, .95);
    await settle();
    check.ok(sessionRequests > 1, "Mouse scrolling preserves session pagination");
    sessionItems.querySelector<HTMLElement>(".b3-list-item__action").click();
    const rename = sessionItems.querySelector<HTMLInputElement>("input");
    check.equal(document.activeElement, rename);
    const renameScroll = sessionItems.scrollTop;
    pointer(sessionItems, .3);
    pointer(sessionItems, .7);
    check.equal(sessionItems.scrollTop, renameScroll, "Renaming a session keeps the whole result list stationary");
    rename.blur();
    await settle();
    const more = sessionItems.querySelector<HTMLElement>(".agent-session-more");
    more.click();
    const sessionSubmenu = more.querySelector<HTMLElement>(".b3-menu__items");
    const beforeSubmenu = sessionItems.scrollTop;
    pointer(sessionSubmenu, .3);
    pointer(sessionSubmenu, .7);
    check.equal(sessionItems.scrollTop, beforeSubmenu, "Session action submenus do not scroll their parent list");
    sessions.destroy();
    trigger.remove();

    mobileApp = true;
    const appPDF = createPDFMenu();
    pointer(appPDF.items, .3);
    pointer(appPDF.items, .7);
    check.equal(appPDF.items.scrollTop, 0, "Native mobile apps ignore a saved desktop preference");
    appPDF.host.remove();
    mobileApp = false;

    mobile = true;
    const mobilePDF = createPDFMenu();
    pointer(mobilePDF.items, .3);
    pointer(mobilePDF.items, .7);
    check.equal(mobilePDF.items.scrollTop, 0, "Mobile PDF menus preserve their touch interaction");
    mobilePDF.host.remove();
    const sheet = createMenu();
    sheet.element.classList.add("b3-menu--fit");
    addItems(sheet, 2);
    sheet.fullscreen("bottom", undefined, {preserveKeyboard: true});
    await settle();
    const sheetHeight = sheet.element.getBoundingClientRect().height;
    const resetSheet = sheet.resetPosition.bind(sheet);
    let sheetResets = 0;
    sheet.resetPosition = () => { sheetResets++; resetSheet(); };
    addItems(sheet, 10);
    await settle();
    const sheetItems = sheet.element.lastElementChild as HTMLElement;
    pointer(sheetItems, .3);
    pointer(sheetItems, .7);
    check.equal(sheetItems.scrollTop, 0, "Mobile sheets ignore mouse-follow scrolling even with a saved preference");
    check.ok(sheet.element.getBoundingClientRect().height > sheetHeight);
    check.ok(sheet.element.getBoundingClientRect().height <= innerHeight * .9 + .5);
    check.equal(sheetResets, 1);
    await settle();
    check.equal(sheetResets, 1, "Sheet title updates must not cause a layout loop");
    addItems(sheet, 2);
    await Promise.resolve();
    sheet.remove();
    await settle();
    check.equal(sheetResets, 1, "Closing cancels the pending layout update");
    sheet.element.remove();

    const mobileCommon = createMenu();
    const mobileCalendar = createCalendarMenu();
    await settle();
    await Promise.all(mobileCommon.element.getAnimations().map(animation => animation.finished));
    pointer(mobileCommon.element.lastElementChild as HTMLElement, .3);
    pointer(mobileCommon.element.lastElementChild as HTMLElement, .7);
    check.equal(mobileCalendar.items.scrollTop, 0, "Mobile calendar sheets preserve their touch interaction");
    window.siyuan.menus.menu.closeSheet();
    await settle();
    mobileCalendar.editor.remove();
    dispose(mobileCommon);

    const mobileTrigger = document.createElement("button");
    document.body.append(mobileTrigger);
    const mobileSessions = new AgentSessionPanel(mobileTrigger, document.body, () => "", () => "Untitled", {}, true);
    await mobileSessions.render();
    const mobileSessionRoot = document.querySelector<HTMLElement>(".agent-session-popup--mobile");
    mobileSessionRoot.getAnimations().forEach(animation => animation.cancel());
    mobileSessionRoot.style.cssText = "position:fixed;left:40px;top:60px;width:300px;height:360px;transform:none";
    const mobileSessionItems = mobileSessionRoot.querySelector<HTMLElement>(".b3-list");
    pointer(mobileSessionItems, .3);
    pointer(mobileSessionItems, .7);
    check.equal(mobileSessionItems.scrollTop, 0, "Mobile session lists preserve their touch interaction");
    mobileSessions.destroy();
    mobileTrigger.remove();
    return "Menu layout cases passed";
};

test("menus adapt to layout changes and optional whole-menu mouse scrolling", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const sources = Object.fromEntries(["menus/Menu", "menus/menuPosition", "menus/menuMouseScroll", "menus/menuGroup", "menus/sheetOpen", "menus/sheetActions",
        "util/setPosition", "protyle/util/hasClosest", "plugin/Menu", "protyle/render/av/openMenuPanel",
        "asset/pdf/viewerTemplate", "asset/pdf/secondary_toolbar.js", "protyle/render/av/calendar/undated", "protyle/gutter/embedBreadcrumbMenu",
        "layout/dock/agent/AgentSessionPanel", "protyle/render/listMindmap/appearance"].map(name => [name,
        transpileModule(readFileSync(path.join(__dirname, "..", name.endsWith(".js") ? name : name + ".ts"), "utf8"), {
            compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
        }).outputText]));
    const providerSource = readFileSync(path.join(__dirname, "../config/tabs/ai/aiProviderUi.ts"), "utf8");
    sources.modelPicker = transpileModule(providerSource.slice(providerSource.indexOf("const openAvailableModelMenu ="),
        providerSource.indexOf("const showTestResult =")), {
        compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
    }).outputText;
    const css = ["component/_menu.scss", "component/_list.scss", "component/_text-field.scss", "util/_function.scss",
        "business/_av.scss", "business/_av-calendar.scss", "business/_ai_agent.scss", "pdf/_pdf.scss",
        "protyle/_mindmap-view.scss"].map(name =>
        compile(path.join(__dirname, "../assets/scss", name), {logger: Logger.silent}).css).join("\n");
    const languagesPath = path.join(__dirname, "../../appearance/langs");
    const themeLabels = readdirSync(languagesPath).filter(name => name.endsWith(".json")).map(name => ({
        language: name.replace(".json", ""), labels: JSON.parse(readFileSync(path.join(languagesPath, name), "utf8")),
    }));
    const source = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(css)}, ${JSON.stringify(themeLabels)})`;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-menu-layout-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 1000, height: 800, useContentSize: true,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false}});
    ipcMain.handle("resize-menu-test", (_event, width, height) => win.setContentSize(width, height));
    ipcMain.handle("menu-test-pointer", (event, type, x, y) =>
        event.sender.sendInputEvent({type, x, y, button: "left", clickCount: 1}));
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(source)}));
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
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Menu layout cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-menu-layout-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
