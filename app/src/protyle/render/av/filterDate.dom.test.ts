import * as assert from "node:assert/strict";
import {join} from "node:path";
import {readFileSync} from "node:fs";
import {compile} from "sass";
import test from "node:test";
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

for (const frontend of ["browser-desktop", "mobile"]) {
test("filter date dropdowns preserve endpoint semantics and isolate editor roots on " + frontend, {
    timeout: 45000, skip: !canRunBrowser,
}, async () => {
    const sources = {...pickerSources(), setup: setupPicker.toString(), frontend, ...browserSources(Object.fromEntries([
        ["model", "../../../datePicker/model.ts"], ["yearInput", "../../../datePicker/yearInput.ts"],
        ["field", "../../../datePicker/field.ts"], ["inline", "../../../datePicker/inline.ts"],
        ["capabilities.generated", "capabilities.generated.ts"], ["capabilities", "capabilities.ts"],
        ["filterTree", "filterTree.ts"], ["filter", "filter.ts"],
        ["automationTemplateFunctions", "automationTemplateFunctions.ts"], ["automation", "automation.ts"],
        ["conditionalColorMenu", "conditionalColorMenu.ts"],
    ].map(([name, path]) => [name, join(__dirname, path)])))};
    const css = readFileSync("appearance/themes/daylight/theme.css", "utf8") +
        compile("src/assets/scss/" + (frontend === "mobile" ? "mobile" : "base") + ".scss", {logger: {warn() {}}}).css;
    const result = await runBrowserCase(async (source, stylesheet) => {
        const style = document.createElement("style"); style.textContent = stylesheet; document.head.append(style);
        document.documentElement.dataset.frontend = source.frontend;
        const equal = (actual: unknown, expected: unknown, message: string) => {
            if (actual !== expected) { throw new Error(`${message}: ${actual} !== ${expected}`); }
        };
        window.siyuan = {languages: new Proxy({}, {get: (_, key) => String(key)}), config: {},
            menus: {menu: {remove() {}}}} as any;
        const modules: Record<string, any> = {};
        const transactions: any[] = [];
        const undoTransactions: any[] = [];
        const dateFilter = () => ({column: "date", operator: "Is between", value: {type: "date"}});
        const database = {id: "database", name: "Database", viewID: "view", keyValues: [
            {key: {id: "date", name: "Date", type: "date"}},
        ], automations: {spec: 1, rules: [{id: "rule", name: "Date rule", enabled: false, trigger: "update",
            conditions: [dateFilter()], actions: [{type: "edit", target: "filtered", avID: "database",
                filters: [dateFilter()], fields: {}}]}]}};
        const stubs: Record<string, any> = {
            "./view": {getFieldsByData: (data: any) => data.view.columns},
            "./col": {getColIconByType: () => "iconCalendar"},
            "../../../util/escape": {escapeHtml: String, escapeAttr: String},
            "../../wysiwyg/transaction": {transaction: (_: any, operations: any[], undo: any[]) => {
                transactions.push(...operations);
                undoTransactions.push(...undo);
            }},
            "../../../util/fetch": {fetchSyncPost: async () => ({code: 0, data: {av: database}})},
            "./conditionalColor": {getConditionalBackground: () => ""},
            "./filterDropdown": {closeInlineFilterDropdowns() {}},
            dayjs: {default: (value: number) => ({isValid: () => Number.isFinite(value),
                format: () => new Date(value).toISOString().slice(0, 10)})},
        };
        new Function("source", "modules", "stubs", "(" + source.setup + ")(source, modules, stubs)")(source, modules, stubs);
        for (const name of Object.keys(source).filter(name => !["setup", "frontend"].includes(name) && !modules[name])) {
            const exports = modules[name] = {};
            new Function("exports", "require", source[name])(exports, (path: string) =>
                stubs[path] || modules[path.split("/").at(-1)] || stubs.__fallback);
        }
        const make = (type: string, save?: (filters: any[]) => void, outer?: HTMLElement,
                      filterOperation: Record<string, string> = {}) => {
            const root = document.createElement("div");
            (outer || document.body).append(root);
            const data = {id: "database", view: {columns: [{id: "date", name: "Date", type}], filters: [{column: "date",
                operator: "Is between", dateEndpoint: "end", value: {type}}]}};
            const render = () => modules.filter.getFiltersHTML(data, true);
            root.innerHTML = render();
            modules.filter.bindInlineFilterEvents(root, data, {}, "carrier", "database", {root, render, save, ...filterOperation});
            return {root, data};
        };
        const fire = (input: HTMLInputElement | HTMLSelectElement, value: string) => {
            input.value = value;
            input.dispatchEvent(new Event("change", {bubbles: true}));
        };
        const tick = () => new Promise<void>(resolve => setTimeout(resolve, 80));
        const popup = () => window.siyuan.dialogs.at(-1)?.element as HTMLElement;
        const open = async (input: HTMLInputElement) => {
            input.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, button: 0})); await tick();
            equal(!!popup()?.querySelector(".date-picker"), true, "pointer opens the shared popup");
        };
        const choose = async (input: HTMLInputElement, value: string) => {
            const before = transactions.length;
            await open(input);
            equal(transactions.length, before, "opening never persists the draft");
            const field = popup().querySelector<HTMLInputElement>(".date-picker__fields input");
            field.value = value; field.dispatchEvent(new InputEvent("input", {bubbles: true}));
            const day = value && popup().querySelector<HTMLButtonElement>(`[data-date="${value}"]`);
            if (day && !day.disabled) {
                day.click();
                if (source.frontend === "mobile") {
                    equal(!!popup(), true, "mobile day selection keeps the draft open");
                    equal(transactions.length, before, "mobile day selection does not persist before confirmation");
                    popup().querySelector<HTMLButtonElement>('[data-action="confirm"]').click();
                }
            } else { popup().querySelector<HTMLButtonElement>('[data-action="confirm"]').click(); }
            await tick();
            equal(!!popup(), false, "selecting a date or confirming closes the popup");
        };
        const {root, data} = make("date");
        const start = root.querySelector<HTMLInputElement>('[data-type="absDate"]');
        const end = root.querySelector<HTMLInputElement>('[data-type="absDate2"]');
        equal(start.type, "text", "the first-render input cannot open a native date picker");
        equal(end.type, "text", "the second endpoint is also text before focus");
        equal(start.dataset.datePickerType, "date", "date semantics are explicit before binding");
        equal(root.querySelectorAll(".date-picker--inline").length, 0, "the calendar remains lazy");
        start.min = "2026-11-11";
        start.max = "2026-11-30";
        start.step = "2";
        const beforeAutofill = transactions.length;
        fire(start, "2026-11-");
        equal(transactions.length, beforeAutofill, "a change without prior focus validates before saving");
        equal(start.value, "2026-11-", "binding does not erase an incomplete draft");
        equal(root.querySelectorAll(".date-picker--inline").length, 0, "validation does not force the calendar open");
        start.focus();
        equal(root.querySelectorAll(".date-picker--inline").length, 0, "focus does not expand the condition");
        await open(start);
        equal(root.contains(popup()), false, "the popup is outside the condition flow");
        equal(transactions.length, beforeAutofill, "opening does not save an incomplete draft");
        popup().querySelector<HTMLButtonElement>('[data-action="cancel"]').click(); await tick();
        equal(start.value, "2026-11-", "cancel preserves the original draft");
        equal(transactions.length, beforeAutofill, "cancel never persists the draft");
        await open(start);
        if (source.frontend === "mobile") {
            await (window.siyuan.dialogs.at(-1) as any).requestClose("back");
        } else {
            popup().dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        }
        await new Promise<void>(resolve => setTimeout(resolve, 400));
        equal(!!popup(), false, "Back or Escape closes only the date popup");
        equal(start.value, "2026-11-", "Back or Escape preserves the draft");
        equal(transactions.length, beforeAutofill, "Back or Escape never saves");
        fire(start, "2026-11-11");
        fire(end, "2026-11-15");
        end.focus();
        equal(root.querySelectorAll(".date-picker--inline").length, 0, "both endpoints keep the original compact row");
        await choose(end, "2026-11-15");
        equal(data.view.filters[0].dateEndpoint, "end", "the field endpoint is independent of condition endpoints");
        equal((data.view.filters[0].value as any).date.content2, new Date("2026-11-15T00:00:00").getTime(), "second condition saves");
        equal((data.view.filters[0].value as any).date.isNotTime, true, "absolute filters are date-only");
        equal(transactions.at(-1).action, "setAttrViewFilters", "ordinary view uses its transaction");
        const beforeInvalid = transactions.length;
        for (const value of ["2026-11-12", "2026-12-01", "2026-11-", "not a date"]) {
            fire(start, value);
            equal(transactions.length, beforeInvalid, "step, range and incomplete dates cannot overwrite conditions");
        }
        fire(start, "");
        equal((data.view.filters[0].value as any).date.isNotEmpty, false, "explicitly clearing the date saves an empty endpoint");
        fire(start, "2026-11-11");
        const beforeComposition = transactions.length;
        start.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
        fire(start, "2026-11-13");
        equal(transactions.length, beforeComposition, "IME change events do not commit a partial edit");
        start.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
        fire(start, "2026-11-13");
        equal(transactions.length, beforeComposition + 1, "the completed date saves after composition ends");
        const beforeYear = transactions.length;
        await open(start);
        equal(transactions.length, beforeYear, "opening the focused input does not save");
        popup().querySelector<HTMLButtonElement>(".date-picker__month-toggle").click();
        const year = popup().querySelector<HTMLInputElement>(".date-picker__month-editor input");
        year.value = "2026";
        year.dispatchEvent(new InputEvent("input", {bubbles: true}));
        year.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
        equal(transactions.length, beforeYear, "year navigation never saves a condition");
        const staleDay = popup().querySelector<HTMLButtonElement>("[data-date]:not(:disabled)");
        equal(!!staleDay, true, "the detached-control check has a real calendar day");
        fire(root.querySelector<HTMLSelectElement>('[data-type="dateType"]'), "custom");
        await tick();
        equal(document.querySelectorAll(".date-picker").length, 0, "relative mode destroys the popup");
        const afterRelative = transactions.length;
        staleDay.click();
        equal(transactions.length, afterRelative, "detached controls cannot save late");
        fire(root.querySelector<HTMLSelectElement>('[data-type="dataDirection"]'), "-1");
        const count = root.querySelector<HTMLInputElement>('[data-type="relCount"]');
        count.value = "3";
        count.dispatchEvent(new FocusEvent("blur"));
        equal((data.view.filters[0] as any).relativeDate.count, 3, "relative counts retain immediate saving");
        const beforeNested = transactions.length;
        for (const type of ["created", "updated"]) {
            let nestedSaves = 0;
            const nested = make(type, () => nestedSaves++, root);
            const timestamp = nested.root.querySelector<HTMLInputElement>('[data-type="absDate"]');
            timestamp.focus();
            await choose(timestamp, "2025-01-01");
            equal(timestamp.readOnly, false, `${type} timestamps remain editable as filter conditions`);
            equal(nestedSaves, 1, "nested condition uses its own save callback");
        }
        equal(transactions.length, beforeNested, "nested condition does not write parent filters");
        equal(document.querySelectorAll('[role="dialog"], .b3-dialog').length, 0, "confirmed popups leave no dialog behind");
        root.remove();
        await Promise.resolve();
        for (const action of ["setAttrViewColRelationFilters", "setAttrViewColRollupFilters"]) {
            const owned = make("date", undefined, undefined, {action, avID: "source-database", keyID: "source-field"});
            const first = owned.root.querySelector<HTMLInputElement>('[data-type="absDate"]');
            const second = owned.root.querySelector<HTMLInputElement>('[data-type="absDate2"]');
            const before = transactions.length;
            const initial = JSON.stringify(owned.data.view.filters);
            first.focus();
            await choose(first, "2026-11-11");
            second.focus();
            await choose(second, "2026-11-15");
            await choose(first, "");
            equal(transactions.length, before + 3, `${action} commits each absolute date edit exactly once`);
            for (let index = before; index < transactions.length; index++) {
                for (const operation of [transactions[index], undoTransactions[index]]) {
                    equal(operation.action, action, "date do/undo retain the owning field action");
                    equal(operation.avID, "source-database", "date do/undo never target the queried database");
                    equal(operation.keyID, "source-field", "date do/undo retain the source field");
                    equal(operation.blockID, "carrier", "date do/undo retain the source carrier");
                }
                equal(JSON.stringify(undoTransactions[index].data), index === before ? initial :
                    JSON.stringify(transactions[index - 1].data), "undo retains the preceding absolute date snapshot");
            }
            equal(owned.data.id, "database", "editing does not replace the target field-query database");
            equal(transactions.at(-1).data[0].dateEndpoint, "end", "field endpoint survives source-owned date edits");
            equal(transactions.at(-1).data[0].value.date.isNotEmpty, false, "clear remains explicit");
            equal(transactions.at(-1).data[0].value.date.isNotEmpty2, true, "clear preserves the second condition endpoint");
            equal(transactions.at(-1).data[0].value.date.isNotTime, true, "source-owned dates remain date-only");
            owned.root.remove();
            await Promise.resolve();
        }
        const menu = document.createElement("div");
        document.body.append(menu);
        const options = {protyle: {options: {}}, blockElement: {dataset: {nodeId: "carrier"}},
            avID: "database", menuElement: menu, onResize() {}};
        await modules.automation.openAutomationMenu(options);
        for (const selector of ["[data-source-conditions]", "[data-target-filters]"]) {
            const input = menu.querySelector<HTMLInputElement>(`${selector} [data-type="absDate"]`);
            equal(!!input, true, `automation renders ${selector}`);
            input.focus();
            const before = transactions.length;
            await choose(input, "2026-12-05");
            equal(transactions.length, before + 1, "automation date edit saves once");
            equal(transactions.at(-1).action, "setAttrViewAutomations", "automation owns its persistence");
            const rule = transactions.at(-1).data.rules[0];
            const filter = selector === "[data-source-conditions]" ? rule.conditions[0] : rule.actions[0].filters[0];
            equal(filter.value.date.content, new Date("2026-12-05T00:00:00").getTime(), "automation saves the intended filter");
        }
        const colorData: any = {id: "database", viewID: "view", viewType: "table", view: {
            columns: [{id: "date", name: "Date", type: "date"}], filters: [],
            conditionalColors: [{id: "color-rule", target: "item", color: null, matchOption: false, filter: dateFilter()}],
        }};
        await modules.conditionalColorMenu.openConditionalColorsMenu({...options, data: colorData});
        const colorInput = menu.querySelector<HTMLInputElement>('[data-type="absDate"]');
        colorInput.focus();
        const beforeColor = transactions.length;
        await choose(colorInput, "2026-12-08");
        equal(transactions.length, beforeColor + 1, "color conditions save once");
        equal(transactions.at(-1).action, "setAttrViewConditionalColors", "color rules own persistence");
        equal(transactions.at(-1).data[0].filter.value.date.isNotTime, true, "color condition preserves date-only values");
        menu.remove();
        await Promise.resolve();
        return "filter dropdown DOM passed";
    }, sources, css);
    assert.match(result, /filter dropdown DOM passed/);
});
}

