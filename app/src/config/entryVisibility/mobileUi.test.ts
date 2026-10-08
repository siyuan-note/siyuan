import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

const browserCases = async (sources: Record<string, string>, languages: Record<string, string>, narrow = false,
                            mobileBuild = false) => {
    const check = (condition: unknown, message: string) => {
        if (!condition) {
            throw new Error(message);
        }
    };
    let mobile = true;
    let settingsWindow = false;
    const ownerSnapshot: Record<string, string[]> = {};
    let ownerReads = 0;
    let frequentSlashEnabled = true;
    const cache: Record<string, Record<string, any>> = {};
    const noop = () => {};
    window.siyuan = {languages, mobile: {}, storage: {}, config: {editor: {codeTabSpaces: 4}, appearance: {
        entryVisibility: {active: "custom", profiles: [{id: "custom", name: "Custom", entries: {}, orders: {}}]},
    }}, layout: {}} as unknown as typeof window.siyuan;
    const load = (id: string): Record<string, any> => {
        if (cache[id]) {
            return cache[id];
        }
        if (id === "config/entryVisibility/runtime") {
            return {
                ENTRY_PROFILE_FULL: "full", ENTRY_PROFILE_SIMPLE: "simple", ENTRY_VISIBILITY_VERSION: 1,
                createEntryProfileSnapshot: () => ({"editor.slash.menu": !mobile}), createEntryOrderSnapshot: () => ({}),
                getConfiguredEntryVisibility: () => true,
                saveEntryVisibility: (config: Config.IEntryVisibility) => {
                    window.siyuan.config.appearance.entryVisibility = config;
                },
            };
        }
        if (!sources[id]) {
            const mocks: Record<string, unknown> = {
                "util/functions": {isMobile: () => mobile},
                "util/hostCapabilities": {getHostCapabilities: () => ({importExport: false})},
                "util/genID": {genUUID: () => "new"},
                "dialog/confirmDialog": {confirmDialog: (_title: string, _text: string, callback: () => void) => callback()},
                "dialog/message": {showMessage: noop},
                "protyle/util/compatibility": {isInMobileApp: () => true},
                "protyle/hint/frequentSlashStorage": {isFrequentSlashEnabled: () => frequentSlashEnabled,
                    setFrequentSlashEnabled: (enabled: boolean) => { frequentSlashEnabled = enabled; }},
                "protyle/toolbar/catalogSnapshot": {getEditorToolbarCatalogSnapshot: (): [] => []},
                "config/setting/windowContext": {isSettingsWindow: () => settingsWindow,
                    getSettingsOwnerApp: () => window.siyuan.ws?.app,
                    getSettingsWindowHost: () => ({getDockOrderSnapshot: () => { ownerReads++; return ownerSnapshot; },
                        getEditorToolbarCatalogSnapshot: (): [] => []})},
            };
            check(id in mocks, `Missing module ${id}`);
            return mocks[id];
        }
        const exports = {};
        cache[id] = exports;
        const require = (relative: string) => {
            const parts = id.split("/").slice(0, -1);
            relative.split("/").forEach(part => {
                if (part === "..") {
                    parts.pop();
                } else if (part !== ".") {
                    parts.push(part);
                }
            });
            return load(parts.join("/"));
        };
        new Function("exports", "require", sources[id])(exports, require);
        return exports;
    };
    const ui = load("config/entryVisibility/ui");
    const catalog = load("config/entryVisibility/catalog");
    const config = () => window.siyuan.config.appearance.entryVisibility;
    config().profiles[0].orders["editor.slash.menu"] = ["heading1", "plugin:missing:item", "heading2", "heading3"];
    document.body.insertAdjacentHTML("beforeend", '<div class="config__tab-container"><div id="root"></div></div>');
    const root = document.querySelector<HTMLElement>("#root");
    const open = (id = "custom") => {
        document.querySelectorAll(".config-entry-visibility__view").forEach(item => item.remove());
        ui.open(root, id);
        return document.querySelector<HTMLElement>(".config-entry-visibility__view");
    };
    if (mobileBuild) {
        root.innerHTML = ui.genEntryVisibilityHtml();
        ui.mountEntryVisibility(root);
        check(root.querySelectorAll("[data-profile-id]").length === 3,
            "Mobile build must render built-in and saved profiles on first mount");
        const saved = JSON.stringify(config());
        root.querySelector<HTMLElement>("[data-action='create']").click();
        check(document.querySelector("[data-profile-field='template']"), "Create must open the new profile editor");
        document.querySelector<HTMLElement>(".config__view [data-action='cancel']").click();
        check(JSON.stringify(config()) === saved, "Cancelling creation must preserve saved profiles");
        for (const id of ["simple", "full", "custom"]) {
            document.querySelectorAll(".config-entry-visibility__view").forEach(item => item.remove());
            root.querySelector<HTMLElement>(`[data-profile-id='${id}'] .config-name`).click();
            const editor = document.querySelector<HTMLElement>(".config__view--show");
            check(editor?.querySelector("[data-type='entry-section']"), "Profile cards must open the mobile editor");
            check(Boolean(editor.querySelector("[data-action='confirm']")) === (id === "custom"),
                "Built-in profiles must remain read-only and custom profiles editable");
            const section = editor.querySelector<HTMLSelectElement>("[data-type='entry-section']");
            section.value = "editor.slash";
            section.dispatchEvent(new Event("change", {bubbles: true}));
            const frequent = editor.querySelector<HTMLInputElement>("[data-type='slash-menu-frequent']");
            check(frequent?.checked && !frequent.disabled, "Frequent slash defaults to on in every profile view");
            frequent.click();
            check(frequentSlashEnabled === (id === "custom"), "Only built-in views save the workspace switch immediately");
            if (id !== "custom") {
                frequent.click();
            }
            editor.querySelector<HTMLElement>("[data-action='cancel']").click();
            check(frequentSlashEnabled, "Cancelling a custom draft does not change the workspace switch");
        }
        check(JSON.stringify(config()) === saved, "Viewing and cancelling profiles must preserve saved preferences");
        root.querySelector<HTMLElement>("[data-profile-id='full'] [data-action='activate']").click();
        check(config().active === "full", "Profile activation must work in the mobile build");
        return "Mobile compiled settings passed";
    }
    let view = open();
    const selectSlash = () => {
        const select = view.querySelector<HTMLSelectElement>("[data-type='entry-section']");
        select.value = "editor.image";
        select.dispatchEvent(new Event("change", {bubbles: true}));
        check(view.querySelector("[data-entry-path='editor.image.ocrText']"), "Mobile exposes image OCR visibility");
        check(select.options.length === 3, "Mobile must offer toolbar, slash, and image categories");
        select.value = "editor.slash";
        select.dispatchEvent(new Event("change", {bubbles: true}));
    };
    if (narrow) {
        for (const id of ["", "custom"]) {
            view = open(id);
            check(Boolean(view.querySelector("[data-profile-field='template']")) === !id,
                "New profiles must include the template selector");
            selectSlash();
            view.querySelector<HTMLInputElement>("[data-entry-path='editor.slash.menu']").click();
            const list = view.querySelector<HTMLElement>(".config-entry-visibility__column-list");
            const bounds = list.getBoundingClientRect();
            check(bounds.height >= 132, `${id || "new"} profile list is too short: ${bounds.height}px`);
            const action = view.querySelector<HTMLElement>(".b3-dialog__action").getBoundingClientRect();
            check(action.bottom <= innerHeight && bounds.bottom <= action.top,
                "List and actions must remain inside the viewport");
            for (const button of view.querySelectorAll<HTMLElement>(".b3-dialog__action button")) {
                const rect = button.getBoundingClientRect();
                check(rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
                    "Reset and save controls must remain reachable on narrow screens");
            }
            const header = view.querySelector<HTMLElement>(".config-entry-visibility__mobile-header");
            for (const selector of ["[data-profile-field='name']", "[data-entry-path='editor.slash.menu']"]) {
                const control = view.querySelector<HTMLElement>(selector);
                control.scrollIntoView({block: "nearest"});
                const rect = control.getBoundingClientRect();
                check(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === control,
                    `${selector} must be reachable by scrolling the form`);
            }
            if (!id) {
                check(header.scrollHeight > header.clientHeight, "New profile form must scroll independently");
            }
            const candidate = list.querySelector<HTMLInputElement>("input[data-entry-path]");
            candidate.scrollIntoView({block: "nearest"});
            const rect = candidate.getBoundingClientRect();
            check(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === candidate,
                "Candidate controls must remain reachable after scrolling the form");
            const checked = candidate.checked;
            candidate.click();
            const updated = view.querySelector<HTMLInputElement>(`[data-entry-path='${candidate.dataset.entryPath}']`);
            check(updated.checked !== checked, "Candidate visibility must remain editable");
        }
        view = open("");
        selectSlash();
        const reset = view.querySelector<HTMLElement>("[data-action='reset-all-entry-orders']");
        reset.querySelector("span").textContent = "Alle Reihenfolgen zurücksetzen";
        const resetBounds = reset.getBoundingClientRect();
        check(resetBounds.left >= 0 && resetBounds.right <= innerWidth,
            "Long translated reset labels must fit the narrow editor");
        return "Narrow new and existing profiles passed";
    }
    selectSlash();
    const frequent = view.querySelector<HTMLInputElement>("[data-type='slash-menu-frequent']");
    check(frequent.checked, "Frequent slash defaults to on");
    const frequentRow = frequent.closest("label");
    check(frequentRow === frequentRow.parentElement.firstElementChild, "Frequent is the first compact slash row");
    check(!frequentRow.hasAttribute("data-entry-row") && !frequentRow.querySelector(".config-entry-visibility__drag"),
        "The workspace switch must not participate in profile sorting");
    frequent.click();
    check(frequentSlashEnabled, "Custom frequent changes must remain staged until confirmed");
    let enabled = view.querySelector<HTMLInputElement>("[data-entry-path='editor.slash.menu']");
    check(!enabled.checked, "Mobile slash defaults to off");
    enabled.click();
    check(!view.querySelector<HTMLInputElement>("[data-type='slash-menu-frequent']").checked,
        "Frequent switch draft must survive a list rerender");
    check(config().profiles[0].entries["editor.slash.menu"] !== true, "Total switch must remain a draft until confirmed");
    check(view.querySelectorAll("[data-type='entry-mobile-options'] input").length === 1, "Only one total switch is shown");
    check(!view.querySelector("[data-entry-move]"), "No arrow sort controls");
    const browser = view.querySelector<HTMLElement>("[data-type='entry-browser']");
    // 合成指针不属于浏览器的活动指针，仅替换捕获状态，命中测试和事件分发仍使用真实 DOM。
    let captured = false;
    browser.setPointerCapture = () => { captured = true; };
    browser.hasPointerCapture = () => captured;
    browser.releasePointerCapture = () => { captured = false; };
    const row = (key: string) => browser.querySelector<HTMLElement>(`[data-entry-key='${key}']`);
    const handle = () => row("heading1").querySelector<HTMLElement>(".config-entry-visibility__drag");
    row("heading3").scrollIntoView({block: "center"});
    check(getComputedStyle(handle()).display !== "none", "Drag handle must be visible");
    check(getComputedStyle(handle()).touchAction === "none", "Handle must own touch gestures");
    const point = (el: Element) => {
        const rect = el.getBoundingClientRect();
        return {clientX: rect.left + rect.width / 2, clientY: rect.bottom - 3};
    };
    const send = (target: Element, type: string, coordinates: {clientX: number, clientY: number}) => target.dispatchEvent(
        new PointerEvent(type, {bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0,
            pointerType: "touch", ...coordinates}));
    const drag = (end: string) => {
        send(handle(), "pointerdown", point(handle()));
        send(browser, "pointermove", point(row("heading3")));
        check(browser.querySelector(".config-entry-visibility__row--drop-after"),
            `Missing drop marker: ${JSON.stringify({handle: point(handle()), target: point(row("heading3")),
                hit: document.elementFromPoint(point(row("heading3")).clientX, point(row("heading3")).clientY)?.outerHTML.slice(0, 300)})}`);
        send(browser, end, point(row("heading3")));
    };
    drag("pointercancel");
    check(row("heading1").compareDocumentPosition(row("heading2")) & Node.DOCUMENT_POSITION_FOLLOWING,
        "Cancelled drag must not reorder");
    check(!captured && !browser.querySelector(".config-entry-visibility__row--dragging"), "Cancel must clean capture and markers");
    drag("pointerup");
    check(row("heading3").compareDocumentPosition(row("heading1")) & Node.DOCUMENT_POSITION_FOLLOWING,
        "Touch drag must reorder candidates");
    const visibility = row("heading1").querySelector<HTMLInputElement>("input");
    const checked = visibility.checked;
    row("heading1").click();
    check(visibility.checked === checked, "Release click must not toggle visibility");
    // 停在列表边缘时应持续滚动，离开列表释放时不得提交上一个落点。
    row("heading1").scrollIntoView({block: "center"});
    send(handle(), "pointerdown", point(handle()));
    const list = browser.querySelector<HTMLElement>(".config-entry-visibility__column-list");
    send(browser, "pointermove", point(list));
    const beforeScroll = list.scrollTop;
    await new Promise(resolve => setTimeout(resolve, 100));
    check(list.scrollTop > beforeScroll, "Drag near edge must scroll without further pointer movement");
    send(browser, "pointerup", {clientX: -20, clientY: -20});
    check(!browser.querySelector(".config-entry-visibility__row--drop-after"), "Outside release clears drop target");
    view.querySelector<HTMLElement>("[data-action='confirm']").click();
    check(!frequentSlashEnabled, "Confirm must save the independent frequent switch");
    const order = config().profiles[0].orders["editor.slash.menu"];
    check(config().profiles[0].entries["editor.slash.menu"] === true, "Confirm saves total switch in the profile");
    check(order.includes("plugin:missing:item"), "Unavailable plugin slots must survive sorting");
    check(order.indexOf("heading3") < order.indexOf("heading1"), "Confirmed order must persist");
    view = open();
    selectSlash();
    enabled = view.querySelector<HTMLInputElement>("[data-entry-path='editor.slash.menu']");
    check(enabled.checked, "Reopening must preserve profile setting");
    check(!view.querySelector<HTMLInputElement>("[data-type='slash-menu-frequent']").checked,
        "Reopening must preserve the workspace frequent setting");
    view.querySelector<HTMLInputElement>("[data-type='slash-menu-frequent']").click();
    const search = view.querySelector<HTMLInputElement>("[data-type='entry-search']");
    search.value = languages.slashMenuFrequent;
    search.dispatchEvent(new Event("input", {bubbles: true}));
    check(view.querySelector<HTMLInputElement>("[data-type='slash-menu-frequent']")?.checked,
        "Searching the frequent label must reveal the pending workspace switch");
    check(!view.querySelector("[data-entry-key='template']"), "Frequent search must not include unrelated candidates");
    search.value = "heading1";
    search.dispatchEvent(new Event("input", {bubbles: true}));
    check(!view.querySelector(".config-entry-visibility__drag"), "Search results must not permit partial-list sorting");
    search.value = "";
    search.dispatchEvent(new Event("input", {bubbles: true}));
    const rootSwitch = view.querySelector<HTMLInputElement>("[data-entry-path='editor.slash.menu']");
    rootSwitch.click();
    check(!view.querySelector(".config-entry-visibility__drag"), "Disabled menu must not be draggable");
    check(view.querySelector<HTMLInputElement>("[data-entry-path='editor.slash.menu.heading1']").disabled,
        "Disabled menu must disable candidate controls");
    view.querySelector<HTMLElement>("[data-action='cancel']").click();
    check(!frequentSlashEnabled, "Cancel must discard the staged frequent change");
    check(config().profiles[0].entries["editor.slash.menu"] === true, "Cancel must discard the total switch change");
    view = open("full");
    selectSlash();
    check(!view.querySelector(".config-entry-visibility__drag"), "Built-in profiles must remain read-only");
    check(!view.querySelector("[data-action='reset-entry-order'], [data-action='reset-all-entry-orders']"),
        "Built-in profiles must not offer resets");
    enabled = view.querySelector<HTMLInputElement>("[data-entry-path='editor.slash.menu']");
    enabled.click();
    check(!enabled.checked, "Built-in total switch follows mobile default and remains read-only");
    view.querySelector<HTMLInputElement>("[data-type='slash-menu-frequent']").click();
    check(frequentSlashEnabled, "Built-in viewers must allow immediate workspace frequent changes");
    view.querySelector<HTMLElement>("[data-action='cancel']").click();
    mobile = false;
    delete window.siyuan.mobile;
    view = open();
    check(!view.querySelector("[data-type='entry-section']"), "Desktop retains its location column");
    check(view.querySelector(".config-entry-visibility__column--locations"), "Desktop locations remain reachable");
    const resetAllSelector = ".config-entry-visibility__column--locations .config-entry-visibility__column-title " +
        "[data-action='reset-all-entry-orders']";
    const desktopReset = view.querySelector<HTMLElement>(resetAllSelector);
    check(desktopReset?.querySelector("use").getAttribute("xlink:href") === "#iconRefresh",
        "Desktop reset all uses the shared refresh icon in the location title");
    check(desktopReset.getAttribute("aria-label") === languages.entryResetAllOrders,
        "Desktop reset all retains its distinct accessible label");
    check(!view.querySelector(".b3-dialog__action [data-action='reset-all-entry-orders']"),
        "Desktop footer must not duplicate reset all");
    desktopReset.click();
    check(config().profiles[0].orders["editor.slash.menu"], "Desktop reset all remains a draft");
    view.querySelector<HTMLElement>("[data-action='cancel']").click();
    check(config().profiles[0].orders["editor.slash.menu"], "Cancelling desktop reset preserves orders");
    view = open();
    view.querySelector<HTMLElement>(resetAllSelector).click();
    view.querySelector<HTMLElement>("[data-action='confirm']").click();
    check(Object.keys(config().profiles[0].orders).length === 0, "Confirming desktop reset clears all orders");
    config().profiles[0].orders["editor.slash.menu"] = order;
    view = open("full");
    check(!view.querySelector("[data-action='reset-all-entry-orders']"), "Desktop built-in profiles do not offer resets");
    view = open();
    view.querySelector<HTMLElement>("[data-entry-section='editor.slash']").click();
    const desktopBrowser = view.querySelector<HTMLElement>("[data-type='entry-browser']");
    const first = desktopBrowser.querySelector<HTMLElement>("[data-entry-key='heading1']");
    const target = desktopBrowser.querySelector<HTMLElement>("[data-entry-key='heading2']");
    const transfer = new DataTransfer();
    first.querySelector(".config-entry-visibility__drag").dispatchEvent(new DragEvent("dragstart", {bubbles: true, dataTransfer: transfer}));
    target.dispatchEvent(new DragEvent("dragover", {bubbles: true, cancelable: true, dataTransfer: transfer, ...point(target)}));
    target.dispatchEvent(new DragEvent("drop", {bubbles: true, cancelable: true, dataTransfer: transfer}));
    view.querySelector<HTMLElement>("[data-action='confirm']").click();
    const desktopOrder = config().profiles[0].orders["editor.slash.menu"];
    check(desktopOrder.indexOf("heading1") < desktopOrder.indexOf("heading3"), "Desktop drag still updates order");
    check(catalog.getEntryCatalogChildren("editor.slash.menu").length > 20, "Exercise the actual slash catalog");
    config().profiles[0].orders["dock.order.LeftTop"] = ["outline", "file"];
    config().profiles[0].orders["dock.order.RightTop"] = ["graph"];
    view = open();
    view.querySelector<HTMLElement>("[data-entry-section='dock']").click();
    check(view.querySelectorAll("[data-action='reset-entry-order']").length === 6,
        "Dock groups must offer resets for the six actual order scopes");
    view.querySelector<HTMLElement>("[data-action='reset-entry-order'][data-entry-parent='dock.order.LeftTop']").click();
    view.querySelector<HTMLElement>("[data-action='confirm']").click();
    check(!("dock.order.LeftTop" in config().profiles[0].orders), "Dock reset must remove its scope record");
    check(config().profiles[0].orders["dock.order.RightTop"], "Dock reset must preserve the other scopes");
    settingsWindow = true;
    Object.assign(ownerSnapshot, load("config/entryVisibility/dockOrder").createDockEntryOrderSnapshot({
        RightBottom: ["outline", "plugin:unavailable:dock", "file"], BottomLeft: ["graph"],
    }));
    config().profiles[0].orders["dock.order.RightBottom"] = ["outline", "plugin:unavailable:dock", "file"];
    const savedOrders = JSON.stringify(config().profiles[0].orders);
    view = open();
    view.querySelector<HTMLElement>("[data-entry-section='dock']").click();
    const ownerRows = () => view.querySelectorAll("[data-entry-row][data-entry-parent='dock.order.RightBottom']");
    check(ownerRows().length === 2, "Detached settings must use the owner's live dock placement");
    check(ownerRows()[0].getAttribute("data-entry-key") === "outline", "Saved dock order must take precedence");
    const reads = ownerReads;
    ownerSnapshot["dock.order.RightBottom"] = ["outline", "plugin:unavailable:dock"];
    ownerSnapshot["dock.order.LeftBottom"] = ["file"];
    const ownerSearch = view.querySelector<HTMLInputElement>("[data-type='entry-search']");
    ownerSearch.dispatchEvent(new Event("input", {bubbles: true}));
    check(ownerReads === reads && ownerRows().length === 2, "Rerendering a draft must retain its opening snapshot");
    check(JSON.stringify(config().profiles[0].orders) === savedOrders, "Editing must not rewrite saved orders");
    view.querySelector<HTMLElement>("[data-action='confirm']").click();
    check(JSON.stringify(config().profiles[0].orders) === savedOrders, "Saving visibility must preserve unknown order slots");
    view = open("full");
    view.querySelector<HTMLElement>("[data-entry-section='dock']").click();
    check(ownerReads === reads + 1, "A reopened editor must read the owner's current dock snapshot");
    check(view.querySelector("[data-entry-key='file'][data-entry-parent='dock.order.LeftBottom']"),
        "Built-in profiles must display the updated owner placement");
    settingsWindow = false;
    mobile = true;
    window.siyuan.mobile = {} as typeof window.siyuan.mobile;
    view = open();
    check(view.querySelectorAll("[data-entry-row]").length === 2, "Mobile toolbar exposes two context groups");
    view.querySelector<HTMLElement>("[data-entry-path-row='editor.toolbar.mobile-input']").click();
    const toolbarBrowser = view.querySelector<HTMLElement>("[data-type='entry-browser']");
    toolbarBrowser.setPointerCapture = () => { captured = true; };
    toolbarBrowser.hasPointerCapture = () => captured;
    toolbarBrowser.releasePointerCapture = () => { captured = false; };
    const toolbarRows = Array.from(toolbarBrowser.querySelectorAll<HTMLElement>(
        "[data-entry-row][data-entry-parent='editor.toolbar.mobile-input']"));
    const firstKey = toolbarRows[0].dataset.entryKey;
    const secondKey = toolbarRows[1].dataset.entryKey;
    const toolbarHandle = toolbarRows[0].querySelector(".config-entry-visibility__drag");
    send(toolbarHandle, "pointerdown", point(toolbarHandle));
    send(toolbarBrowser, "pointermove", point(toolbarRows[1]));
    send(toolbarBrowser, "pointerup", point(toolbarRows[1]));
    view.querySelector<HTMLElement>("[data-action='confirm']").click();
    const toolbarOrder = config().profiles[0].orders["editor.toolbar.mobile-input"];
    check(toolbarOrder.indexOf(secondKey) < toolbarOrder.indexOf(firstKey), "Toolbar touch sorting must persist");
    view = open();
    selectSlash();
    const resetOrder = () => view.querySelector<HTMLElement>("[data-action='reset-entry-order']").click();
    resetOrder();
    check(config().profiles[0].orders["editor.slash.menu"], "Reset must remain a draft until confirmed");
    view.querySelector<HTMLElement>("[data-action='cancel']").click();
    check(config().profiles[0].orders["editor.slash.menu"], "Cancel must preserve saved order and plugin slots");
    view = open();
    selectSlash();
    resetOrder();
    view.querySelector<HTMLElement>("[data-action='confirm']").click();
    check(!("editor.slash.menu" in config().profiles[0].orders), "Single reset must delete the order record");
    check(config().profiles[0].orders["editor.toolbar.mobile-input"], "Single reset must preserve other levels");
    check(config().profiles[0].entries["editor.slash.menu"] === true, "Reset must preserve visibility");
    view = open();
    view.querySelector<HTMLElement>("[data-action='reset-all-entry-orders']").click();
    view.querySelector<HTMLElement>("[data-action='confirm']").click();
    check(Object.keys(config().profiles[0].orders).length === 0, "Reset all must clear order records");
    view = open();
    selectSlash();
    return "Mobile entry settings passed";
};

