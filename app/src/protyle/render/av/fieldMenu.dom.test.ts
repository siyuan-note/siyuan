import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {compile} from "sass";
import {browserSources, canRunBrowser, runBrowserCase} from "../../../datePicker/test/browser";

test("date and number field menus share placement, checked choices, cancellation and mobile taps", {
    timeout: 45000, skip: !canRunBrowser,
}, async () => {
    const sources = browserSources({
        position: join(__dirname, "../../../util/setPosition.ts"), menu: join(__dirname, "../../../menus/Menu.ts"), field: join(__dirname, "fieldMenu.ts"),
        format: join(__dirname, "dateFormat.ts"), setter: join(__dirname, "dateFormatMenu.ts"), number: join(__dirname, "number.ts"),
        column: join(__dirname, "col.ts"), capabilities: join(__dirname, "capabilities.ts"),
        generated: join(__dirname, "capabilities.generated.ts"), viewType: join(__dirname, "viewType.ts"),
        escape: join(__dirname, "../../../util/escape.ts"),
    });
    sources.languages = readFileSync("appearance/langs/en.json", "utf8");
    sources.light = readFileSync("appearance/themes/daylight/theme.css", "utf8");
    sources.dark = readFileSync("appearance/themes/midnight/theme.css", "utf8");
    const css = compile("src/assets/scss/base.scss").css;
    const browserCase = async (source: Record<string, string>, styles: string) => {
        const equal = (actual: unknown, expected: unknown, message: string) => {
            if (actual !== expected) { throw new Error(`${message}: ${actual} !== ${expected}`); }
        };
        const style = document.createElement("style");
        style.textContent = styles + `body{margin:0;font:14px sans-serif}.fn__none{display:none}
            .b3-menu{width:260px}.b3-menu__submenu{min-width:220px}`;
        document.head.append(style);
        document.documentElement.dataset.frontend = "browser-desktop";
        const theme = document.createElement("style");
        theme.textContent = source.light;
        document.head.append(theme);
        const errors: string[] = [];
        window.addEventListener("error", event => errors.push(event.message));
        let mobile = false;
        let mobileChoices: IMenu[] = [];
        let mobileOpenCount = 0;
        let mobileSheet = false;
        let refreshes = 0;
        let otherRefreshes = 0;
        const transactions: {do: IOperation[], undo: IOperation[]}[] = [];
        const protyle = {databaseAttributePanel: {refresh() { refreshes++; }}};
        Object.assign(window, {siyuan: {languages: JSON.parse(source.languages), menus: {menu: null}}});
        const modules: Record<string, any> = {
            "../util/functions": {isMobile: () => mobile},
            "../protyle/util/compatibility": {updateHotkeyTip: (value: string) => value},
            "./menuGroup": {updateMenuItemGroupClasses() {}},
            "../layout/getTopBarHeight": {getTopBarHeight: () => 0},
            "../protyle/util/hasClosest": {hasClosestByClassName: (element: Element, name: string) => element?.closest("." + name)},
            "../../../util/functions": {isMobile: () => mobile},
            "../../../plugin/Menu": {Menu: class {
                constructor(_id: string, _callback: unknown, sheet: boolean) { mobileSheet = sheet; mobileChoices = []; }
                public addItem(item: IMenu) { mobileChoices.push(item); }
                public open() { mobileOpenCount++; }
            }},
            "./lunarCalendar": {},
            "../../../template/httpPermission": {templateHTTPPermissionHTML: () => ""},
            "./view": {getFieldsByData: (data: IAV) => (data.view as IAVTable).columns},
            "../../wysiwyg/transaction": {transaction: (_protyle: unknown, operations: IOperation[], undo: IOperation[], options: any) => {
                transactions.push({do: operations, undo}); options.callback();
            }},
            "../../../layout/getAll": {getAllEditor: () => [{protyle},
                {protyle: {databaseAttributePanel: {hasDatabase: (id: string) => id === "database", refresh() { otherRefreshes++; }}}}]},
        };
        for (const [name, alias] of [["position", "../util/setPosition"], ["generated", "./capabilities.generated"], ["capabilities", "./capabilities"],
            ["viewType", "./viewType"], ["escape", "../../../util/escape"], ["menu", "../../../menus/Menu"], ["format", "./dateFormat"],
            ["setter", "./dateFormatMenu"], ["number", "./number"], ["field", "./fieldMenu"], ["column", "./col"]]) {
            const exports = modules[alias] = {};
            new Function("exports", "require", source[name])(exports, (id: string) => modules[id] || {});
        }
        const owner = document.createElement("div");
        const Menu = modules["../../../menus/Menu"].Menu;
        const menu = Object.create(Menu.prototype);
        menu.element = owner;
        window.siyuan.menus.menu = menu;
        menu.remove = () => {};
        const numberFormats = ["", "commas", "percent", "USD", "CNY", "EUR", "GBP", "JPY", "RUB", "INR", "KRW",
            "TRY", "CAD", "CHF", "THB", "AUD", "HKD", "TWD", "MOP", "SGD", "NZD", "ILS"];
        const formats: string[] = ["", "full", "month-day-year", "day-month-year", "year-month-day"];
        const mount = (type: string, oldFormat: string, left = 30) => {
            owner.className = "av__panel";
            const field = {id: "field", name: "Date", type, dateFormat: oldFormat, numberFormat: oldFormat, icon: "", desc: ""};
            const html = modules["./col"].getEditHTML({colId: field.id, isCustomAttr: false,
                data: {id: "database", viewType: "table", view: {columns: [field]}}});
            owner.innerHTML = `<div class="b3-menu" style="left:${left}px;top:60px">${html}
                <button class="b3-menu__item" data-type="other">Other</button></div>`;
            document.body.append(owner);
            modules["./fieldMenu"].bindFieldMenus(protyle, "database", field, owner);
            return owner.querySelector<HTMLElement>(`[data-type="${type === "number" ? "numberFormat" : "dateFormat"}"]`);
        };
        for (const type of ["date", "created", "updated", "number"]) {
            const choicesForType = type === "number" ? numberFormats : formats;
            for (const oldFormat of choicesForType) {
                for (const nextFormat of choicesForType) {
                    const parent = mount(type, oldFormat);
                    equal(Array.from(parent.querySelectorAll("use")).filter(use => use.getAttribute("xlink:href") === "#iconRight").length,
                        1, "Parent has right arrow");
                    const submenu = parent.querySelector<HTMLElement>(".b3-menu__submenu");
                    const choices = Array.from(submenu.querySelectorAll<HTMLButtonElement>(".b3-menu__item"));
                    equal(choices.length, choicesForType.length, "All existing formats remain available");
                    equal(choices.findIndex(choice => !!choice.querySelector(".b3-menu__checked")), choicesForType.indexOf(oldFormat), "Saved format is checked");
                    const count = transactions.length;
                    parent.dispatchEvent(new MouseEvent("mouseenter"));
                    equal(getComputedStyle(submenu).display, "block", "Hover opens submenu");
                    const rect = submenu.getBoundingClientRect();
                    const parentRect = parent.getBoundingClientRect();
                    if (innerWidth - parentRect.right >= rect.width + 8) {
                        equal(rect.left >= parentRect.right, true, "Submenu opens right when space permits");
                    }
                    equal(rect.left >= 0 && rect.right <= innerWidth, true, "Submenu stays within wide and narrow viewports");
                    submenu.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
                    equal(getComputedStyle(submenu).display, "block", "Crossing submenu padding keeps it open");
                    parent.focus();
                    parent.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true}));
                    equal(document.activeElement, choices[0], "Right arrow focuses first choice");
                    choices[0].dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
                    equal(parent.classList.contains("b3-menu__item--show"), false, "Escape closes choices");
                    equal(document.activeElement, parent, "Cancel restores parent focus");
                    equal(transactions.length, count, "Hover and cancel do not write");
                    parent.click(); parent.click();
                    equal(parent.querySelectorAll(".b3-menu__submenu").length, 1, "Repeated opening reuses submenu");
                    owner.querySelector('[data-type="other"]').dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
                    equal(parent.classList.contains("b3-menu__item--show"), false, "Other item closes submenu");
                    parent.click();
                    choices[choicesForType.indexOf(nextFormat)].click();
                    equal(transactions.length, count + (nextFormat === oldFormat ? 0 : 1), "Selection writes only changed values");
                    if (nextFormat !== oldFormat) {
                        const transaction = transactions.at(-1);
                        equal(transaction.do[0].action, type === "number" ? "updateAttrViewColNumberFormat" : "setAttrViewColDateFormat", "Correct transaction action");
                        equal(transaction.do[0].id, "field", "Correct field");
                        equal(transaction.do[0].avID, "database", "Correct database");
                        equal(transaction.do[0].format, nextFormat, "Selected format persists");
                        equal(transaction.do[0].type, type, "Field type is preserved");
                        equal(transaction.undo[0].format, oldFormat, "Undo preserves previous format");
                    }
                    equal(owner.isConnected, false, "Selection closes the field panel");
                }
            }
            const rightParent = mount(type, choicesForType[1], innerWidth - 280);
            rightParent.dispatchEvent(new MouseEvent("mouseenter"));
            const rect = rightParent.querySelector(".b3-menu__submenu").getBoundingClientRect();
            if (rightParent.getBoundingClientRect().left >= rect.width + 8) {
                equal(rect.right <= rightParent.getBoundingClientRect().left, true, "Right edge flips submenu left");
            }
            equal(rect.left >= 0 && rect.right <= innerWidth, true, "Edge menu stays in viewport");
            owner.remove();
        }
        for (const oldFormat of ["full", "lunar"] as TAVDateFormat[]) {
            mount("date", oldFormat);
            const calendar = owner.querySelector<HTMLElement>('[data-type="dateCalendar"]');
            const format = owner.querySelector<HTMLElement>('[data-type="dateFormat"]');
            equal(format.classList.contains("fn__none"), oldFormat === "lunar", "Lunar calendar hides solar formats");
            calendar.dispatchEvent(new MouseEvent("mouseenter"));
            format.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
            equal(calendar.classList.contains("b3-menu__item--show"), false, "Date format hover closes calendar submenu");
            owner.remove();
        }
        for (const palette of [source.light, source.dark]) {
            theme.textContent = palette;
            for (const size of [14, 24]) {
                document.documentElement.style.setProperty("--b3-font-size", `${size}px`);
                const parent = mount("date", "full");
                const labelLeft = parent.querySelector(".b3-menu__label").getBoundingClientRect().left;
                for (const name of ["fillCreated", "fillSpecificTime"]) {
                    const label = owner.querySelector(`[data-type="${name}"]`).closest("label");
                    const textLeft = label.querySelector(".fn__flex-center").getBoundingClientRect().left;
                    equal(Math.abs(labelLeft - textLeft) < 0.5, true, "Date default labels align in both themes and font sizes");
                }
                parent.dispatchEvent(new MouseEvent("mouseenter"));
                const submenu = parent.querySelector(".b3-menu__submenu").getBoundingClientRect();
                equal(submenu.left >= 0 && submenu.right <= innerWidth, true, "Themed submenu remains visible with large fonts");
                owner.remove();
                const number = mount("number", "ILS", innerWidth - 280);
                number.dispatchEvent(new MouseEvent("mouseenter"));
                const numberMenu = number.querySelector<HTMLElement>(".b3-menu__submenu");
                const numberRect = numberMenu.getBoundingClientRect();
                equal(numberRect.left >= 0 && numberRect.right <= innerWidth, true, "Number formats remain visible in both themes and font sizes");
                equal(numberRect.top >= 0 && numberRect.bottom <= innerHeight, true, "Long number submenu fits viewport height");
                const last = numberMenu.querySelector<HTMLElement>(".b3-menu__items").lastElementChild as HTMLElement;
                last.scrollIntoView({block: "nearest"});
                equal(last.getBoundingClientRect().bottom <= numberRect.bottom, true, "Last currency choice remains reachable");
                owner.remove();
            }
        }
        document.documentElement.style.removeProperty("--b3-font-size");
        mobile = true;
        for (const type of ["date", "created", "updated", "number"]) {
            const choicesForType = type === "number" ? numberFormats : formats;
            const parent = mount(type, choicesForType[1]);
            const count = transactions.length;
            parent.dispatchEvent(new MouseEvent("mouseenter"));
            equal(parent.classList.contains("b3-menu__item--show"), false, "Mobile ignores hover");
            const opened = mobileOpenCount;
            parent.click();
            equal(mobileOpenCount, opened + 1, "Tap opens mobile choices");
            equal(mobileSheet, true, "Mobile uses existing fullscreen choices");
            equal(mobileChoices.length, choicesForType.length, "Mobile retains all formats");
            equal(mobileChoices[1].checked, true, "Mobile shows selected value");
            equal(transactions.length, count, "Opening then dismissing makes no change");
            parent.click();
            mobileChoices[3].click(parent, new MouseEvent("click"));
            equal(transactions.length, count + 1, "Reopened mobile selection saves once");
            equal(transactions.at(-1).undo[0].format, choicesForType[1], "Mobile undo keeps previous format");
            equal(owner.isConnected, false, "Mobile selection closes field panel");
        }
        equal(refreshes, transactions.length, "Changes refresh the active attribute panel once");
        equal(otherRefreshes, transactions.length, "Changes refresh other panels for this database once");
        equal(errors.length, 0, "Menu events report no browser errors: " + errors.join("; "));
        return "field menu cases passed";
    };
    for (const width of [1000, 420]) {
        const result = await runBrowserCase(browserCase, sources, css, {width, height: 760});
        assert.match(result, /field menu cases passed/);
    }
});
