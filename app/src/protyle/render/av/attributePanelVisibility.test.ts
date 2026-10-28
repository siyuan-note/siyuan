import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";
import {compileString} from "sass";

const browserCases = async (source: string, css: string, columnSource: string, blockSource: string, menuSource: string, calendarSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    const config = {editor: {databaseAttrShow: true, databaseAttrHideEmpty: false, databaseAttrViewMode: 0, databaseAttrUseTabs: false}};
    const dialogs: {element: HTMLElement, destroy: () => void}[] = [];
    Object.assign(window, {siyuan: {config, dialogs, languages: {
        database: "Database", edit: "Edit", displayEmptyFields: "Show", hideEmptyFields: "Hide",
        default: "Default", attributePanelVisibility: "Database panel field visibility",
        alwaysShow: "Always show", hideWhenEmpty: "Hide when empty", alwaysHide: "Always hide",
        _attrView: {dateCalendar: "Calendar", solarCalendar: "Gregorian", lunarCalendar: "Chinese lunar"},
    }}});
    const Panel = new Function("cancelHeightAnimation", "escapeHtmlTextAndAttr", source + "\nreturn AVAttributePanel;")(
        () => {}, (value: string) => value);
    const style = document.createElement("style");
    style.textContent = css + ".fn__none {display:none} .av__row {display:flex}";
    document.head.append(style);
    for (const hideEmpty of [false, true]) {
        config.editor.databaseAttrHideEmpty = hideEmpty;
        const protyle = {disabled: false};
        const panel = new Panel(protyle);
        panel.element.dataset.rendered = "true";
        const body = panel.element.querySelector(".protyle-db-attr__body");
        body.innerHTML = `<div data-av-id="database">
            <div id="default" class="av__row" data-empty="true" data-panel-visibility="">Default</div>
            <div id="always" class="av__row" data-empty="true" data-panel-visibility="always">Always</div>
            <div id="empty" class="av__row" data-empty="true" data-panel-visibility="hide-empty">Hide when empty</div>
            <div id="hidden" class="av__row" data-empty="false" data-panel-visibility="hide">Hidden</div>
            <div id="filled" class="av__row" data-empty="false" data-panel-visibility="">Filled</div>
            <div id="primary" class="av__row" data-empty="true" data-panel-visibility="" data-primary="true">Primary</div>
        </div>`;
        document.body.append(panel.element);
        panel.updateDisplayConfig();
        const visible = (id: string) => getComputedStyle(panel.element.querySelector("#" + id)).display !== "none";
        check.equal(visible("default"), !hideEmpty);
        check.equal(visible("always"), true);
        check.equal(visible("empty"), false);
        check.equal(visible("hidden"), false);
        check.equal(visible("filled"), true);
        check.equal(visible("primary"), true);
        const edit = panel.element.querySelector('[data-type="toggle-empty"]');
        check.equal(edit.classList.contains("fn__none"), false);
        edit.click();
        for (const id of ["default", "always", "empty", "hidden", "filled", "primary"]) {
            check.equal(visible(id), true, `edit reveals ${id}`);
        }
        check.equal(edit.getAttribute("aria-pressed"), "true");
        edit.click();
        check.equal(visible("hidden"), false);
        panel.element.querySelector("#empty").dataset.empty = "false";
        check.equal(visible("empty"), true, "filled fields become visible immediately");
        panel.element.querySelector("#empty").dataset.empty = "true";
        panel.displayEmptyFields();
        check.equal(visible("hidden"), true);
        protyle.disabled = true;
        panel.updateReadonly();
        check.equal(visible("hidden"), true, "readonly panels can reveal fields");
        panel.element.remove();
    }
    const pending: Array<() => void> = [];
    const preparedAPI = new Function("cancelHeightAnimation", "renderAVAttribute", source +
        "\nreturn {AVAttributePanel, prepareDatabaseAttributePanel};")(() => {},
    (element: HTMLElement, id: string, _protyle: unknown, callback: (element: HTMLElement) => void) => {
        pending.push(() => {
            element.innerHTML = `<div data-av-id="database">${id}<button data-type="av-bind-document"></button></div>`;
            callback(element);
        });
    });
    const bound = {disabled: false, options: {}, block: {showAll: true, id: "first"}};
    const boundPanel = new preparedAPI.AVAttributePanel(bound);
    document.body.append(boundPanel.element);
    boundPanel.render();
    pending.shift()();
    const firstBody = boundPanel.element.querySelector(".protyle-db-attr__body");
    const preparing = preparedAPI.prepareDatabaseAttributePanel(bound, "second");
    check.equal(boundPanel.element.querySelector(".protyle-db-attr__body"), firstBody);
    check.equal(firstBody.textContent, "first");
    pending.shift()();
    const commit = await preparing;
    check.equal(firstBody.isConnected, true, "preparation does not remove the visible body");
    commit();
    bound.block.id = "second";
    boundPanel.render();
    check.equal(pending.length, 0, "committing must not start another asynchronous attribute request");
    check.equal(firstBody.isConnected, false);
    check.equal(boundPanel.element.querySelector(".protyle-db-attr__body").textContent, "second");
    let ready = false;
    boundPanel.afterRender(() => { ready = true; });
    check.equal(ready, true, "the new body is ready in the same turn as the document");
    bound.disabled = true;
    boundPanel.updateReadonly();
    check.equal(boundPanel.element.querySelector('[data-type="av-bind-document"]').disabled, true);
    bound.disabled = false;
    boundPanel.updateReadonly();
    check.equal(boundPanel.element.querySelector('[data-type="av-bind-document"]').disabled, false);
    boundPanel.render(true);
    check.equal(pending.length, 1, "subsequent refreshes request fresh attributes");
    pending.shift()();
    boundPanel.element.remove();
    config.editor.databaseAttrUseTabs = true;
    const tabPanel = new Panel({disabled: false});
    tabPanel.element.dataset.rendered = "true";
    const tabBody = tabPanel.element.querySelector(".protyle-db-attr__body") as HTMLElement;
    tabBody.innerHTML = ["first", "second"].map(id => `<div data-av-id="${id}">
        <div class="custom-attr__avheader"><div class="block__logo"><span>${id}</span></div></div>
    </div>`).join("");
    document.body.append(tabPanel.element);
    tabPanel.updateDisplayConfig();
    const tabButtons = Array.from(tabBody.querySelectorAll<HTMLButtonElement>('[data-type="av-tab"]'));
    const tabChanges = new MutationObserver(() => {});
    tabChanges.observe(tabBody.querySelector(".protyle-db-attr__tabs"), {childList: true, subtree: true});
    for (const pointerType of ["mouse", "touch"]) {
        for (const index of [1, 0, 1]) {
            tabButtons[index].focus();
            tabButtons[index].querySelector("span").dispatchEvent(new PointerEvent("click", {bubbles: true, pointerType}));
            check.equal(document.activeElement, tabButtons[index], "switching databases preserves keyboard focus");
            check.equal(tabChanges.takeRecords().length, 0, "switching databases keeps hovered tab nodes connected");
            tabButtons.forEach((button, buttonIndex) => {
                check.equal(button.classList.contains("item--focus"), buttonIndex === index);
                check.equal(tabBody.querySelector(`[data-av-id="${button.dataset.id}"]`).classList.contains("fn__none"),
                    buttonIndex !== index);
            });
        }
    }
    tabChanges.disconnect();
    tabPanel.element.remove();
    config.editor.databaseAttrUseTabs = false;
    const transactions: unknown[][] = [];
    const escape = (value: string) => value || "";
    let mobile = false;
    let submenuShown = 0;
    let mobileChoices: IMenu[] = [];
    Object.assign(window.siyuan, {menus: {menu: {remove() {}, showSubMenu() { submenuShown++; }}}});
    const Item = new Function("updateMenuItemGroupClasses", "updateHotkeyTip", menuSource + "\nreturn MenuItem;")(() => {}, (tip: string) => tip);
    class MobileMenu {
        public addItem(item: IMenu) { mobileChoices.push(item); }
        public open() {}
    }
    const bindCalendar = new Function("MenuItem", "Menu", "isMobile", "setDateFieldFormat",
        calendarSource + "\nreturn bindDateCalendarMenu;")(Item, MobileMenu, () => mobile,
        (_protyle: IProtyle, avID: string, id: string, type: string, format: string, oldFormat: string) => {
            transactions.push([[{action: "setAttrViewColDateFormat", avID, id, type, format}],
                [{action: "setAttrViewColDateFormat", avID, id, type, format: oldFormat}]]);
        });
    const columns = new Function("getFieldsByData", "escapeAttr", "escapeHtml", "escapeAriaLabel", "bindRollupData", "transaction", "MenuItem", "Menu", "isMobile", "bindDateCalendarMenu", "getLabelByDateFormat",
        columnSource + "\nreturn {getEditHTML, bindEditEvent};")(
        (data: IAV) => (data.view as IAVTable).columns, escape, escape, escape, () => {},
        (_protyle: IProtyle, operations: IOperation[], undo: IOperation[]) => transactions.push([operations, undo]),
        Item, MobileMenu, () => mobile, bindCalendar, (format: string) => format);
    for (const visibility of [undefined, "always", "hide-empty", "hide"]) {
        const field = {id: "key", name: "Notes", type: "text", attributePanelVisibility: visibility};
        const data = {id: "database", viewType: "table", view: {columns: [field]}};
        const menuElement = document.createElement("div");
        const options = {data, colId: field.id, isCustomAttr: true, menuElement};
        document.body.append(menuElement);
        let previous = visibility || "";
        for (const next of [previous, "hide", "hide-empty", "always", ""]) {
            menuElement.innerHTML = columns.getEditHTML(options);
            columns.bindEditEvent(options);
            const parent = menuElement.querySelector<HTMLButtonElement>('[data-type="attributePanelVisibility"]');
            const buttons = Array.from(parent.querySelectorAll<HTMLButtonElement>(".b3-menu__submenu .b3-menu__item"));
            check.equal(parent.querySelector("select"), null);
            check.equal(Array.from(parent.querySelectorAll("use")).some(use => use.getAttribute("xlink:href") === "#iconRight"), true);
            check.deepEqual(buttons.map(button => button.querySelector(".b3-menu__label").textContent),
                ["Default", "Always show", "Hide when empty", "Always hide"]);
            const values = ["", "always", "hide-empty", "hide"];
            check.equal(buttons.findIndex(button => !!button.querySelector(".b3-menu__checked")), values.indexOf(previous));
            const shown = submenuShown;
            parent.dispatchEvent(new MouseEvent("mouseenter"));
            check.equal(submenuShown, shown + 1);
            check.equal(parent.classList.contains("b3-menu__item--show"), true);
            menuElement.querySelector(".b3-menu__items").dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
            check.equal(parent.classList.contains("b3-menu__item--show"), true, "crossing the menu padding keeps the submenu open");
            parent.querySelector(".b3-menu__submenu").dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
            check.equal(parent.classList.contains("b3-menu__item--show"), true, "entering the submenu background keeps it open");
            buttons[0].dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
            check.equal(parent.classList.contains("b3-menu__item--show"), true, "entering a submenu option keeps it open");
            parent.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true}));
            check.equal(document.activeElement, buttons[0]);
            buttons[0].dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowLeft", bubbles: true}));
            check.equal(parent.classList.contains("b3-menu__item--show"), false);
            check.equal(document.activeElement, parent);
            parent.dispatchEvent(new MouseEvent("mouseenter"));
            menuElement.querySelector('[data-type="name"]').dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
            check.equal(parent.classList.contains("b3-menu__item--show"), false, "hovering another item closes the submenu");
            const count = transactions.length;
            buttons[values.indexOf(next)].click();
            if (next === previous) {
                check.equal(transactions.length, count);
            } else {
                check.deepEqual(transactions.at(-1), [[{
                    action: "setAttrViewColAttributePanelVisibility", id: "key", avID: "database", data: next,
                }], [{
                    action: "setAttrViewColAttributePanelVisibility", id: "key", avID: "database", data: previous,
                }]]);
                check.equal(field.attributePanelVisibility, next);
                previous = next;
            }
        }
        mobile = true;
        mobileChoices = [];
        menuElement.innerHTML = columns.getEditHTML(options);
        columns.bindEditEvent(options);
        const mobileParent = menuElement.querySelector<HTMLButtonElement>('[data-type="attributePanelVisibility"]');
        const shown = submenuShown;
        mobileParent.dispatchEvent(new MouseEvent("mouseenter"));
        check.equal(submenuShown, shown, "mobile opens choices by tap rather than hover");
        mobileParent.click();
        check.equal(mobileChoices.length, 4);
        check.equal(mobileChoices[0].checked, true);
        mobileChoices[2].click(mobileParent, new MouseEvent("click"));
        check.equal(field.attributePanelVisibility, "hide-empty");
        mobile = false;
        menuElement.innerHTML = columns.getEditHTML({...options, isCustomAttr: false});
        check.equal(menuElement.querySelector('[data-type="attributePanelVisibility"]'), null);
        menuElement.remove();
    }
    for (const mobileMode of [false, true]) {
        mobile = mobileMode;
        for (const previous of ["day-month-year", "lunar"]) {
            const field = {id: "birthday", name: "Birthday", type: "date", dateFormat: previous};
            const data = {id: "database", viewType: "table", view: {columns: [field]}};
            const menuElement = document.createElement("div");
            document.body.append(menuElement);
            const options = {data, colId: field.id, isCustomAttr: true, menuElement};
            menuElement.innerHTML = columns.getEditHTML(options);
            columns.bindEditEvent(options);
            const parent = menuElement.querySelector<HTMLButtonElement>('[data-type="dateCalendar"]');
            check.equal(parent.querySelector("select"), null);
            const buttons = Array.from(parent.querySelectorAll<HTMLButtonElement>(".b3-menu__submenu .b3-menu__item"));
            check.deepEqual(buttons.map(button => button.querySelector(".b3-menu__label").textContent), ["Gregorian", "Chinese lunar"]);
            check.equal(buttons.findIndex(button => !!button.querySelector(".b3-menu__checked")), previous === "lunar" ? 1 : 0);
            check.equal(menuElement.querySelector('[data-type="dateFormat"]').classList.contains("fn__none"), previous === "lunar");
            const shown = submenuShown;
            parent.dispatchEvent(new MouseEvent("mouseenter"));
            if (mobile) {
                check.equal(submenuShown, shown);
                mobileChoices = [];
                parent.click();
                check.equal(mobileChoices.length, 2);
                mobileChoices[previous === "lunar" ? 0 : 1].click(parent, new MouseEvent("click"));
            } else {
                check.equal(submenuShown, shown + 1);
                parent.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true}));
                check.equal(document.activeElement, buttons[0]);
                buttons[previous === "lunar" ? 0 : 1].click();
            }
            check.deepEqual(transactions.at(-1), [[{
                action: "setAttrViewColDateFormat", avID: "database", id: "birthday", type: "date",
                format: previous === "lunar" ? "full" : "lunar",
            }], [{action: "setAttrViewColDateFormat", avID: "database", id: "birthday", type: "date", format: previous}]]);
            menuElement.remove();
        }
    }
    mobile = false;
    const tables = ["database-a", "database-b"].map(avID => ({
        avID, avName: avID, blockIDs: ["document"],
        keyValues: [
            ["default", "", ""], ["always", "always", ""], ["empty", "hide-empty", ""],
            ["hidden", "hide", "value"], ["filled", "hide-empty", "value"],
        ].map(([id, visibility, content]) => ({
            key: {id, name: id, type: "text", attributePanelVisibility: visibility},
            values: [{type: "text", text: {content}, blockID: "item"}],
        })),
    }));
    const openedLinks: string[] = [];
    const splitOpens: IOpenFileOptions[] = [];
    let foldedTarget = false;
    const renderAttributes = new Function("fetchPost", "createEmptyAVValue", "getColIconByType", "cellValueIsEmpty",
        "genAVAttributeRowHTML", "preserveAVBindingRange", "renderAVRichTextElements", "getAVTemplateInteractiveElement",
        "hasClosestByClassName", "hasClosestByAttribute", "hasClosestBlock", "openLink", "checkFold", "openFileById", "Constants",
        blockSource + "\nreturn renderAVAttribute;")(
        (url: string, _data: unknown, callback: (response: {data: unknown}) => void) => {
            callback({data: url === "/api/av/getAttributeViewKeys" ? tables : {total: 0}});
        }, () => ({}), () => "iconText", (value: IAVCellValue) => !value.text.content,
        (options: {keyID: string, attributePanelVisibility: string, empty: boolean}) =>
            `<div class="av__row" data-col-id="${options.keyID}" data-panel-visibility="${options.attributePanelVisibility}" data-empty="${options.empty}"></div>`,
        () => () => {}, () => {}, (): HTMLElement | null => null,
        (element: HTMLElement, className: string) => element?.closest("." + className),
        (element: HTMLElement, attribute: string, value: string) => element?.closest(
            value ? `[${attribute}="${value}"]` : `[${attribute}]`),
        (element: HTMLElement) => element?.closest('[data-type="NodeAttributeView"]'),
        (_app: unknown, link: string) => openedLinks.push(link),
        (_id: string, callback: (zoomIn: boolean, action: string[], isRoot: boolean) => void) =>
            callback(foldedTarget, foldedTarget ? ["all"] : ["context", "scroll"], false),
        (options: IOpenFileOptions) => splitOpens.push(options), {CB_GET_HL: "highlight"});
    for (const className of ["custom-attr protyle-db-row__body", "custom-attr"]) {
        const body = document.createElement("div");
        body.className = className;
        document.body.append(body);
        const protyle = {disabled: false};
        renderAttributes(body, "document", protyle);
        const visible = (id: string, avID = "database-a") => getComputedStyle(body.querySelector(
            `[data-av-id="${avID}"] .av__row[data-col-id="${id}"]`)).display !== "none";
        check.equal(visible("default"), true, "existing dialog defaults remain visible");
        check.equal(visible("always"), true);
        check.equal(visible("empty"), false);
        check.equal(visible("hidden"), false);
        check.equal(visible("filled"), true);
        const edit = () => body.querySelector<HTMLButtonElement>('[data-av-id="database-a"] [data-type="toggle-panel-visibility"]');
        edit().querySelector("use").dispatchEvent(new MouseEvent("click", {bubbles: true}));
        check.equal(visible("hidden"), true);
        check.equal(visible("empty"), true);
        check.equal(visible("hidden", "database-b"), false, "revealing one database keeps the others hidden");
        renderAttributes(body, "document", protyle);
        check.equal(edit().getAttribute("aria-pressed"), "true");
        check.equal(visible("hidden"), true, "refresh preserves temporary reveal state");
        protyle.disabled = true;
        renderAttributes(body, "document", protyle);
        edit().click();
        check.equal(visible("hidden"), false, "readonly panels can restore visibility rules");
        edit().click();
        check.equal(visible("hidden"), true, "readonly panels can reveal hidden fields");
        const previousRules = tables[0].keyValues.map(item => item.key.attributePanelVisibility);
        tables[0].keyValues.forEach(item => item.key.attributePanelVisibility = "");
        renderAttributes(body, "document", protyle);
        check.equal(edit().classList.contains("fn__none"), true, "databases without hidden rules need no reveal button");
        check.equal(edit().getAttribute("aria-pressed"), "false");
        tables[0].keyValues.forEach((item, index) => item.key.attributePanelVisibility = previousRules[index]);
        body.remove();
    }
    const topBody = document.createElement("div");
    topBody.className = "custom-attr protyle-db-attr__body";
    renderAttributes(topBody, "document", {disabled: false});
    check.equal(topBody.querySelector('[data-type="toggle-panel-visibility"]'), null, "top panels reuse their existing edit button");
    const dialog = document.createElement("div");
    dialog.className = "b3-dialog--open";
    document.body.append(dialog);
    dialog.append(topBody);
    let dialogClosed = 0;
    dialogs.push({element: dialog, destroy: () => { dialogClosed++; }});
    tables[0].blockIDs = ["20261012120000-later01", "20261011120000-first01"];
    const blockIDs = [...tables[0].blockIDs];
    renderAttributes(topBody, "document", {disabled: true});
    const databaseTitle = topBody.querySelector<HTMLElement>('[data-av-id="database-a"] .popover__block');
    check.equal(databaseTitle.classList.contains("popover__block"), true, "database titles retain mirror previews");
    check.deepEqual(JSON.parse(databaseTitle.dataset.id), blockIDs, "hover previews retain all database carriers");
    let bubbled = false;
    dialog.addEventListener("click", () => { bubbled = true; });
    for (const pointerType of ["mouse", "touch"]) {
        const click = new PointerEvent("click", {bubbles: true, cancelable: true, pointerType});
        databaseTitle.querySelector("span").dispatchEvent(click);
        check.equal(click.defaultPrevented, true);
        check.equal(bubbled, false, "database navigation does not trigger parent click handlers");
        check.equal(openedLinks.at(-1), "siyuan://blocks/20261011120000-first01");
    }
    check.equal(dialogClosed, 2, "navigation closes the containing attribute dialog");
    check.deepEqual(tables[0].blockIDs, blockIDs, "target selection does not reorder mirror previews");
    tables[0].blockIDs = [];
    renderAttributes(topBody, "document", {disabled: true});
    topBody.querySelector<HTMLElement>('[data-av-id="database-a"] .popover__block span').click();
    check.equal(openedLinks.length, 2, "databases without carriers do not open an invalid link");
    check.equal(dialogClosed, 2, "databases without carriers keep the attribute dialog open");
    const relation = document.createElement("span");
    bubbled = false;
    relation.className = "av__cell--relation";
    relation.innerHTML = '<span data-type="block-ref" data-id="related-document"><span>Related</span></span>';
    topBody.append(relation);
    const relationLabel = relation.querySelector("span span");
    for (const pointerType of ["mouse", "touch"]) {
        relationLabel.dispatchEvent(new PointerEvent("click", {bubbles: true, cancelable: true, pointerType}));
        check.equal(openedLinks.at(-1), "siyuan://blocks/related-document");
        check.equal(splitOpens.length, 0, "plain clicks and taps keep normal navigation");
    }
    for (const modifiers of [{altKey: true}, {shiftKey: true}, {altKey: true, shiftKey: true}]) {
        for (foldedTarget of [false, true]) {
            const click = new MouseEvent("click", {bubbles: true, cancelable: true, ...modifiers});
            relationLabel.dispatchEvent(click);
            check.equal(click.defaultPrevented, true);
            check.equal(bubbled, false, "relation navigation does not trigger parent handlers");
            const options = splitOpens.at(-1);
            check.equal(options.id, "related-document");
            check.equal(options.position, modifiers.shiftKey ? "bottom" : "right");
            check.equal(options.zoomIn, foldedTarget);
            check.deepEqual(options.action, foldedTarget ? ["all", "highlight"] : ["context", "scroll", "highlight"]);
            check.equal(options.scrollPosition, "start");
        }
    }
    check.equal(openedLinks.length, 4, "modified relation clicks use split navigation");
    check.equal(splitOpens.length, 6);
    dialogs.pop();
    dialog.remove();
    return "Attribute panel visibility cases passed";
};

