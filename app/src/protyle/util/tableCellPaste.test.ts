import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {promisify} from "node:util";


const browserCases = async (source: string, pasteSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    const noop = () => {};
    const transactions: {before: string, after: string}[] = [];
    const dependencies = {
        Constants: {ZWSP: "\u200b"}, dayjs: () => ({format: () => "20261020000000"}),
        getTextWithoutSemanticMarkers: (node: Node) => node.textContent,
        updateTransaction: (_owner: IProtyle, block: HTMLElement, before: string) => {
            transactions.push({before, after: block.outerHTML});
        },
        setLastNodeRange: (cell: Element, range: Range) => range.selectNodeContents(cell),
    };
    const api = new Function(...Object.keys(dependencies), source + "\nreturn {getAgentLute, configureAVRichTextLute, " +
        "getAVRichTextUnsupportedPasteBlocks, getTableClipboardBlockDOM, getTableRangeHTML, processTable, getTablePasteTarget, " +
        "hasClosestBlock, getTableCellRichContext, setTableCellRichContext, restoreTableVirtualizationDOM, " +
        "setTableCellRich, getTableCellRichBlockDOM, markdownMathPaste, htmlMathPaste};")(...Object.values(dependencies)) as
        typeof import("../render/setLute") & typeof import("../render/av/richText") & typeof import("./table") &
        typeof import("./hasClosest") & typeof import("./tableCellRichContext") & typeof import("./tableCellRich") &
        typeof import("./tableVirtualizationDOM") & typeof import("./mathPaste") & {
            processTable: (range: Range, html: string, protyle: IProtyle, block: HTMLElement, target: unknown) => boolean,
            getTablePasteTarget: (range: Range) => unknown,
        };
    Object.assign(window, {siyuan: {languages: {table: "Table", cellPasteUnsupported: "Unsupported: ${x}"},
        config: {editor: {markdown: {}}}}});
    const lute = api.configureAVRichTextLute(api.getAgentLute({emojiSite: "/emojis", emojis: {},
        headingAnchor: false, listStyle: false, paragraphBeginningSpace: true, sanitize: true}));
    let cellEditor: IProtyle;
    let rejected = 0;
    const focusByRange = (range: Range) => {
        getSelection().removeAllRanges();
        getSelection().addRange(range);
    };
    const mocks: Record<string, unknown> = {
        "../../constants": {Constants: dependencies.Constants},
        "../../util/pathName": {isEncryptedBox: () => false},
        "./tableCellRichContext": api, "./hasClosest": api, "./tableVirtualizationDOM": api,
        "../runtimeCapabilities": {
            getProtyleBlockDOMSanitizer: (protyle: IProtyle) => protyle === cellEditor ? (html: string) => html : undefined,
            getProtyleUnsupportedPasteBlocks: () => (html: string) => {
                if (html.includes("ordinary")) {
                    throw new Error("ordinary cell paste");
                }
                return api.getAVRichTextUnsupportedPasteBlocks(html, true);
            },
            isProtyleRichHTMLPasteEnabled: () => true, isProtyleUploadDisabled: () => true,
            areProtylePluginExtensionsEnabled: () => false,
        },
        "../upload/insertPosition": {
            createUploadInsertPosition: (range: Range) => ({range: range.cloneRange()}),
            captureUploadDocument: () => ({}),
            isUploadInsertPositionAvailable: (_editor: Element, position: {range: Range}) => position.range.startContainer.isConnected,
            getAvailableUploadInsertRange: (_editor: Element, position: {range: Range}) => position.range,
        },
        "./selection": {getEditorRange: () => getSelection().getRangeAt(0)},
        "./selectionOffsets": {focusByRange},
        "./compatibility": {isInHarmony: () => false,
            getTextSiyuanFromTextHTML: (html: string) => ({textSiyuan: "", textHtml: html})},
        "./officeMath": {extractOfficeMathHTML: () => ""},
        "./wpsPresentation": {extractWPSPresentationClipboard: (): undefined => undefined},
        "./markdownClipboard": {shouldPasteMarkdownFromHTML: () => false},
        "./processCode": {processPasteCode: () => "", processRender: noop},
        "../ui/hideElements": {hideElements: noop},
        "../render/blockRender": {blockRender: noop}, "../render/highlightRender": {highlightRender: noop},
        "../render/av/render": {avRender: noop}, "../../util/highlightById": {scrollCenter: noop},
        "./inlineElementMarker": {normalizeSemanticInlineElements: noop, stripSemanticMarkersFromRangeText: () => ""},
        "./clear": {clearBlockElement: noop}, "./tabsCopy": {wrapPastedTabItems: noop, remapTabsDOMIDs: noop},
        "../render/listMindmap/model": {remapListMindmapIDs: noop},
        "../render/embedRenderState": {resetPastedQueryEmbedRenderState: noop},
        "./pasteSource": {extractCrossBlockPasteContext: (_html: string) => ({nestedList: false, html: _html}),
            shouldPreservePastedBlockStructure: () => false, serializePastedBlockDOM: (element: Element) => element.innerHTML},
        "../../util/fetch": {fetchSyncPost: async () => ({code: 0, data: {}})},
        "../../dialog/message": {showMessage: () => { rejected++; }},
        "../../util/escape": {escapeHtml: (text: string) => text},
        "dayjs": dependencies.dayjs,
        "./insertHTML": {insertHTML: (html: string, owner: IProtyle) => {
            const range = owner.toolbar.range;
            const block = api.hasClosestBlock(range.startContainer) as HTMLElement;
            check.equal(api.processTable(range, html, owner, block, api.getTablePasteTarget(range)), true);
        }},
        "./mathPaste": {markdownMathPaste: api.markdownMathPaste, htmlMathPaste: api.htmlMathPaste},
    };
    const exports = {};
    new Function("exports", "require", pasteSource)(exports, (id: string) => mocks[id] || {});
    const pasteAPI = exports as typeof import("./paste");
    for (const mode of ["internal", "single", "native", "html", "markdown", "merged", "rich",
        "composing", "disabled", "removed", "mixed", "ordinary"]) {
        const ownerElement = document.createElement("div");
        const editor = document.createElement("div");
        editor.className = "protyle-wysiwyg";
        editor.contentEditable = "true";
        editor.innerHTML = lute.Md2BlockDOM("| H1 | H2 | H3 |\n| --- | --- | --- |\n| old | keep | tail |\n| last | end | stay |");
        ownerElement.append(editor);
        document.body.append(ownerElement);
        const table = editor.firstElementChild as HTMLElement;
        const grid = table.querySelector("table");
        const cell = grid.rows[1].cells[0];
        const original = table.outerHTML;
        const host = document.createElement("div");
        host.className = "table__cell-editor";
        host.innerHTML = '<div class="protyle-wysiwyg"><div data-node-id="cell" data-type="NodeParagraph" class="p">' +
            '<div contenteditable="true">old</div></div></div>';
        cell.replaceChildren(host);
        const owner = {element: ownerElement, wysiwyg: {element: editor}, toolbar: {getCurrentType: (): string[] => []},
            hint: {enableExtend: false}, lute, disabled: mode === "disabled"} as unknown as IProtyle;
        cellEditor = {element: host, wysiwyg: {element: host.firstElementChild}, toolbar: {}, lute} as unknown as IProtyle;
        let finishes = 0;
        api.setTableCellRichContext(cellEditor, {owner, cell, finish: () => {
            finishes++;
            if (mode !== "composing") {
                cell.innerHTML = "old";
            }
            if (mode === "removed") {
                ownerElement.remove();
            }
        }});
        const range = document.createRange();
        range.selectNodeContents(host.querySelector('[contenteditable="true"]'));
        range.collapse(false);
        focusByRange(range);
        const source = document.createElement("div");
        source.innerHTML = api.getTableClipboardBlockDOM(mode === "single" ? "<table><tr><td>a</td></tr></table>" : mode === "merged" ?
            '<table><tbody><tr><td colspan="2">a</td><td class="fn__none"></td></tr><tr><td>b</td><td>c</td></tr></tbody></table>' :
            '<table><tbody><tr><td><span data-type="strong">a</span></td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table>');
        if (mode === "rich") {
            api.setTableCellRich(source.querySelector("td"), "first\n\n- second");
        }
        const tableHTML = source.innerHTML;
        const clipboard = mode === "html" ? {textHTML: "<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>", siyuanHTML: ""} :
            mode === "markdown" ? {textHTML: "", siyuanHTML: ""} :
                {textHTML: "", siyuanHTML: mode === "mixed" ? tableHTML + lute.Md2BlockDOM("extra") :
                    mode === "ordinary" ? lute.Md2BlockDOM("ordinary") : tableHTML};
        transactions.length = 0;
        rejected = 0;
        // 普通文本应继续走内部编辑器；本用例只检查路由，不替代其插入测试。
        if (mode === "ordinary") {
            await check.rejects(pasteAPI.paste(cellEditor, {target: host.querySelector("[contenteditable]"),
                textPlain: "ordinary", ...clipboard}), /ordinary cell paste/);
            check.equal(finishes, 0);
        } else {
            const payload = {target: host.querySelector<HTMLElement>("[contenteditable]"),
                textPlain: "| a | b |\n| --- | --- |\n| c | d |", ...clipboard};
            if (mode === "native") {
                const data = new DataTransfer();
                data.setData("text/siyuan", clipboard.siyuanHTML);
                data.setData("text/plain", payload.textPlain);
                const event = new ClipboardEvent("paste", {clipboardData: data, bubbles: true, cancelable: true});
                let pending: Promise<void>;
                payload.target.addEventListener("paste", event => {
                    pending = pasteAPI.paste(cellEditor, event as ClipboardEvent & {target: HTMLElement});
                }, {once: true});
                payload.target.dispatchEvent(event);
                await pending;
                check.equal(event.defaultPrevented, true);
            } else {
                await pasteAPI.paste(cellEditor, payload);
            }
            if (mode === "mixed") {
                check.equal(rejected, 1);
                check.equal(finishes, 0);
            } else if (mode === "disabled" || mode === "removed") {
                check.equal(finishes, mode === "disabled" ? 0 : 1);
                check.equal(transactions.length, 0);
            } else if (mode === "composing") {
                check.equal(finishes, 1);
                check.ok(cell.contains(host));
                check.equal(transactions.length, 0);
            } else {
                check.equal(rejected, 0, mode);
                check.equal(finishes, 1, mode);
                check.equal(transactions.length, 1, mode);
                check.equal(grid.querySelector("table"), null, "pasting never nests a table");
                check.equal(grid.rows[1].cells[2].textContent, "tail");
                check.equal(grid.rows[2].cells[2].textContent, "stay");
                if (mode === "rich") {
                    check.equal(cell.getAttribute("data-sy-table-cell-rich"),
                        source.querySelector("td").getAttribute("data-sy-table-cell-rich"));
                } else {
                    check.equal(cell.textContent, "a");
                }
                check.equal(grid.rows[2].cells[0].textContent, mode === "single" ? "last" : mode === "merged" ? "b" : "c");
                check.equal(grid.rows[2].cells[1].textContent, mode === "single" ? "end" : mode === "merged" ? "c" : "d");
                check.equal(transactions[0].before, original, "undo starts from the committed outer table");
                check.doesNotMatch(transactions[0].after, /table__cell-editor/);
            }
        }
        ownerElement.remove();
    }
    return "table-cell-paste-ok";
};

