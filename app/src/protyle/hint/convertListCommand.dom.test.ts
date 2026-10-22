import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isClassDeclaration, isImportDeclaration, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, lutePath: string) => {
    const check: typeof assert = require("node:assert/strict");
    require(lutePath);
    const lute = Lute.New();
    lute.SetProtyleWYSIWYG(true);
    lute.SetKramdownIAL(true);
    lute.SetTextMark(true);
    const editor = document.createElement("div");
    editor.className = "protyle-wysiwyg";
    document.body.append(editor);
    const operations: {doOperations: IOperation[], undoOperations: IOperation[]}[] = [];
    let removedList: Element;
    const normalize = (html: string) => {
        const holder = document.createElement("div");
        holder.innerHTML = html;
        holder.querySelectorAll("[data-node-index]").forEach(item => item.removeAttribute("data-node-index"));
        holder.querySelectorAll(".protyle-attr--av").forEach(item => item.remove());
        return holder.innerHTML;
    };
    let fragment = false;
    const focusByWbr = () => {
        const marker = editor.querySelector("wbr");
        if (marker) {
            const range = document.createRange();
            range.setStartBefore(marker);
            range.collapse(true);
            marker.remove();
            getSelection().removeAllRanges();
            getSelection().addRange(range);
        }
    };
    const dependencies = {
        Constants: {CUSTOM_SY_LIST_MINDMAP: "custom-sy-list-mindmap", BLOCK_HINT_KEYS: [] as string[], INLINE_TYPE: [] as string[], ZWSP: "\u200b"},
        isProtyleListItemFragment: () => fragment,
        getContenteditableElement: (element: Element) => element.querySelector('[contenteditable="true"]'),
        unfoldListHeadings: async () => [] as IOperation[],
        isListMindmapListConversion: () => false,
        getPreviousBlockSibling: (element: Element) => element.previousElementSibling,
        getEmbedChildOperationParentID: (): undefined => undefined,
        getParentBlock: () => editor,
        isTabsListConversion: () => false,
        convertListMindmapToList: (): undefined => undefined,
        cleanListMindmapHTML: (html: string) => html,
        disposeCustomBlocksInElement() {},
        transaction: (_protyle: IProtyle, doOperations: IOperation[], undoOperations: IOperation[]) =>
            operations.push({doOperations, undoOperations}),
        updateTransaction: (_protyle: IProtyle, element: Element, oldHTML: string, context: IOperation["context"]) => {
            operations.push({doOperations: [{action: "update", id: element.getAttribute("data-node-id"), data: element.outerHTML}],
                undoOperations: [{action: "update", id: element.getAttribute("data-node-id"), data: oldHTML, context}]});
        },
        removeListStructure: async (_protyle: IProtyle, elements: Element[], recursively: boolean, focus: Record<string, string>) => {
            check.equal(operations.length, 1);
            check.equal(recursively, false);
            check.ok(focus);
            check.equal(elements.length, 1);
            removedList = elements[0];
        },
        focusByWbr,
        getEditorRange: () => getSelection().rangeCount ? getSelection().getRangeAt(0) : document.createRange(),
        blockRender() {}, processRender() {}, highlightRender() {}, avRender() {},
        hideElements() {}, isOnlyMeta: () => false,
        shouldCaptureHintUndoFocus: () => true,
        getUndoFocusContext: () => ({undoFocusStart: "15", undoFocusEnd: "15"}),
        focusByRange: (range: Range) => {
            getSelection().removeAllRanges();
            getSelection().addRange(range);
        },
        getHostCapabilities: () => ({widgets: false, remoteKernel: true}),
        isDisabledFeature: () => true, canPickIOSPhotos: () => false,
        getSuperBlockCommand: () => "", getBuiltinStyleCSS: () => "",
        updateHotkeyTip: (key: string) => key,
    };
    const api = new Function(...Object.keys(dependencies), source +
        "return {convertListCommand, getSlashListContext, getListCommandType, getListInsertLabel, getListCommandLabel, getBuiltinSlashMenuItems, Hint};")(
        ...Object.values(dependencies)) as typeof import("./convertListCommand") & typeof import("./listCommands") &
        Pick<typeof import("./extend"), "getBuiltinSlashMenuItems"> & {Hint: new () => import("./index").Hint};
    const bindings = new Proxy({}, {get: () => ({custom: ""})});
    window.siyuan = {config: {keymap: {editor: {insert: bindings, heading: bindings}}}, languages: {list: "Unordered list", "ordered-list": "Ordered list", check: "Task list",
        convertCurrentList: "Convert current list to ${name}", cancelCurrentList: "Cancel current list",
        createList: "Create ${name}", insertChildList: "Insert sublist: ${name}"}} as any;
    const make = (subtype: string, nested = false) => {
        const marker = subtype === "u" ? "-" : subtype === "o" ? "1." : "- [x]";
        editor.innerHTML = lute.Md2BlockDOM(`${marker} first\n${marker} command\n    - child\n        1. grandchild\n${marker} last`);
        const paragraph = Array.from(editor.querySelectorAll<HTMLElement>(".p")).find(item =>
            item.firstElementChild.textContent.trim() === (nested ? "child" : "command"));
        check.ok(paragraph, editor.innerHTML);
        paragraph.firstElementChild.textContent = "before /convert after";
        paragraph.setAttribute("custom-avs", "database-id");
        const range = document.createRange();
        range.setStart(paragraph.firstElementChild.firstChild, 7);
        range.setEnd(paragraph.firstElementChild.firstChild, 15);
        const protyle = {wysiwyg: {element: editor}, toolbar: {range}, lute, options: {upload: {}}, block: {parentID: "document"}} as IProtyle;
        return {protyle, range, paragraph};
    };
    const apply = (items: IOperation[]) => {
        for (const item of items) {
            const element = editor.querySelector(`[data-node-id="${item.id}"]`);
            check.ok(item.action === "update");
            element.outerHTML = item.data;
        }
        editor.querySelectorAll("wbr").forEach(item => item.remove());
    };
    for (const subtype of ["u", "o", "t"]) {
        for (const target of ["u", "o", "t"]) {
            if (subtype === target) {
                continue;
            }
            for (const nested of [false, true]) {
                const {protyle, range, paragraph} = make(subtype, nested);
                const context = api.getSlashListContext(protyle);
                if (nested && context.subtype === target) {
                    continue;
                }
                const listID = context.listElement.dataset.nodeId;
                const paragraphID = paragraph.dataset.nodeId;
                const child = context.listElement.querySelector<HTMLElement>(".list");
                const childID = child.dataset.nodeId;
                const childHTML = child.outerHTML;
                const outerType = editor.firstElementChild.getAttribute("data-subtype");
                const originalHTML = editor.innerHTML;
                const undoContext = {undoFocusId: paragraphID, undoFocusStart: "15", undoFocusEnd: "15"};
                operations.length = 0;
                await api.convertListCommand(protyle, `convert-current-list:${target}`, range, undoContext);
                check.equal(operations.length, 1);
                check.equal(editor.querySelector(`[data-node-id="${paragraphID}"]`).textContent.replace(/\u200b/g, ""), "before  after");
                check.equal(normalize(editor.querySelector(`[data-node-id="${childID}"]`).outerHTML), normalize(childHTML));
                check.ok(operations[0].undoOperations.some(operation => operation.context === undoContext));
                const converted = editor.querySelector(`[data-node-id="${listID}"]`);
                check.equal(converted.getAttribute("data-subtype"), target);
                check.ok(Array.from(converted.children).filter(item => item.classList.contains("li"))
                    .every(item => item.getAttribute("data-subtype") === target));
                if (nested) {
                    check.equal(editor.firstElementChild.getAttribute("data-subtype"), outerType);
                }
                const convertedHTML = editor.innerHTML;
                apply(operations[0].undoOperations);
                check.equal(normalize(editor.innerHTML), normalize(originalHTML), `${subtype}/${target}/${nested}: undo`);
                apply(operations[0].doOperations);
                check.equal(normalize(editor.innerHTML), normalize(convertedHTML), `${subtype}/${target}/${nested}: redo`);
            }
        }
    }
    for (const nested of [false, true]) {
        const {protyle: current, range, paragraph} = make("u", nested);
        const list = api.getSlashListContext(current).listElement;
        const original = paragraph.outerHTML;
        operations.length = 0;
        removedList = undefined;
        await api.convertListCommand(current, "convert-current-list:remove", range);
        check.equal(removedList, list);
        check.equal(operations[0].undoOperations[0].data, original);
        const cleanup = operations[0].doOperations[0];
        check.ok(cleanup.action === "update");
        check.ok(!cleanup.data.includes("/convert"));
    }
    for (const scenario of ["same", "invalid", "disabled", "readonly", "publish", "lite", "fragment", "embed", "table", "zoom", "outside", "cross-block"]) {
        const {protyle, range, paragraph} = make("u");
        let value = "convert-current-list:o";
        if (scenario === "same") { value = "convert-current-list:u"; }
        if (scenario === "invalid") { value = "convert-current-list:bad"; }
        if (scenario === "disabled") { protyle.disabled = true; }
        if (scenario === "readonly") { window.siyuan.config.readonly = true; }
        if (scenario === "publish") { window.siyuan.isPublish = true; }
        if (scenario === "lite") { protyle.lite = true; }
        if (scenario === "fragment") { fragment = true; }
        if (scenario === "embed") { paragraph.classList.add("protyle-wysiwyg__embed"); }
        if (scenario === "table") {
            const cell = document.createElement("td");
            paragraph.before(cell);
            cell.append(paragraph);
        }
        if (scenario === "zoom") { editor.replaceChildren(paragraph.parentElement); }
        if (scenario === "outside") { document.body.append(paragraph); }
        if (scenario === "cross-block") {
            range.setEnd(editor.querySelector(".li:last-of-type .p") || editor.lastElementChild, 0);
        }
        const originalHTML = editor.innerHTML;
        operations.length = 0;
        await api.convertListCommand(protyle, value, range);
        check.equal(operations.length, 0, scenario);
        check.equal(editor.innerHTML, originalHTML, scenario);
        fragment = false;
        window.siyuan.config.readonly = false;
        window.siyuan.isPublish = false;
    }
    const {protyle} = make("u");
    check.equal(api.getListInsertLabel(protyle, "Ordered list"), "Insert sublist: Ordered list");
    check.equal(api.getListCommandLabel("o"), "Convert current list to Ordered list");
    const menu = api.getBuiltinSlashMenuItems(protyle);
    check.deepEqual(menu.filter(item => item.value.startsWith("convert-current-list:")).map(item => item.id),
        ["convertCurrentListOL", "convertCurrentListTL", "cancelCurrentList"]);
    check.ok(menu.find(item => item.id === "orderedList").html.includes("Insert sublist: Ordered list"));
    protyle.disabled = true;
    check.equal(api.getBuiltinSlashMenuItems(protyle).filter(item => item.value.startsWith("convert-current-list:")).length, 0);
    for (const mobile of [false, true]) {
        const {protyle: current, range, paragraph} = make("u");
        const hint = new api.Hint();
        Object.assign(hint, {source: "hint", splitChar: "/", lastIndex: 7});
        range.collapse(false);
        dependencies.focusByRange(range);
        operations.length = 0;
        if (mobile) {
            hint.fillCommand("convert-current-list:o", current, false);
        } else {
            hint.element = document.createElement("div");
            hint.element.innerHTML = '<button class="b3-list-item--focus" data-value="convert-current-list%3Ao">Convert</button>';
            const event = new KeyboardEvent("keydown", {key: "Enter", cancelable: true});
            hint.select(event, current);
            check.ok(event.defaultPrevented);
        }
        await new Promise(resolve => setTimeout(resolve, 0));
        check.equal(operations.length, 1);
        const changed = editor.querySelector(`[data-node-id="${paragraph.dataset.nodeId}"]`);
        check.equal(changed.firstElementChild.textContent, mobile ? "before /convert after" : "before  after");
        check.equal(changed.closest(".list").getAttribute("data-subtype"), "o");
    }
    for (const index of [0, 1, 2]) {
        for (const text of ["/", "prefix / tail"]) {
            const {protyle: current} = make("u");
            const paragraph = editor.querySelectorAll<HTMLElement>(":scope > .list > .li > .p")[index];
            paragraph.firstElementChild.textContent = text;
            const range = document.createRange();
            range.setStart(paragraph.firstElementChild.firstChild, text.indexOf("/"));
            range.setEnd(paragraph.firstElementChild.firstChild, text.indexOf("/") + 1);
            current.toolbar.range = range;
            operations.length = 0;
            await api.convertListCommand(current, "convert-current-list:t", range);
            check.equal(operations.length, 1);
            check.equal(editor.firstElementChild.getAttribute("data-subtype"), "t");
            check.equal(editor.querySelector(`[data-node-id="${paragraph.dataset.nodeId}"]`).firstElementChild.textContent,
                text.replace("/", ""));
        }
    }
    return "List command DOM cases passed";
};

