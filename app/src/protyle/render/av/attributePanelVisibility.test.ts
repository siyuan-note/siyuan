import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";
import {compileString} from "sass";

const browserCases = (source: string, css: string, columnSource: string, blockSource: string, menuSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    const config = {editor: {databaseAttrShow: true, databaseAttrHideEmpty: false, databaseAttrViewMode: 0, databaseAttrUseTabs: false}};
    Object.assign(window, {siyuan: {config, languages: {
        database: "Database", edit: "Edit", displayEmptyFields: "Show", hideEmptyFields: "Hide",
        default: "Default", attributePanelVisibility: "Database panel field visibility",
        alwaysShow: "Always show", hideWhenEmpty: "Hide when empty", alwaysHide: "Always hide",
    }}});
    const Panel = new Function("cancelHeightAnimation", source + "\nreturn AVAttributePanel;")(() => {});
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
    const transactions: unknown[][] = [];
    const escape = (value: string) => value || "";
    let mobile = false;
    let submenuShown = 0;
    let mobileChoices: IMenu[] = [];
    Object.assign(window.siyuan, {menus: {menu: {remove() {}, showSubMenu() { submenuShown++; }}}});
    const Item = new Function("updateMenuItemGroupClasses", menuSource + "\nreturn MenuItem;")(() => {});
    class MobileMenu {
        public addItem(item: IMenu) { mobileChoices.push(item); }
        public open() {}
    }
    const columns = new Function("getFieldsByData", "escapeAttr", "escapeHtml", "escapeAriaLabel", "bindRollupData", "transaction", "MenuItem", "Menu", "isMobile",
        columnSource + "\nreturn {getEditHTML, bindEditEvent};")(
        (data: IAV) => (data.view as IAVTable).columns, escape, escape, escape, () => {},
        (_protyle: IProtyle, operations: IOperation[], undo: IOperation[]) => transactions.push([operations, undo]),
        Item, MobileMenu, () => mobile);
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
    const renderAttributes = new Function("fetchPost", "createEmptyAVValue", "getColIconByType", "cellValueIsEmpty",
        "genAVAttributeRowHTML", "preserveAVBindingRange", "renderAVRichTextElements", blockSource + "\nreturn renderAVAttribute;")(
        (url: string, _data: unknown, callback: (response: {data: unknown}) => void) => {
            callback({data: url === "/api/av/getAttributeViewKeys" ? tables : {total: 0}});
        }, () => ({}), () => "iconText", (value: IAVCellValue) => !value.text.content,
        (options: {keyID: string, attributePanelVisibility: string, empty: boolean}) =>
            `<div class="av__row" data-col-id="${options.keyID}" data-panel-visibility="${options.attributePanelVisibility}" data-empty="${options.empty}"></div>`,
        () => () => {}, () => {});
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
    const columnSource = transpileModule(readFileSync(path.resolve(__dirname, "col.ts"), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const blockSource = transpileModule(readFileSync(path.resolve(__dirname, "blockAttr.ts"), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const menuSource = transpileModule(readFileSync("src/menus/Menu.ts", "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-panel-visibility-test-"));
    const script = path.join(temporary, "run.cjs");
    const code = "const __name = value => value; (" + browserCases.toString() + ")(" + JSON.stringify(source) + "," + JSON.stringify(css) + "," + JSON.stringify(columnSource) + "," + JSON.stringify(blockSource) + "," + JSON.stringify(menuSource) + ")";
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
