import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string) => {
    const check: typeof assert = require("node:assert/strict");
    const transactions: {doOperations: IOperation[], undoOperations: IOperation[]}[] = [];
    const identity = (html: string) => html;
    const api = new Function("Constants", "dayjs", "cleanListMindmapHTML", "cleanHeadingNumberHTML",
        "cleanBlockSelectionModeHTML", "recordTransaction", source + "\n" +
        "const transaction = (_owner, doOperations, undoOperations) => {" +
        "cleanBlockSelectionModeOperations(doOperations); cleanBlockSelectionModeOperations(undoOperations);" +
        "recordTransaction({doOperations, undoOperations});};\n" +
        "return {getAVRichTextLute, encodeTableCellRich, decodeTableCellRich, renderTableCellRich, " +
        "cleanTableCellRichHTML, getTableBlockHTML, getTableCellRichBlockDOM, serializeTableCellRich, " +
        "updateTableCellEditingValue, updateTransaction, setFontStyle, cacheTableVirtualizationRows};")({
        CUSTOM_SY_TABLE_RICH: "custom-sy-table-rich", CUSTOM_SY_CODE_TAB_SPACES: "custom-sy-code-tab-spaces",
        ATTRIBUTE_EDITING: "data-editing",
    }, () => ({format: () => "20261020120000"}), identity, identity, identity,
    (value: typeof transactions[number]) => transactions.push(value)) as
        typeof import("./tableCellRich") & typeof import("./tableCellRichValue") &
        typeof import("../render/av/richText") & typeof import("../wysiwyg/transaction") &
        typeof import("../toolbar/Font") & typeof import("./tableVirtualizationDOM");
    const lute = api.getAVRichTextLute();
    let renders = 0;
    const spin = lute.SpinBlockDOM;
    lute.SpinBlockDOM = (html: string) => {
        renders++;
        return spin(html);
    };
    const fixture = document.createElement("div");
    fixture.innerHTML = '<div data-type="NodeTable" data-node-id="20261020120000-table01" custom-sy-table-rich="1">' +
        '<div contenteditable="true"><table><thead><tr><th></th><th></th></tr></thead><tbody>' +
        Array.from({length: 13}, () => "<tr><td></td><td></td></tr>").join("") + "</tbody></table></div></div>";
    document.body.appendChild(fixture);
    const table = fixture.firstElementChild;
    const cells = Array.from(table.querySelectorAll<HTMLTableCellElement>("th, td"));
    const sources = cells.map((_cell, index) => `Cell ${index}: **bold** \\| 文本 🧪\n\nSecond paragraph ${index}`);
    sources[25] = "- first\n- second\n\n```js\nconst value = 1;\n```";
    sources[26] = "![image](assets/example.png)\n\n((20261020120000-ref0001 'reference'))";
    sources[27] = "";
    cells.forEach((cell, index) => {
        cell.setAttribute("data-sy-table-cell-rich", api.encodeTableCellRich(sources[index]));
        cell.innerHTML = '<div class="table__cell-editor">Temporary editor UI</div>';
    });
    const liveHTML = table.outerHTML;
    const oldHTML = api.getTableBlockHTML(table);
    check.equal(renders, 28);
    check.equal(table.outerHTML, liveHTML, "snapshot generation must leave the active editor intact");
    check.equal(api.cleanTableCellRichHTML(oldHTML), oldHTML);
    check.equal(api.getTableBlockHTML(table), oldHTML);
    check.equal(renders, 28, "repeated snapshots reuse each distinct source within the synchronous transaction");
    const restored = document.createElement("div");
    restored.innerHTML = oldHTML;
    check.doesNotMatch(oldHTML, /Temporary editor UI|table__cell-editor/);
    check.match(oldHTML, /<ul>|<pre><code/);
    check.match(oldHTML, /assets\/example.png/);
    Array.from(restored.querySelectorAll("th, td")).forEach((cell, index) => {
        check.equal(api.decodeTableCellRich(cell.getAttribute("data-sy-table-cell-rich")).content, sources[index]);
        check.equal(cell.getAttribute("contenteditable"), "false");
    });

    const editor = document.createElement("div");
    editor.innerHTML = api.getTableCellRichBlockDOM(cells[0]);
    const editable = editor.querySelector('[contenteditable="true"]');
    const marked = document.createElement("span");
    marked.dataset.type = "text";
    marked.textContent = "highlighted";
    api.setFontStyle(marked, {type: "backgroundColor", color: "var(--b3-font-background5)"});
    editable.appendChild(marked);
    const value = api.serializeTableCellRich(editor.innerHTML);
    api.updateTableCellEditingValue(cells[0], value);
    const owner = {wysiwyg: {element: fixture}} as IProtyle;
    api.updateTransaction(owner, table, oldHTML);
    check.equal(renders, 29, "formatting one cell only converts its changed source across do/undo cleanup");
    check.equal(transactions.length, 1);
    const saved = transactions[0];
    const redoHTML = saved.doOperations[0].data as string;
    check.equal(saved.undoOperations[0].data, oldHTML);
    restored.innerHTML = redoHTML;
    const changed = restored.querySelector("th");
    check.equal(api.decodeTableCellRich(changed.getAttribute("data-sy-table-cell-rich")).content, value.markdown);
    check.match(changed.innerHTML, /background-color: var\(--b3-font-background5\)/);
    check.equal(restored.firstElementChild.getAttribute("custom-sy-table-rich"), "1");
    for (const html of [oldHTML, redoHTML, oldHTML, redoHTML]) {
        restored.innerHTML = html;
        check.equal(api.cleanTableCellRichHTML(restored.innerHTML), html,
            "undo and redo retain the corresponding source and canonical preview");
    }
    check.equal(renders, 29);

    const cached = document.createElement("td");
    cached.setAttribute("data-sy-table-cell-rich", cells[0].getAttribute("data-sy-table-cell-rich"));
    api.renderTableCellRich(cached);
    const canonical = cached.innerHTML;
    cached.innerHTML = '<img src="assets/unrelated.png">';
    api.renderTableCellRich(cached);
    check.equal(cached.innerHTML, canonical, "DOM mutations never contaminate the cached static preview");
    check.equal(renders, 29);
    await Promise.resolve();
    api.renderTableCellRich(cached);
    check.equal(renders, 30, "source and preview cache is released at the microtask boundary");
    api.renderTableCellRich(cached);
    check.equal(renders, 30);

    for (const encoded of ["invalid!", api.encodeTableCellRich("valid").slice(0, -1),
        btoa(JSON.stringify({spec: 2, format: "kramdown", content: "future"}))]) {
        cached.setAttribute("data-sy-table-cell-rich", encoded);
        check.throws(() => api.renderTableCellRich(cached));
        check.equal(cached.innerHTML, canonical, "invalid source must not replace existing content");
    }
    cached.removeAttribute("data-sy-table-cell-rich");
    cached.setAttribute("data-sy-table-cell-inline", '<span data-type="strong">inline</span>');
    api.renderTableCellRich(cached);
    check.equal(cached.innerHTML, '<span data-type="strong">inline</span>');
    check.equal(cached.hasAttribute("data-sy-table-cell-inline"), false);

    const body = table.querySelector("tbody");
    const hiddenRows = Array.from(body.querySelectorAll("tr")).slice(1);
    const placeholder = document.createElement("tr");
    hiddenRows[0].before(placeholder);
    api.cacheTableVirtualizationRows(placeholder, hiddenRows);
    hiddenRows.forEach(row => row.remove());
    table.querySelector("table").setAttribute("data-sy-table-virtual-id", "virtual");
    const virtualHTML = table.outerHTML;
    const snapshot = api.cleanTableCellRichHTML(api.getTableBlockHTML(table));
    check.equal(table.outerHTML, virtualHTML, "virtualized snapshots must not mount or alter offscreen rows");
    restored.innerHTML = snapshot;
    check.equal(restored.querySelectorAll("th, td").length, 28);
    check.doesNotMatch(snapshot, /data-sy-table-virtual|Temporary editor UI|table__cell-editor/);
    check.equal(api.cleanTableCellRichHTML(snapshot), snapshot);
    check.equal(api.decodeTableCellRich(restored.querySelector("th").getAttribute("data-sy-table-cell-rich")).content,
        value.markdown);
    fixture.remove();
    return "Table cell rich snapshot cases passed";
};

