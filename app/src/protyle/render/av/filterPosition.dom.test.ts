import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {compile} from "sass";
import {browserSources, canRunBrowser, runBrowserCase} from "../../../datePicker/test/browser";

const pickerSources = () => browserSources(Object.fromEntries([
    ...["model", "yearInput", "field", "runtime", "owners", "binding", "position", "index"]
        .map(name => [name, "../../../datePicker/" + name + ".ts"]),
    ...["mobileSheetGesture", "visibleViewport", "orientation", "keyboardSheetState", "mobileSheetLayout",
        "bindBottomSheetDrag", "bindBottomSheetDialog"].map(name => [name, "../../../mobile/util/" + name + ".ts"]),
    ["menuPosition", "../../../menus/menuPosition.ts"], ["overlayOwnership", "../../../menus/overlayOwnership.ts"],
    ["sheetOpen", "../../../menus/sheetOpen.ts"], ["dialog", "../../../dialog/index.ts"],
    ["mobileDialog", "../../../dialog/mobileDialog.ts"], ["filterDateDropdown", "filterDateDropdown.ts"],
].map(([name, path]) => [name, join(__dirname, path)])));

const setupPicker = (source: Record<string, string>, modules: Record<string, any>, stubs: Record<string, any>) => {
    const mobile = source.frontend === "mobile" || source.frontend === "browser-mobile";
    let uuid = 0;
    const fallback = {genUUID: () => String(++uuid), getZIndex: () => 0, isAbove: () => false,
        isMobile: () => mobile, isInMobileApp: () => false, isIOSPlatform: () => false, isNotCtrl: () => true, moveResize() {},
        Constants: {TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0}, destroyDialogBlockPanels() {}, getDialogBlockPanel() {},
        getAnchoredInputMask() {}, callMobileAppShowKeyboard() {}, showMessage() {}, getEventName: () => "click",
        updateHotkeyTip: (value: string) => value, escapeAttr: (value: string) => value, applyMenuEntryVisibility() {},
        setPopoverMenuOpen() {}, activeBlur() {}, getTopBarHeight: () => 0, isScrollAboveMenu: () => false,
        electronUndo() {}, forEachPluginSubscriber() {}};
    const load = (name: string, deps: Record<string, unknown> = {}) => {
        const exports = modules[name] ||= {};
        new Function("exports", "require", source[name])(exports, (path: string) =>
            deps[path] || stubs[path] || modules[path.split("/").at(-1)] || fallback);
    };
    const common = document.createElement("div"); common.className = "b3-menu fn__none"; document.body.append(common);
    Object.assign(window.siyuan, {dialogs: [], zIndex: 10, isReady: true,
        mobile: {size: {isLandscape: false, portrait: {height1: innerHeight}, landscape: {height1: innerHeight}}},
        menus: {menu: {element: common, remove() {}}}});
    if (mobile) { const sidebar = document.createElement("div"); sidebar.id = "sidebar"; document.body.append(sidebar); }
    ["overlayOwnership", "dialog", "model", "yearInput", "field", "menuPosition", "position", "runtime", "owners",
        "sheetOpen", "mobileSheetGesture", "visibleViewport", "orientation", "keyboardSheetState", "mobileSheetLayout",
        "bindBottomSheetDrag", "bindBottomSheetDialog"].forEach(name => load(name));
    load("mobileDialog", {"./index": modules.dialog});
    modules.panel = {registerDatePickerWindow() {}};
    modules.index = {};
    load("binding"); load("index");
    stubs["../../../datePicker"] = modules.index;
    stubs.__fallback = fallback;
    modules.runtime.registerDatePickerRuntime(document, (options: unknown) => new modules.mobileDialog.MobileDialog(options),
        () => window.siyuan.languages);
    load("filterDateDropdown");
};

