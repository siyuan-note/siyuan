import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import * as ts from "typescript";

const declarations = (file: string, names: string[]) => {
    const source = ts.createSourceFile(file, readFileSync(path.join(__dirname, file), "utf8"), ts.ScriptTarget.ES2022, true);
    return names.map(name => source.statements.find(node => ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(declaration => declaration.name.getText(source) === name))
        .getText(source).replace(/^export /, "")).join("\n");
};

test("checkbox values toggle independently of parent, leaf and paging icons in table/list cells", {timeout: 30000}, async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-checkbox-hierarchy-"));
    const code = ts.transpileModule(`
const assert = require("node:assert/strict");
const windowLanguages = {expand: "Expand", collapse: "Collapse", previous: "Previous", next: "Next"};
window.siyuan = {languages: windowLanguages};
const isAVTextType = () => false;
const isAVDateType = () => false;
const isTableLikeView = type => type === "table" || type === "list";
const hasClosestByClassName = (element, name) => element.closest("." + name);
const focusBlock = () => {};
const addDragFill = () => {};
const writes = [];
const updateCellsValue = (_protyle, _block, value, elements) => {
    writes.push(value.checked);
    elements[0].querySelector(".av__checkbox use").setAttribute("xlink:href", value.checked ? "#iconCheck" : "#iconUncheck");
};
${declarations("cell.ts", ["getStoredCellValueByElement", "genCellValueByElement", "updateCellValueByInput"])}
${declarations("subItemsState.ts", ["getSubItemsPaging", "getSubItemsControlHTML"])}
(async () => {
    for (const layout of ["table", "list"]) {
        for (const kind of ["parent", "leaf", "paging", "plain"]) {
            const row = {id: "row", hierarchy: kind === "plain" ? undefined : {
                depth: 1, expanded: kind === "paging", childCount: kind === "leaf" ? 0 : 60}};
            const data = {nested: {childPaging: {row: {page: 2, pageSize: 20, total: 60}}}};
            const block = document.createElement("div");
            block.setAttribute("data-av-type", layout);
            block.setAttribute("data-av-id", "av");
            block.innerHTML = '<div class="av__row" data-id="row"><div class="av__cell" data-id="value">' +
                getSubItemsControlHTML(row, data) + '<div class="av__cellcontent"><svg class="av__checkbox"><use xlink:href="#iconUncheck"></use></svg></div></div></div>';
            document.body.append(block);
            const cell = block.querySelector(".av__cell");
            const controls = cell.querySelector(".av__sub-items")?.innerHTML;
            for (const expected of [true, false, true, false]) {
                await updateCellValueByInput({}, "checkbox", block, [cell], false);
                assert.equal(writes.at(-1), expected, layout + "/" + kind);
                assert.equal(genCellValueByElement("checkbox", cell).checkbox.checked, expected);
                assert.equal(cell.querySelector(".av__sub-items")?.innerHTML, controls);
                const reloaded = cell.cloneNode(true);
                assert.equal(genCellValueByElement("checkbox", reloaded).checkbox.checked, expected);
            }
            cell.dataset.cellValue = encodeURIComponent(JSON.stringify({type: "checkbox", checkbox: {checked: true}}));
            assert.equal(genCellValueByElement("checkbox", cell).checkbox.checked, true);
            block.remove();
        }
    }
    assert.equal(writes.length, 32);
    return "checkbox-hierarchy-ok";
})()
`, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
    const script = path.join(directory, "main.cjs");
    writeFileSync(script, `const {app,BrowserWindow}=require("electron");app.setPath("userData",${JSON.stringify(path.join(directory, "profile"))});app.whenReady().then(async()=>{
const win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,offscreen:true}});
try{await win.loadURL("about:blank");console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));app.exit(0)}catch(error){console.error(error);app.exit(1)}});`);
    try {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const args = process.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY ?
            ["--no-sandbox", "--disable-gpu", "--ozone-platform=headless", script] : [script];
        const result = await promisify(execFile)(require("electron") as unknown as string, args, {env, timeout: 25000});
        assert.match(result.stdout, /checkbox-hierarchy-ok/);
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});