test("slash list conversion preserves sibling scope, nested lists, command text and undo/redo", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const extract = (filename: string, names?: string[]) => {
        const full = path.join(__dirname, filename);
        const parsed = createSourceFile(full, readFileSync(full, "utf8"), ScriptTarget.Latest, true);
        return parsed.statements.filter(statement => !isImportDeclaration(statement) && (!names ||
            isVariableStatement(statement) && statement.declarationList.declarations.some(item => names.includes(item.name.getText(parsed)))))
            .map(statement => statement.getText(parsed).replace(/^export /, "")).join("\n");
    };
    const source = transpileModule([
        extract("../util/hasClosest.ts"), extract("../wysiwyg/listContext.ts"), extract("listCommands.ts"),
        extract("../wysiwyg/transaction.ts", ["turnsOneInto"]),
        extract("convertListCommand.ts"),
        extract("extend.ts", ["getHotkeyAccelerator", "getHotkeyOrMarker", "genSlashMenuEntryHTML", "getBuiltinSlashMenuItems"]),
        (() => {
            const parsed = createSourceFile("index.ts", readFileSync(path.join(__dirname, "index.ts"), "utf8"), ScriptTarget.Latest, true);
            const declaration = parsed.statements.find(isClassDeclaration);
            return `class Hint {${declaration.members.filter(member =>
                ["fillCommand", "fill", "select", "consumeRefBracketClose"].includes(member.name?.getText(parsed)))
                .map(member => member.getText(parsed)).join("\n")}}`;
        })(),
    ].join("\n"), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-list-command-test-"));
    const script = path.join(temporary, "run.cjs");
    const expression = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(path.resolve("stage/protyle/js/lute/lute.min.js"))})`;
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(expression)}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /List command DOM cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-list-command-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