test("table clipboard fills the outer grid while a cell editor is active", {timeout: 30000}, async () => {
    const read = (name: string) => readFileSync(path.join(__dirname, name), "utf8");
    const compile = (source: string) => transpileModule(source.replace(/^import [\s\S]*?;\r?\n/gm, "")
        .replace(/^export (?:type )?\{[\s\S]*?\}(?: from "[^"]+")?;\r?\n/gm, "")
        .replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
    const insert = createSourceFile("insertHTML.ts", read("insertHTML.ts"), ScriptTarget.Latest, true);
    const processTable = insert.statements.filter(isVariableStatement).filter(statement =>
        statement.declarationList.declarations.some(declaration =>
            ["getTablePasteTarget", "processTable"].includes(declaration.name.getText(insert))))
        .map(statement => statement.getText(insert)).join("\n");
    const source = ["longTextWrap.ts", "inlineElementBoundary.ts", "../toolbar/fontFamilyCore.ts", "../../util/escape.ts",
        "../render/setLute.ts", "../render/av/richTextValue.ts", "../render/av/richText.ts", "tableCellRichValue.ts",
        "tableCellRich.ts", "tableCellRichContext.ts", "tableVirtualizationDOM.ts", "hasClosest.ts", "table.ts", "mathPaste.ts"]
        .map(name => compile(read(name))).join("\n") + "\n" + compile(processTable);
    const pasteSource = transpileModule(read("paste.ts"), {
        compilerOptions: {target: ScriptTarget.ES2022, module: ModuleKind.CommonJS},
    }).outputText;
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-table-cell-paste-"));
    const script = path.join(directory, "main.cjs");
    const execute = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(pasteSource)})`;
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(directory, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(path.resolve("stage/protyle/js/lute/lute.min.js"))}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(execute)}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`);
    try {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 25000, windowsHide: true});
        assert.match(result.stdout, /table-cell-paste-ok/);
    } finally {
        if (path.dirname(path.resolve(directory)) === path.resolve(tmpdir()) &&
            path.basename(directory).startsWith("siyuan-table-cell-paste-")) {
            rmSync(directory, {recursive: true, force: true});
        }
    }
});