for (const width of [400, 800]) {
    test(`date filter dropdowns preserve their hosts through pointer and keyboard interaction at ${width}px`, {
        timeout: 45000, skip: !canRunBrowser,
    }, async () => {
        const sources = {...pickerSources(), setup: setupPicker.toString(), ...browserSources(Object.fromEntries([
            ["model", "../../../datePicker/model.ts"], ["yearInput", "../../../datePicker/yearInput.ts"],
            ["field", "../../../datePicker/field.ts"], ["inline", "../../../datePicker/inline.ts"],
            ["capabilities.generated", "capabilities.generated.ts"], ["capabilities", "capabilities.ts"],
            ["filterTree", "filterTree.ts"], ["filter", "filter.ts"],
            ["setPosition", "../../../util/setPosition.ts"], ["automationPosition", "automationPosition.ts"], ["filters", "panels/filters.ts"],
            ["automationTemplateFunctions", "automationTemplateFunctions.ts"], ["automation", "automation.ts"],
            ["conditionalColorMenu", "conditionalColorMenu.ts"],
        ].map(([name, path]) => [name, join(__dirname, path)]))),
        languages: readFileSync("appearance/langs/de.json", "utf8"),
        icons: readFileSync("appearance/icons/litheness/icon.js", "utf8")};
        const css = readFileSync("appearance/themes/daylight/theme.css", "utf8") +
            compile("src/assets/scss/base.scss", {logger: {warn() {}}}).css;
        const result = await runBrowserCase(async (source, stylesheet) => {
            const style = document.createElement("style"); style.textContent = stylesheet; document.head.append(style);
            new Function(source.icons)();
            document.documentElement.style.setProperty("--b3-font-size", "24px");
            const state = window as any;
            state.siyuan = {languages: JSON.parse(source.languages), config: {}, menus: {menu: {remove() {}}}};
            state.transactions = 0;
            state.positions = 0;
            const observers = new Set<ResizeObserver>();
            const NativeObserver = window.ResizeObserver;
            window.ResizeObserver = class extends NativeObserver {
                observe(target: Element) { observers.add(this); super.observe(target); }
                disconnect() { observers.delete(this); super.disconnect(); }
            };
            const dateFilter = () => ({column: "date", operator: "Is between", value: {type: "date"}});
            const database = {id: "database", name: "Database", viewID: "view", keyValues: [
                {key: {id: "date", name: "Voraussichtliches Fertigstellungsdatum", type: "date"}},
            ], automations: {spec: 1, rules: [{id: "rule", name: "Date rule", enabled: false, trigger: "update",
                conditions: [dateFilter()], actions: [{type: "edit", target: "filtered", avID: "database",
                    filters: [dateFilter()], fields: {}}]}]}};
            const modules: Record<string, any> = {};
            const stubs: Record<string, any> = {
                "./view": {getFieldsByData: (data: any) => data.view.columns},
                "./col": {getColIconByType: () => "iconCalendar"},
                "../../../util/escape": {escapeHtml: String, escapeAttr: String},
                "../../wysiwyg/transaction": {transaction: () => { state.transactions++; }},
                "../../../util/fetch": {fetchSyncPost: async () => ({code: 0, data: {av: database}})},
                "./conditionalColor": {getConditionalBackground: () => ""},
                "./filterDropdown": {closeInlineFilterDropdowns() {}},
            };
            new Function("source", "modules", "stubs", "(" + source.setup + ")(source, modules, stubs)")(source, modules, stubs);
            const fallback = stubs.__fallback;
            for (const name of Object.keys(source).filter(name => !["languages", "icons", "setup"].includes(name) && !modules[name])) {
                const exports = modules[name] = {};
                new Function("exports", "require", source[name])(exports, (path: string) =>
                    stubs[path] || modules[path.split("/").at(-1)] || fallback);
            }
            const setPosition = modules.setPosition.setPosition;
            modules.setPosition.setPosition = (...args: any[]) => { state.positions++; setPosition(...args); };
            state.openCase = async (kind: string) => {
                state.panel?.remove();
                const panel = document.createElement("div"); panel.className = "av__panel";
                const menu = document.createElement("div"); menu.className = "b3-menu";
                panel.append(menu); document.body.append(panel);
                state.panel = panel; state.menu = menu;
                const anchor = {right: innerWidth - 16, bottom: 560, height: 24} as DOMRect;
                const position = () => {
                    if (kind === "automation") { modules.automationPosition.setAutomationMenuPosition(menu, anchor); }
                    else { modules.setPosition.setPosition(menu, anchor.right - menu.clientWidth, anchor.bottom, anchor.height, 0, true); }
                };
                const data: any = {id: "database", viewID: "view", viewType: "table", view: {
                    columns: database.keyValues.map(item => item.key), filters: [dateFilter()],
                    conditionalColors: [{id: "color-rule", target: "item", color: null, matchOption: false, filter: dateFilter()}],
                }};
                const options = {protyle: {options: {}}, blockElement: {dataset: {nodeId: "carrier"}},
                    avID: "database", data, menuElement: menu, onResize: position};
                if (kind === "view") {
                    menu.classList.add("av__filter-panel"); menu.innerHTML = modules.filter.getFiltersHTML(data);
                    position();
                    modules.filters.filtersPanel.bind({avPanelElement: panel, menuElement: menu, data,
                        avID: "database", blockID: "carrier", tabRect: anchor, options: {protyle: {}}});
                } else if (kind === "color") { await modules.conditionalColorMenu.openConditionalColorsMenu(options); }
                else { await modules.automation.openAutomationMenu(options); }
                state.input = menu.querySelector('[data-type="absDate"]');
                state.beforeTop = menu.getBoundingClientRect().top;
                state.transactions = 0;
            };
            state.inspect = () => ({top: state.menu.getBoundingClientRect().top, bottom: state.menu.getBoundingClientRect().bottom,
                positions: state.positions, transactions: state.transactions, observers: observers.size,
                active: document.activeElement === state.input,
                focusedPopup: !!document.activeElement?.closest(".date-picker"),
                calendars: state.menu.querySelectorAll(".date-picker--inline").length,
                popups: document.querySelectorAll(".date-picker").length});
            state.checkReachable = () => {
                const menu = state.menu as HTMLElement;
                const rect = menu.getBoundingClientRect();
                if (rect.top < 0 || rect.bottom > innerHeight + 1 || rect.left < 0 || rect.right > innerWidth + 1) {
                    throw new Error("Menu leaves the viewport: " + JSON.stringify(state.inspect()));
                }
                const popup = state.siyuan.dialogs.at(-1)?.element as HTMLElement;
                if (popup) {
                    const bounds = popup.querySelector(".b3-dialog__container").getBoundingClientRect();
                    if (bounds.left < -1 || bounds.top < -1 || bounds.right > innerWidth + 1 || bounds.bottom > innerHeight + 1) {
                        throw new Error("Popup leaves viewport: " + JSON.stringify(bounds));
                    }
                }
                const buttons = (popup || menu).querySelectorAll<HTMLElement>(popup ?
                    "[data-date]:not(:disabled), .date-picker__navigation button, [data-action]" :
                    "[data-type=addFilterCondition], [data-type=removeFilters], [data-action=add], [data-add-condition]");
                for (const button of buttons) {
                    button.scrollIntoView({block: "nearest", inline: "nearest"});
                    const r = button.getBoundingClientRect();
                    const target = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                    if (target !== button && !button.contains(target)) { throw new Error("Date or action is unreachable: " + button.outerHTML); }
                }
                return true;
            };
            return "ready";
        }, sources, css, {width, height: 800, interact: async win => {
            const run = (source: string) => win.webContents.executeJavaScript(source);
            const tick = () => new Promise<void>(resolve => setTimeout(resolve, 150));
            const equal = (actual: unknown, expected: unknown, message: string) => {
                if (actual !== expected) { throw new Error(`${message}: ${actual} !== ${expected}`); }
            };
            const point = (selector: string) => run(`(()=>{const button=document.querySelector(${JSON.stringify(selector)});button.scrollIntoView({block:"nearest"});const r=button.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
            const down = (p: {x: number, y: number}) => {
                win.webContents.sendInputEvent({type: "mouseMove", ...p});
                win.webContents.sendInputEvent({type: "mouseDown", button: "left", clickCount: 1, ...p});
            };
            const up = (p: {x: number, y: number}) => win.webContents.sendInputEvent({type: "mouseUp", button: "left", clickCount: 1, ...p});
            for (const kind of ["view", "color", "automation"]) {
                await run(`openCase(${JSON.stringify(kind)})`); await tick();
                const before = await run("inspect()");
                const p = await point('[data-type="absDate"]');
                down(p); await tick();
                const held = await run("inspect()");
                equal(held.top, before.top, kind + " does not move during the first press");
                equal(held.transactions, 0, kind + " pointer down does not save");
                up(p); await tick();
                const after = await run("inspect()");
                equal(after.transactions, 0, kind + " first click cannot select a moved calendar day");
                equal(after.focusedPopup, true, kind + " first click focuses the popup");
                equal(after.calendars, 0, kind + " first click never embeds a calendar");
                equal(after.popups, 1, kind + " first click opens one popup");
                equal(after.top, before.top, kind + " opening never moves the parent");
                equal(after.bottom, before.bottom, kind + " opening never resizes the parent");
                equal(await run("checkReachable()"), true, kind + " popup stays reachable");
                const toggle = await point(".date-picker__month-toggle"); down(toggle); up(toggle); await tick();
                equal(await run("checkReachable()"), true, kind + " year editor growth stays reachable");
                equal((await run("inspect()")).transactions, 0, kind + " year browsing does not save");
                equal((await run("inspect()")).top, before.top, kind + " year editor never moves the parent");
                equal((await run("inspect()")).bottom, before.bottom, kind + " year editor never expands the parent");
                await run("panel.remove()"); await tick();
                equal((await run("inspect()")).observers, 0, kind + " detach releases local observers");

                await run(`openCase(${JSON.stringify(kind)})`); await tick();
                await run('menu.querySelector("[data-type=operation]").focus()');
                win.webContents.sendInputEvent({type: "keyDown", keyCode: "Tab"});
                win.webContents.sendInputEvent({type: "keyUp", keyCode: "Tab"}); await tick();
                equal((await run("inspect()")).active, true, kind + " Tab reaches the date input");
                equal((await run("inspect()")).popups, 0, kind + " Tab focus alone never opens a popup");
                win.webContents.sendInputEvent({type: "keyDown", keyCode: "Down", modifiers: ["alt"]});
                win.webContents.sendInputEvent({type: "keyUp", keyCode: "Down", modifiers: ["alt"]}); await tick();
                equal((await run("inspect()")).popups, 1, kind + " Alt+Down opens the popup");
                equal(await run("checkReachable()"), true, kind + " keyboard-opened popup stays reachable");
                equal((await run("inspect()")).transactions, 0, kind + " keyboard focus does not save");
                await run("panel.remove()"); await tick();
                equal((await run("inspect()")).observers, 0, kind + " repeated open and close releases observers");
            }
            await run('openCase("view")');
            const initial = await run("inspect()");
            await run('input.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerId:7}));'); await tick();
            await run('document.dispatchEvent(new PointerEvent("pointercancel",{bubbles:true,pointerId:8})); window.dispatchEvent(new Event("blur"))'); await tick();
            equal((await run("inspect()")).positions, initial.positions, "pointer interruption cannot reposition the parent");
            equal((await run("inspect()")).transactions, 0, "pointer interruption cannot save a draft");
            await run("panel.remove(); openCase('view')"); await tick();
            equal((await run("inspect()")).popups, 0, "detached owner releases the old popup");
            equal((await run("inspect()")).observers, 0, "detached owner releases popup positioning observers");
            equal((await run("inspect()")).positions, initial.positions + 1, "only the replacement's initial position runs");
            return "Filter host positioning passed";
        }});
        assert.match(result, /Filter host positioning passed/);
    });
}