const runEntryUiCases = async (mobileBuild: boolean) => {
    const modules = ["config/entryVisibility/ui", "config/entryVisibility/catalog", "config/entryVisibility/order",
        "config/entryVisibility/profile", "config/entryVisibility/mobileToolbarContext",
        "config/entryVisibility/dockOrder", "config/entryVisibility/touchOrder",
        "protyle/toolbar/defaults", "mobile/util/toolbarActions", "protyle/wysiwyg/codeBlockUtil", "protyle/gutter/turnIntoMenu",
        "plugin/dockKey", "plugin/topBarKey", "util/escape"];
    if (mobileBuild) {
        modules.push("config/setting/windowContext");
    }
    const sources = Object.fromEntries(modules.map(id => {
        const source = readFileSync(path.resolve(process.cwd(), "src", id + ".ts"), "utf8");
        const processed = mobileBuild ? parse(source, {MOBILE: true, BROWSER: true}, false, true) : source;
        return [id, transpileModule(processed + (id.endsWith("/ui") ? "\nexports.open = openProfileEditor;" : ""), {
            compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
        }).outputText];
    }));
    const languages = JSON.parse(readFileSync(path.resolve(process.cwd(), "appearance/langs/zh-CN.json"), "utf8"));
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-entry-ui-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 390, height: 844, webPreferences: {offscreen: true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.insertCSS(require("node:fs").readFileSync(${JSON.stringify(path.resolve("appearance/themes/daylight/theme.css"))}, "utf8"));
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(path.resolve("appearance/icons/litheness/icon.js"))}, "utf8"));
        await win.webContents.insertCSS(require(${JSON.stringify(require.resolve("sass"))}).compile(${JSON.stringify(path.resolve("src/assets/scss/mobile.scss"))}, {logger: {warn() {}}}).css);
        await win.webContents.insertCSS(".config__tab-container {position: relative; height: 100vh;} .config__view {transition: none;}");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" + browserCases.toString() + ")(" + JSON.stringify(sources) + "," + JSON.stringify(languages) + ",false," + mobileBuild + ")")}));
        await win.webContents.insertCSS("body {font-size: 20px;}");
        win.setSize(320, 640);
        await new Promise(resolve => setTimeout(resolve, 300));
        await win.webContents.executeJavaScript("document.querySelector('.config__tab-container').remove()");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("(" + browserCases.toString() + ")(" + JSON.stringify(sources) + "," + JSON.stringify(languages) + ",true," + mobileBuild + ")")}));
        if (process.env.SIYUAN_ENTRY_UI_SCREENSHOT && !${mobileBuild}) {
            await new Promise(resolve => setTimeout(resolve, 300));
            require("node:fs").writeFileSync(process.env.SIYUAN_ENTRY_UI_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
            await win.webContents.insertCSS(require("node:fs").readFileSync(${JSON.stringify(path.resolve("appearance/themes/midnight/theme.css"))}, "utf8"));
            await win.webContents.insertCSS("body {font-size: 20px;}");
            win.setSize(320, 640);
            await new Promise(resolve => setTimeout(resolve, 300));
            require("node:fs").writeFileSync(process.env.SIYUAN_ENTRY_UI_SCREENSHOT + ".dark.png", (await win.webContents.capturePage()).toPNG());
            const fits = await win.webContents.executeJavaScript("(() => {const view = document.querySelector('.config-entry-visibility__view'); const action = view.querySelector('.b3-dialog__action').getBoundingClientRect(); const list = view.querySelector('.config-entry-visibility__column-list').getBoundingClientRect(); return action.bottom <= innerHeight && list.height > 40;})()");
            if (!fits) { throw new Error("Narrow layout clips actions or list"); }
        }
        win.destroy();
        app.exit(0);
    } catch (error) {
        if (process.env.SIYUAN_ENTRY_UI_SCREENSHOT) {
            require("node:fs").writeFileSync(process.env.SIYUAN_ENTRY_UI_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
        }
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
        assert.match(result.stdout, mobileBuild ? /Mobile compiled settings passed/ : /Mobile entry settings passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-entry-ui-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
};

for (const mobileBuild of [false, true]) {
    test(mobileBuild ? "mobile compiled entry settings mount profiles and bind editor actions" :
        "mobile entry settings preserve preferences and support touch sorting without arrow controls", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, () => runEntryUiCases(mobileBuild));
}