test("rich table snapshots reuse conversions while preserving formatting, replay, and virtual rows", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const read = (file: string) => readFileSync(path.join(__dirname, file), "utf8");
    const compile = (source: string) => transpileModule(source.replace(/^import [\s\S]*?;\r?\n/gm, "")
        .replace(/^export (?:type )?\{[\s\S]*?\}(?: from "[^"]+")?;\r?\n/gm, "")
        .replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const extract = (file: string, names: string[]) => {
        const parsed = createSourceFile(file, read(file), ScriptTarget.Latest, true);
        return parsed.statements.filter(isVariableStatement).filter(statement =>
            statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(parsed))))
            .map(statement => statement.getText(parsed)).join("\n");
    };
    const source = ["longTextWrap.ts", "inlineElementBoundary.ts", "../toolbar/fontFamilyCore.ts", "../../util/escape.ts",
        "tableVirtualizationDOM.ts", "../render/setLute.ts", "../wysiwyg/codeBlockUtil.ts", "../render/av/richTextValue.ts",
        "../render/av/richText.ts", "tableCellRichValue.ts", "tableCellRich.ts"]
        .map(file => compile(read(file))).join("\n") +
        "\nconst getTextWithoutSemanticMarkers = (() => {" + compile(read("inlineElementMarker.ts")) +
        "\nreturn getTextWithoutSemanticMarkers;})();\n" +
        compile(extract("../wysiwyg/transaction.ts", ["updateTransaction", "cleanBlockSelectionModeOperations"])) +
        "\n" + compile(extract("../toolbar/Font.ts", ["setFontStyle"]));
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-table-cell-rich-test-"));
    const script = path.join(temporary, "run.cjs");
    const lutePath = path.resolve(__dirname, "../../../stage/protyle/js/lute/lute.min.js");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(lutePath)}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" +
        browserCases.toString() + ")(" + JSON.stringify(source) + ")")}));
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Table cell rich snapshot cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-table-cell-rich-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
