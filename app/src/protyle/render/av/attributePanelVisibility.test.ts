import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";
import {compileString} from "sass";

const browserCases = (source: string, css: string, columnSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    const config = {editor: {databaseAttrShow: true, databaseAttrHideEmpty: false, databaseAttrViewMode: 0, databaseAttrUseTabs: false}};
    Object.assign(window, {siyuan: {config, languages: {
        database: "Database", edit: "Edit", displayEmptyFields: "Show", hideEmptyFields: "Hide",
        default: "Default", attributePanelVisibility: "Attribute panel visibility",
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
    const columns = new Function("getFieldsByData", "escapeAttr", "escapeHtml", "escapeAriaLabel", "bindRollupData", "transaction",
        columnSource + "\nreturn {getEditHTML, bindEditEvent};")(
        (data: IAV) => (data.view as IAVTable).columns, escape, escape, escape, () => {},
        (_protyle: IProtyle, operations: IOperation[], undo: IOperation[]) => transactions.push([operations, undo]));
    for (const visibility of [undefined, "always", "hide-empty", "hide"]) {
        const field = {id: "key", name: "Notes", type: "text", attributePanelVisibility: visibility};
        const data = {id: "database", viewType: "table", view: {columns: [field]}};
        const menuElement = document.createElement("div");
        const options = {data, colId: field.id, isCustomAttr: true, menuElement};
        menuElement.innerHTML = columns.getEditHTML(options);
        document.body.append(menuElement);
        columns.bindEditEvent(options);
        const select = menuElement.querySelector<HTMLSelectElement>('[data-type="attributePanelVisibility"]');
        check.deepEqual(Array.from(select.options, option => option.value), ["", "always", "hide-empty", "hide"]);
        check.equal(select.value, visibility || "");
        let previous = visibility || "";
        for (const next of ["hide", "always", ""]) {
            const count = transactions.length;
            select.value = next;
            select.dispatchEvent(new Event("change", {bubbles: true}));
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
        menuElement.innerHTML = columns.getEditHTML({...options, isCustomAttr: false});
        check.equal(menuElement.querySelector('[data-type="attributePanelVisibility"]'), null);
        menuElement.remove();
    }
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
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-panel-visibility-test-"));
    const script = path.join(temporary, "run.cjs");
    const code = "const __name = value => value; (" + browserCases.toString() + ")(" + JSON.stringify(source) + "," + JSON.stringify(css) + "," + JSON.stringify(columnSource) + ")";
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
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
