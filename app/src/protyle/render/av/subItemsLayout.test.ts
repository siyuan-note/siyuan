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
        renderAVBlockIcon: () => "", escapeHtmlTextAndAttr: escape, isAVTextType, isAVDateType});
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
    return ["table", "list"].map(type => {
        const data = {columns: [{id: "title", type: "block", width: "340px", wrap: true, align: "left"}], showIcon: false} as IAVTable;
        const rows = [0, 2].map(depth => getRowHTML({type: type as TAVView, data, rowIndex: depth, row: {
            id: `${type}-${depth}`, hierarchy: {depth, expanded: false, childCount: 2, context: false},
            cells: [{id: "value", valueType: "block", value: {type: "block", isDetached: true, block: {content: "Title"}}}],
        } as IAVRow})).join("");
        return `<div class="av" data-av-type="${type}" data-sub-items-nested><div class="av__container"><div class="av__scroll"><div class="av__body" data-group-id="">${rows}</div></div></div></div>`;
    }).join("");
};

const checkLayout = () => {
    const check = require("node:assert/strict");
    for (const type of ["table", "list"]) {
        const row = document.querySelector<HTMLElement>(`[data-id="${type}-2"]`);
        const root = document.querySelector<HTMLElement>(`[data-id="${type}-0"]`);
        const cell = row.querySelector<HTMLElement>('.av__cell[data-dtype="block"]');
        const controls = cell.querySelector<HTMLElement>(".av__sub-items");
        const primary = cell.querySelector<HTMLElement>(".av__cellprimary");
        const title = cell.querySelector<HTMLElement>(".av__celltext");
        const actions = cell.querySelector<HTMLElement>(".av__row-actions");
        check.equal(getComputedStyle(cell).display, "flex");
        check.ok(controls.getBoundingClientRect().right <= primary.getBoundingClientRect().left + 1);
        check.ok(primary.getBoundingClientRect().top < controls.getBoundingClientRect().bottom,
            JSON.stringify({type, controls: controls.getBoundingClientRect(), primary: primary.getBoundingClientRect(),
                cell: cell.getBoundingClientRect(), controlDisplay: getComputedStyle(controls).display}));
        check.equal(Math.round(title.getBoundingClientRect().left - root.querySelector(".av__celltext").getBoundingClientRect().left), 40);
        check.ok(title.getBoundingClientRect().right <= actions.getBoundingClientRect().left);
        check.ok(actions.getBoundingClientRect().right <= cell.getBoundingClientRect().right);
        check.equal(getComputedStyle(actions).pointerEvents, "auto");
        row.classList.add("dragover__bottom--child");
        const indicator = getComputedStyle(row, "::after");
        check.equal(indicator.borderTopWidth, "2px");
        check.equal(indicator.pointerEvents, "none");
        check.notEqual(indicator.backgroundColor, "rgba(0, 0, 0, 0)");
    }
    return "sub-items-layout-ok";
};

test("mobile table/list tree titles stay beside controls, retain indentation and action space, and show child drop feedback", {timeout: 30000}, async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-sub-items-layout-"));
    const css = sass.compile("src/assets/scss/mobile.scss", {style: "compressed", silenceDeprecations: ["legacy-js-api"]}).css;
    const html = `<style>:root{--b3-theme-primary:blue;--b3-theme-primary-lightest:#eef;--b3-border-color:#ccc}body{width:390px}.av{width:390px}</style><style>${css}</style><div class="protyle-wysiwyg">${getRowsHTML()}</div>`;
    const execute = ts.transpileModule(`const __name = (value) => value; document.write(${JSON.stringify(html)}); try { (${checkLayout.toString()})() } catch (error) { String(error.stack) }`, {
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
