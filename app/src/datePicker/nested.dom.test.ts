import * as assert from "node:assert/strict";
import test from "node:test";
import {join} from "node:path";
import {readFileSync} from "node:fs";
import {compile} from "sass";
import {browserSources, canRunBrowser, runBrowserCase} from "./test/browser";

const browserCases = async (sources: Record<string, string>, css: string) => {
    const equal = (actual: unknown, expected: unknown, message = "") => {
        if (actual !== expected) { throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`); }
    };
    const ok = (value: unknown, message: string) => { if (!value) { throw new Error(message); } };
    const style = document.createElement("style"); style.textContent = css; document.head.append(style);
    document.documentElement.dataset.frontend = "browser-mobile";
    const sidebar = document.createElement("div"); sidebar.id = "sidebar"; document.body.append(sidebar);
    const modules: Record<string, any> = {};
    let uuid = 0;
    const fallback = {genUUID: () => String(++uuid), getZIndex: () => 0, isAbove: () => false,
        isMobile: () => true, isInMobileApp: () => false, isIOSPlatform: () => false, isNotCtrl: () => true, moveResize() {},
        Constants: {TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0}, destroyDialogBlockPanels() {}, getDialogBlockPanel() {},
        getAnchoredInputMask() {}, callMobileAppShowKeyboard() {}, showMessage() {}, getEventName: () => "click",
        updateHotkeyTip: (value: string) => value, escapeAttr: (value: string) => value, applyMenuEntryVisibility() {},
        setPopoverMenuOpen() {}, activeBlur() {}, getTopBarHeight: () => 0, isScrollAboveMenu: () => false,
        electronUndo() {}, forEachPluginSubscriber() {}};
    const load = (name: string, deps: Record<string, unknown> = {}) => {
        const exports = modules[name] ||= {};
        new Function("exports", "require", sources[name])(exports, (path: string) => deps[path] || modules[path.split("/").at(-1)] || fallback);
        return exports;
    };
    const common = document.createElement("div"); common.className = "b3-menu fn__none";
    common.innerHTML = '<div class="b3-menu__title"><span class="b3-menu__label"></span></div><div class="b3-menu__items"></div>';
    document.body.append(common);
    const languages = {date: "Date", datePickerTime: "Time", month: "Month", year: "Year", previous: "Previous", next: "Next",
        calendarToday: "Today", clear: "Clear", confirm: "Confirm", cancel: "Cancel", invalid: "Invalid"};
    (window as any).siyuan = {dialogs: [], zIndex: 10, languages, config: {}, isReady: true,
        mobile: {size: {isLandscape: false, portrait: {height1: 900}, landscape: {height1: 900}}},
        menus: {}};
    ["overlayOwnership", "dialog", "model", "field", "runtime", "owners", "sheetOpen", "mobileSheetGesture",
        "visibleViewport", "orientation", "keyboardSheetState", "mobileSheetLayout", "bindBottomSheetDrag", "bindBottomSheetDialog"].forEach(name => load(name));
    ["menuGroup", "sheetActions", "hasClosest"].forEach(name => load(name));
    const realMenu = load("realMenu", {"../config/entryVisibility/runtime": fallback});
    (window as any).siyuan.menus.menu = new realMenu.Menu(common);
    const {MobileDialog} = load("mobileDialog", {"./index": modules.dialog});
    modules.panel = {registerDatePickerWindow() {}}; modules.index = {};
    load("binding"); const api = load("index");
    modules.runtime.registerDatePickerRuntime(document, (options: unknown) => new MobileDialog(options), () => languages);
    const {Menu} = load("pluginMenu", {"../menus/Menu": realMenu});
    const nativeSelect = load("nativeSelect", {"../../plugin/Menu": {Menu}, "../../util/escape": {escapeHtml: (value: string) => value}});
    nativeSelect.initMobileSelect();
    const tick = () => new Promise<void>(resolve => setTimeout(resolve, 80));
    const trigger = document.createElement("button"); document.body.append(trigger);
    let parentClosed = 0;
    const parent = new Menu(undefined, () => parentClosed++, true);
    const input = document.createElement("input"); input.type = "datetime-local"; input.value = "2024-02-28T13:00";
    parent.element.lastElementChild.append(input); parent.open({target: trigger});
    const binding = api.bindDatePicker(input);
    binding.open();
    const dialog = (window as any).siyuan.dialogs.at(-1);
    const root = dialog.element as HTMLElement;
    equal(root.querySelector<HTMLElement>(".b3-dialog__container").style.visibility, "hidden", "real mobile sheet starts hidden");
    await tick();
    equal(root.querySelector<HTMLElement>(".b3-dialog__container").style.visibility, "", "real mobile sheet becomes visible");
    equal((document.activeElement as HTMLElement).dataset.date, "2024-02-28", "mobile focus waits for the sheet");
    const time = root.querySelectorAll<HTMLInputElement>(".date-picker__fields input")[1];
    time.click(); equal(parentClosed, 0, "window capturing menu dismissal respects the picker");
    const month = root.querySelector<HTMLSelectElement>("select"); month.click();
    const menu = nativeSelect.getMobileSelectMenuElement() as HTMLElement;
    ok(menu && menu !== common, "month select creates an independent derived menu");
    equal(parentClosed, 0);
    equal(modules.overlayOwnership.getMenuOwnerElement(month), parent.element);
    const march = Array.from(menu.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent.trim() === "March");
    ok(march, "month menu includes March");
    const tab = (shiftKey = false) => {
        const event = new KeyboardEvent("keydown", {key: "Tab", shiftKey, bubbles: true, cancelable: true});
        document.activeElement.dispatchEvent(event);
        return event;
    };
    march.focus();
    equal(tab().defaultPrevented, false, "Tab inside the month menu keeps native traversal");
    equal(document.activeElement, march, "Tab does not steal month focus");
    equal(tab(true).defaultPrevented, false, "Shift+Tab inside the month menu keeps native traversal");
    const choices = Array.from(menu.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex], [contenteditable]"))
        .filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length &&
            getComputedStyle(element).visibility === "visible");
    choices.at(-1).focus(); equal(document.activeElement, choices.at(-1), "last month receives focus");
    equal(tab().defaultPrevented, true, "Tab wraps at month menu end");
    equal(document.activeElement, choices[0], "month menu wraps to its first choice");
    equal(tab(true).defaultPrevented, true, "Shift+Tab wraps at month menu start");
    equal(document.activeElement, choices.at(-1), "month menu wraps to its last choice");
    march.click(); await tick();
    equal(month.value, "3"); equal(parentClosed, 0); ok(root.isConnected, "month selection preserves picker");
    equal(input.value, "2024-02-28T13:00", "month navigation does not commit a date");
    tab(); ok(root.contains(document.activeElement), "Tab after month close returns to the current picker");
    month.click(); const pendingChild = nativeSelect.getMobileSelectMenuElement() as HTMLElement;
    await dialog.requestClose("back"); await tick();
    ok(!root.isConnected && !pendingChild.isConnected, "closing picker cleans its month menu");
    equal(parentClosed, 0, "back only closes the date picker");
    binding.open(); await tick();
    const closingPicker = (window as any).siyuan.dialogs.at(-1).element as HTMLElement;
    closingPicker.querySelector<HTMLSelectElement>("select").click();
    const closingMonth = nativeSelect.getMobileSelectMenuElement() as HTMLElement;
    parent.close(); await tick();
    equal(parentClosed, 1); ok(!closingPicker.isConnected && !closingMonth.isConnected, "closing the parent cleans both descendants");

    const owner = document.createElement("button"); const overlay = document.createElement("div");
    const nested = document.createElement("div"); document.body.append(owner, overlay, nested);
    let closed = 0;
    const release = modules.overlayOwnership.registerMenuOverlay(owner, overlay, () => closed++);
    modules.overlayOwnership.registerMenuOverlay(overlay, nested, () => closed++);
    ok(modules.overlayOwnership.isMenuOverlayTarget(owner, nested), "nested ownership follows only registered relations");
    let rejected = false;
    try { modules.overlayOwnership.registerMenuOverlay(nested, owner, () => {}); } catch { rejected = true; }
    ok(rejected, "cycles are rejected");
    const other = document.implementation.createHTMLDocument("other"); const foreign = other.createElement("div"); other.body.append(foreign);
    rejected = false;
    try { modules.overlayOwnership.registerMenuOverlay(owner, foreign, () => {}); } catch { rejected = true; }
    ok(rejected, "cross-document owners are rejected");
    modules.overlayOwnership.closeMenuOverlays(owner); equal(closed, 2, "all derived layers close synchronously");
    release(); ok(!modules.overlayOwnership.isMenuOverlayTarget(owner, nested), "release removes containment");
    return "Nested date picker and mobile host passed";
};

test("date picker uses the real mobile sheet and preserves nested menu ownership", {timeout: 45000, skip: !canRunBrowser}, async () => {
    const files = Object.fromEntries(["model", "field", "runtime", "owners", "binding", "index"].map(name => [name, join(__dirname, name + ".ts")]));
    const mobile = Object.fromEntries(["mobileSheetGesture", "visibleViewport", "orientation", "keyboardSheetState", "mobileSheetLayout",
        "bindBottomSheetDrag", "bindBottomSheetDialog", "nativeSelect"].map(name => [name, join(__dirname, "../mobile/util", name + ".ts")]));
    const sources = browserSources({...files, ...mobile, realMenu: join(__dirname, "../menus/Menu.ts"),
        menuGroup: join(__dirname, "../menus/menuGroup.ts"), sheetActions: join(__dirname, "../menus/sheetActions.ts"),
        hasClosest: join(__dirname, "../protyle/util/hasClosest.ts"), dialog: join(__dirname, "../dialog/index.ts"),
        mobileDialog: join(__dirname, "../dialog/mobileDialog.ts"), pluginMenu: join(__dirname, "../plugin/Menu.ts"),
        overlayOwnership: join(__dirname, "../menus/overlayOwnership.ts"), sheetOpen: join(__dirname, "../menus/sheetOpen.ts")});
    const css = compile(join(__dirname, "../assets/scss/mobile.scss"), {logger: {warn() {}}}).css;
    const theme = readFileSync(join(__dirname, "../../appearance/themes/daylight/theme.css"), "utf8");
    assert.match(await runBrowserCase(browserCases, sources, theme + css, {width: 320}), /Nested date picker and mobile host passed/);
});
