import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import * as sass from "sass";
import {isAVDateType, isAVTextType} from "./capabilities";

const getRowsHTML = () => {
    const languages = new Proxy({}, {get: (_target, key) => String(key)});
    const escape = (value: string) => value;
    const source = ts.createSourceFile("cell.ts", readFileSync("src/protyle/render/av/cell.ts", "utf8"), ts.ScriptTarget.ES2022, true);
    const statement = source.statements.find(node => ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(declaration => declaration.name.getText(source) === "renderCell"));
    const renderCell = runInNewContext(ts.transpileModule(statement.getText(source).replace(/^export /, ""), {
        compilerOptions: {target: ts.ScriptTarget.ES2022},
    }).outputText + "\nrenderCell", {window: {siyuan: {languages}}, hasAVRenderTemplateResult: () => false,
        renderAVBlockIcon: () => '<span class="b3-menu__avemoji">📄</span>', escapeHtmlTextAndAttr: escape,
        escapeHtml: escape, escapeAttr: escape, escapeAriaLabel: escape, getAVColorStyle: () => "",
        isAVTimestampType: () => false, getAVBlockRefSubtype: () => "s",
        getAVTextSource: (value: IAVCellValue) => ({kind: "plain", content: value.text?.content}),
        renderCellURL: (content: string) => `<span class="av__celltext av__celltext--url" data-href="${content}">${content}</span>`,
        isAVTextType, isAVDateType});
    const dependencies: Record<string, unknown> = {
        "../../../util/escape": {escapeAttr: escape, escapeAriaLabel: escape},
        "./cell": {renderCell},
        "./conditionalColor": {getConditionalItemStyle: () => "", getConditionalCellStyle: () => ""},
    };
    const load = <T>(name: string) => {
        const exports = {} as T;
        runInNewContext(ts.transpileModule(readFileSync(`src/protyle/render/av/${name}.ts`, "utf8"), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
        }).outputText, {exports, require: (id: string) => dependencies[id] || {}, window: {siyuan: {languages}}});
        dependencies["./" + name] = exports;
        return exports;
    };
    load<typeof import("./subItemsState")>("subItemsState");
    const {getRowHTML} = load<typeof import("./row")>("row");
    const result = ["table", "list"].map(type => {
        const data = {columns: [{id: "title", type: "block", width: "340px", wrap: true, align: "left"}], showIcon: false} as IAVTable;
        const rows = [0, 2].map(depth => getRowHTML({type: type as TAVView, data, rowIndex: depth, row: {
            id: `${type}-${depth}`, hierarchy: {depth, expanded: false, childCount: 2, context: false},
            cells: [{id: "value", valueType: "block", value: {type: "block", isDetached: true, block: {content: "Title"}}}],
        } as IAVRow})).join("");
        const footer = "<div class=\"av__row--util\"><div class=\"av__colsticky\"><button class=\"b3-button av__button\" data-type=\"av-add-bottom\"><span>Add entry</span></button><span class=\"fn__space\"></span><span class=\"ft__on-surface av__sub-items-count\">2 roots, 5 matches</span></div></div>";
        return `<div class="av" data-av-type="${type}" data-sub-items-nested><div class="av__container"><div class="av__scroll"><div class="av__body" data-group-id="">${rows}${footer}</div></div></div></div>`;
    }).join("");
    return result + ["select", "checkbox", "number", "url", "text"].map(type => {
        const data = {columns: [{id: "hidden", type: "text", hidden: true},
            {id: "first", type, width: "280px", wrap: true}, {id: "title", type: "block", width: "280px"}], showIcon: true} as IAVTable;
        data.nested = {childPaging: Object.fromEntries([0, 2].map(depth => [`first-${type}-${depth}`,
            {page: 2, pageSize: 20, total: 60}]))} as IAVTable["nested"];
        const value = {type, mSelect: [{content: "Status"}], checkbox: {checked: false},
            number: {content: 123, isNotEmpty: true}, url: {content: "https://example.com"}, text: {content: "Wrapped text"}} as IAVCellValue;
        const rows = [0, 2].map(depth => getRowHTML({type: "table", data, pinIndex: 1, rowIndex: depth, row: {
            id: `first-${type}-${depth}`, hierarchy: {depth, childCount: 60, context: false, expanded: type === "select"},
            cells: [{valueType: "text", value: {type: "text", text: {content: "Hidden"}}},
                {valueType: type, value}, {valueType: "block", value: {type: "block", block: {content: "Title", id: "bound"}}}],
        } as IAVRow})).join("");
        return `<div class="av" data-av-type="table" data-sub-items-nested data-first-type="${type}"><div class="av__scroll"><div class="av__body" style="width:560px">${rows}</div></div></div>`;
    }).join("");
};