test("attribute panel field rules preserve global defaults and reveal hidden fields for editing", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const source = transpileModule(readFileSync(path.resolve(__dirname, "attributePanel.ts"), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const css = compileString(readFileSync("src/assets/scss/business/_custom.scss", "utf8")).css;
    const capabilitySource = transpileModule(["capabilities.generated.ts", "capabilities.ts"].map(file =>
        readFileSync(path.resolve(__dirname, file), "utf8")
            .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "")).join("\n"),
    {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const columnSource = capabilitySource + transpileModule(readFileSync(path.resolve(__dirname, "col.ts"), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const layoutSource = transpileModule(readFileSync(path.resolve(__dirname, "attributePanelLayout.ts"), "utf8")
        .replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const blockSource = capabilitySource + layoutSource + transpileModule(readFileSync(path.resolve(__dirname, "blockAttr.ts"), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const menuSource = transpileModule(readFileSync("src/menus/Menu.ts", "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const calendarSource = transpileModule(readFileSync(path.resolve(__dirname, "dateCalendarMenu.ts"), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-panel-visibility-test-"));
    const script = path.join(temporary, "run.cjs");
    const code = "const __name = value => value; (" + browserCases.toString() + ")(" + JSON.stringify(source) + "," + JSON.stringify(css) + "," + JSON.stringify(columnSource) + "," + JSON.stringify(blockSource) + "," + JSON.stringify(menuSource) + "," + JSON.stringify(calendarSource) + ")";
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    win.webContents.on("console-message", event => console.error(event.message));
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("try {" + code + "} catch (error) {console.error(error.stack); throw error;}")}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, windowsHide: true, timeout: 40000});
        assert.match(result.stdout, /Attribute panel visibility cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) && path.basename(temporary).startsWith("siyuan-panel-visibility-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