for (const [width, scheme, frontend] of [[400, "daylight", "browser-desktop"], [400, "midnight", "browser-desktop"],
    [800, "daylight", "browser-desktop"], [800, "midnight", "browser-desktop"], [1000, "daylight", "browser-desktop"],
    [400, "daylight", "mobile"], [800, "midnight", "browser-mobile"]] as const) {
    test(`filter date dropdowns fit production ${frontend} ${scheme} menus at ${width}px with German text and large fonts`, {
        timeout: 45000, skip: !canRunBrowser,
    }, async () => {
        const sources = {...pickerSources(), setup: setupPicker.toString(), ...browserSources(Object.fromEntries([
            ["model", "../../../datePicker/model.ts"], ["yearInput", "../../../datePicker/yearInput.ts"],
            ["field", "../../../datePicker/field.ts"], ["inline", "../../../datePicker/inline.ts"],
            ["capabilities.generated", "capabilities.generated.ts"], ["capabilities", "capabilities.ts"],
            ["filterTree", "filterTree.ts"], ["filter", "filter.ts"],
        ].map(([name, path]) => [name, join(__dirname, path)]))),
        frontend, languages: readFileSync("appearance/langs/de.json", "utf8"),
        icons: readFileSync("appearance/icons/litheness/icon.js", "utf8")};
        const css = readFileSync(`appearance/themes/${scheme}/theme.css`, "utf8") +
            compile(`src/assets/scss/${frontend === "mobile" ? "mobile" : "base"}.scss`, {logger: {warn() {}}}).css;
        const result = await runBrowserCase(async (source, stylesheet) => {
            const ok = (value: unknown, message: string) => { if (!value) { throw new Error(message); } };
            const style = document.createElement("style");
            style.textContent = stylesheet;
            document.documentElement.dataset.frontend = source.frontend;
            document.head.append(style);
            new Function(source.icons)();
            document.documentElement.style.setProperty("--b3-font-size", "24px");
            window.siyuan = {languages: JSON.parse(source.languages), config: {}} as any;
            const modules: Record<string, any> = {};
            const stubs: Record<string, any> = {
                "./view": {getFieldsByData: (data: any) => data.view.columns},
                "./col": {getColIconByType: () => "iconCalendar"},
                "../../../util/escape": {escapeHtml: String, escapeAttr: String},
            };
            new Function("source", "modules", "stubs", "(" + source.setup + ")(source, modules, stubs)")(source, modules, stubs);
            for (const name of ["inline", "capabilities.generated", "capabilities", "filterTree", "filter"]) {
                const exports = modules[name] = {};
                new Function("exports", "require", source[name])(exports, (path: string) =>
                    stubs[path] || modules[path.split("/").at(-1)] || stubs.__fallback);
            }
            for (const kind of ["view", "color", "automation"]) {
                const panel = document.createElement("div");
                panel.className = "av__panel";
                const menu = document.createElement("div");
                menu.className = "b3-menu " + ({view: "av__filter-panel", color: "av__conditional-panel", automation: "av__automation-panel"})[kind];
                menu.style.left = "16px";
                menu.style.top = "16px";
                if (source.frontend === "mobile") {
                    // Match the sheet shell and height installed by bindMobileAVPanel.
                    menu.classList.add("b3-menu--fullscreen", "b3-menu--sheet");
                    menu.style.height = `${innerHeight * .56}px`;
                    menu.style.maxHeight = `${innerHeight}px`;
                }
                if (innerWidth === 1000) { menu.style.width = "730px"; }
                const data = {view: {columns: [{id: "date", name: "Voraussichtliches Fertigstellungsdatum", type: "date"}],
                    filters: [{column: "date", operator: "Is between", value: {type: "date"}}]}};
                if (kind === "view") {
                    data.view.columns.push({id: "number", name: "Number", type: "number"});
                    data.view.filters.push({column: "number", operator: "=", value: {type: "number"}});
                }
                const remove = '<svg class="b3-menu__action b3-menu__action--show" data-action="remove"><use xlink:href="#iconTrashcan"></use></svg>';
                menu.innerHTML = kind === "view" ? modules.filter.getFiltersHTML(data) : kind === "color" ?
                    `<div class="b3-menu__items"><div class="av__conditional-colors"><div data-rules><div class="av__conditional-rule"><span class="block__icon block__icon--show" data-conditional-drag><svg><use xlink:href="#iconDrag"></use></svg></span><div class="av__conditional-condition">${modules.filter.getFiltersHTML(data, true)}</div>${remove}<div class="av__conditional-controls"><button class="b3-button b3-button--cancel">${window.siyuan.languages.default}</button></div></div></div></div></div>` :
                    `<div class="b3-menu__items"><div class="av__automation"><div class="av__automation-body"><section class="av__automation-section"><div data-source-conditions><div class="av__automation-row"><div class="av__automation-filter">${modules.filter.getFiltersHTML(data, true)}</div>${remove}</div></div></section></div></div></div>`;
                panel.append(menu);
                document.body.append(panel);
                const root = kind === "view" ? panel : menu.querySelector<HTMLElement>(kind === "color" ? ".av__conditional-condition" : ".av__automation-filter");
                modules.filter.bindInlineFilterEvents(root, data, {}, "carrier", "database", {root: kind === "view" ? menu : root, save() {}});
                const inputs = menu.querySelectorAll<HTMLInputElement>('[data-type="absDate"], [data-type="absDate2"]');
                inputs[0].focus(); inputs[1].focus();
                const before = menu.getBoundingClientRect().toJSON();
                inputs[1].dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, button: 0}));
                await new Promise<void>(resolve => setTimeout(resolve, 400));
                const scroll = menu.querySelector<HTMLElement>(".b3-menu__items");
                ok(getComputedStyle(menu).fontSize === "24px", kind + " uses the large menu font");
                ok(menu.querySelectorAll(".date-picker--inline").length === 0, kind + " never embeds a calendar");
                const after = menu.getBoundingClientRect();
                ok(Math.abs(after.top - before.top) < 1 && Math.abs(after.height - before.height) < 1,
                    kind + " popup does not expand or move its parent menu");
                ok(menu.getBoundingClientRect().right <= innerWidth, kind + " menu remains inside the viewport");
                ok(scroll.scrollWidth <= scroll.clientWidth + 1,
                    `${kind} has no horizontal overflow (${scroll.scrollWidth}/${scroll.clientWidth})`);
                const popup = window.siyuan.dialogs.at(-1)?.element as HTMLElement;
                ok(popup && !menu.contains(popup), kind + " owns a separate popup");
                const calendar = popup.querySelector<HTMLElement>(".date-picker");
                const container = popup.querySelector<HTMLElement>(".b3-dialog__container");
                const bounds = container.getBoundingClientRect();
                ok(bounds.left >= -1 && bounds.top >= -1 && bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1,
                    kind + " popup fits its viewport: " + JSON.stringify(bounds));
                ok(calendar.scrollWidth <= calendar.clientWidth + 1, kind + " calendar fits without horizontal clipping");
                const numberRow = menu.querySelector<HTMLElement>('[data-column="number"]');
                if (numberRow) {
                    ok(getComputedStyle(numberRow).display === "flex", "mixed number condition retains ordinary flex layout");
                }
                const buttons = popup.querySelectorAll<HTMLButtonElement>(".date-picker__navigation button, [data-date]:not(:disabled), [data-action]");
                ok(buttons.length >= 30, kind + " has operable navigation, dates and actions");
                for (const button of buttons) {
                    button.scrollIntoView({block: "nearest", inline: "nearest"});
                    const rect = button.getBoundingClientRect();
                    ok(rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.right <= innerWidth + 1 &&
                        rect.top >= -1 && rect.bottom <= innerHeight + 1, kind + " popup controls stay reachable");
                    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                    ok(target === button || button.contains(target), kind + " popup control is unobscured: " + button.outerHTML);
                }
                panel.remove();
                await new Promise<void>(resolve => setTimeout(resolve, 100));
                ok(!popup.isConnected, kind + " closing the owner releases its popup");
            }
            return "production filter layout passed";
        }, sources, css, {width, height: 400});
        assert.match(result, /production filter layout passed/);
    });
}