const checkLayout = (mobile: boolean, clickCode: string) => {
    const check = require("node:assert/strict");
    const navigated: HTMLElement[] = [];
    const click = new Function("getAVTemplateInteractiveElement", "isOnlyMeta", "hasClosestByClassName",
        "hasClosestBlock", "navigateSubItems", "isCardCoverPositioning", clickCode + "\nreturn avClick;")(
        (): null => null, () => false, (element: HTMLElement, name: string) => element.closest("." + name),
        (element: HTMLElement) => element.closest(".av"), (element: HTMLElement) => { navigated.push(element); return true; },
        () => false);
    for (const type of ["table", "list"]) {
        for (const fontSize of [16, 24]) {
            document.body.style.fontSize = fontSize + "px";
            const block = document.querySelector<HTMLElement>(`.av[data-av-type="${type}"]`);
            const button = block.querySelector<HTMLElement>('[data-type="av-add-bottom"]');
            const count = block.querySelector<HTMLElement>(".av__sub-items-count");
            check.equal(getComputedStyle(count).fontSize, getComputedStyle(button).fontSize);
            if (type === "table") {
                const label = button.querySelector("span").getBoundingClientRect();
                const range = document.createRange();
                range.selectNodeContents(count);
                const text = range.getBoundingClientRect();
                check.ok(Math.abs((text.top + text.bottom - label.top - label.bottom) / 2) <= 1,
                    `count and add-entry text must be vertically centered at ${fontSize}px`);
            }
        }
        document.body.style.fontSize = "16px";
        const row = document.querySelector<HTMLElement>(`[data-id="${type}-2"]`);
        const root = document.querySelector<HTMLElement>(`[data-id="${type}-0"]`);
        const cell = row.querySelector<HTMLElement>('.av__cell[data-dtype="block"]');
        const controls = cell.querySelector<HTMLElement>(".av__sub-items");
        const primary = cell.querySelector<HTMLElement>(".av__cellprimary");
        const title = cell.querySelector<HTMLElement>(".av__celltext");
        const actions = cell.querySelector<HTMLElement>(".av__row-actions");
        check.equal(cell.dataset.subItemsCell, "true");
        check.ok(controls.getBoundingClientRect().right <= primary.getBoundingClientRect().left + 1);
        check.ok(primary.getBoundingClientRect().top < controls.getBoundingClientRect().bottom,
            JSON.stringify({type, controls: controls.getBoundingClientRect(), primary: primary.getBoundingClientRect(),
                cell: cell.getBoundingClientRect(), controlDisplay: getComputedStyle(controls).display}));
        check.equal(Math.round(title.getBoundingClientRect().left - root.querySelector(".av__celltext").getBoundingClientRect().left), 40);
        check.ok(title.getBoundingClientRect().right <= actions.getBoundingClientRect().left);
        check.ok(actions.getBoundingClientRect().right <= cell.getBoundingClientRect().right);
        check.ok(controls.getBoundingClientRect().right <= cell.querySelector(".b3-menu__avemoji").getBoundingClientRect().left + 1,
            JSON.stringify({type, cell: cell.getBoundingClientRect(), controls: controls.getBoundingClientRect(),
                icon: cell.querySelector(".b3-menu__avemoji").getBoundingClientRect()}));
        check.equal(getComputedStyle(actions).pointerEvents, mobile ? "auto" : "none");
        row.classList.add("dragover__bottom--child");
        const indicator = getComputedStyle(row, "::after");
        check.equal(indicator.borderTopWidth, "2px");
        check.equal(indicator.pointerEvents, "none");
        check.notEqual(indicator.backgroundColor, "rgba(0, 0, 0, 0)");
        if (mobile && type === "table") {
            const rootCell = root.querySelector<HTMLElement>('.av__cell[data-dtype="block"]');
            const visibleActions = (element: HTMLElement) => Array.from(element.querySelectorAll<HTMLElement>(".av__row-action"))
                .filter(button => button.getClientRects().length > 0);
            rootCell.style.width = "180px";
            cell.style.width = "180px";
            check.equal(visibleActions(rootCell).length, 2);
            check.equal(visibleActions(cell).length, 1);
            check.equal(visibleActions(cell)[0].dataset.type, "av-row-more");
            cell.style.width = "25px";
            check.equal(visibleActions(cell).length, 0);
            cell.style.width = "340px";
            check.equal(visibleActions(cell).length, 2);
        }
    }
    for (const block of document.querySelectorAll<HTMLElement>("[data-first-type]")) {
        document.body.style.fontSize = "24px";
        for (const row of block.querySelectorAll<HTMLElement>(".av__row")) {
            const cell = row.querySelector<HTMLElement>("[data-sub-items-cell]");
            const controls = cell.querySelector<HTMLElement>(".av__sub-items");
            const content = cell.querySelector<HTMLElement>(".b3-chip, .fn__flex, .av__celltext");
            check.equal(cell.dataset.colId, "first");
            check.ok(controls.closest(".av__colsticky--freeze"));
            check.equal(row.querySelector('[data-dtype="block"] .av__sub-items'), null);
            check.ok(controls.getBoundingClientRect().right <= content.getBoundingClientRect().left + 1,
                `${block.dataset.firstType} controls overlap content`);
            check.equal(getComputedStyle(controls.querySelector("button")).position, "static");
            const button = controls.querySelector("button");
            const event = new MouseEvent("click", {bubbles: true, cancelable: true});
            let clickError: Error;
            button.addEventListener("click", event => { try { click({}, event); } catch (error) { clickError = error; } });
            const checked = cell.querySelector(".av__checkbox use")?.getAttribute("xlink:href");
            button.querySelector("svg").dispatchEvent(event);
            if (clickError) throw clickError;
            check.equal(navigated.at(-1), button);
            check.equal(event.defaultPrevented, true);
            check.equal(cell.querySelector(".av__checkbox use")?.getAttribute("xlink:href"), checked);
        }
        const root = block.querySelector('[data-index="0"] [data-sub-items-cell]');
        const child = block.querySelector<HTMLElement>('[data-index="2"] [data-sub-items-cell]');
        check.equal(parseFloat(getComputedStyle(child.querySelector(".av__cellcontent")).marginLeft) -
            parseFloat(getComputedStyle(root.querySelector(".av__cellcontent")).marginLeft), 40);
        block.querySelector<HTMLElement>(".av__scroll").scrollLeft = 100;
        const controls = child.querySelector(".av__sub-items");
        check.ok(controls.getBoundingClientRect().left >= block.getBoundingClientRect().left);
        child.style.width = "25px";
        check.equal(child.getBoundingClientRect().width, 25, "tree indentation must not enlarge a narrow column");
    }
    return "sub-items-layout-ok";
};

const testLayout = (stylesheet: string) => test(`${stylesheet} table/list tree titles retain controls, indentation and drop feedback while counts match footer buttons`, {timeout: 30000}, async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-sub-items-layout-"));
    const css = sass.compile(`src/assets/scss/${stylesheet}.scss`, {style: "compressed", silenceDeprecations: ["legacy-js-api"]}).css;
    const html = `<style>:root{--b3-theme-primary:blue;--b3-theme-primary-lightest:#eef;--b3-border-color:#ccc}body{width:390px}.av{width:390px}</style><style>${css}</style><div class="protyle-wysiwyg">${getRowsHTML()}</div>`;
    const actionSource = ts.createSourceFile("action.ts", readFileSync("src/protyle/render/av/action.ts", "utf8"), ts.ScriptTarget.ES2022, true);
    const clickStatement = actionSource.statements.find(node => ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(declaration => declaration.name.getText(actionSource) === "avClick"));
    const clickCode = ts.transpileModule(clickStatement.getText(actionSource).replace(/^export /, ""), {
        compilerOptions: {target: ts.ScriptTarget.ES2022},
    }).outputText;
    const execute = ts.transpileModule(`const __name = (value) => value; document.write(${JSON.stringify(html)}); try { (${checkLayout.toString()})(${stylesheet === "mobile"}, ${JSON.stringify(clickCode)}) } catch (error) { String(error.stack) }`, {
        compilerOptions: {target: ts.ScriptTarget.ES2022},
    }).outputText;
    const script = path.join(directory, "main.cjs");
    writeFileSync(script, `const {app,BrowserWindow}=require("electron");app.whenReady().then(async()=>{
const win=new BrowserWindow({show:false,width:420,height:900,webPreferences:{nodeIntegration:true,contextIsolation:false,offscreen:true}});
try{await win.loadURL("about:blank");console.log(await win.webContents.executeJavaScript(${JSON.stringify(execute)}));app.exit(0)}catch(error){console.error(error);app.exit(1)}});`);
    try {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const result = await promisify(execFile)(require("electron") as unknown as string, [script, "--no-sandbox"], {env, timeout: 25000});
        assert.match(result.stdout, /sub-items-layout-ok/);
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});

["base", "mobile"].forEach(testLayout);
