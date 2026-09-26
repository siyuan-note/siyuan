import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isClassDeclaration, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, queueSource: string, editorSource: string, menuSource: string, hintSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    const noop = () => {};
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const changes: {doOperations: IOperation[], undoOperations: IOperation[], undoContext?: Record<string, string>,
        context?: Record<string, string>}[] = [];
    let opening: Promise<IProtyle>;
    const focusByRange = (range: Range) => {
        getSelection().removeAllRanges();
        getSelection().addRange(range);
    };
    Object.assign(window, {siyuan: {
        config: {editor: {markdown: {}}, keymap: {editor: {table: new Proxy({}, {get: () => ({custom: ""})})}}},
        storage: {}, languages: new Proxy({}, {get: () => "${x}"}), menus: {menu: {remove: noop}},
    }});
    const dependencies = {
        Constants: {ZWSP: "\u200b", ATTRIBUTE_EDITING: "data-editing", BLOCK_HINT_KEYS: ["(("],
            INLINE_TYPE: ["strong", "code"], SIYUAN_RENDER_CODE_LANGUAGES: [] as string[], LOCAL_CODELANG: "codeLang"},
        dayjs: () => ({format: () => "20260924120000"}), isMobile: () => true,
        normalizeSemanticInlineElements: noop, removeEmptySemanticInlineElement: noop,
        getSemanticMarkerPrefixLengthForNode: () => 0, getTextWithoutSemanticMarkers: (node: Node) => node.textContent,
        turnIntoTaskList: () => false, headingTurnIntoList: () => false, isProtyleListItemFirstParagraph: () => false,
        mathRender: noop, hideElements: noop, scrollCenter: noop, focusByRange,
        stripSemanticMarkersFromRangeText: (range: Range) => range.toString(), getCaretGoalX: () => 0,
        loadTableCellEditor: async () => ({openTableCellRichEditor: (...args: Parameters<typeof activate>) => {
            opening = activate(...args);
            return opening;
        }}),
        transaction: (_owner: IProtyle, doOperations: IOperation[], undoOperations: IOperation[]) => {
            if (_owner.lite) {
                return;
            }
            changes.push({doOperations, undoOperations});
        },
        updateTransaction: (owner: IProtyle, block: Element, oldHTML: string, undoContext?: Record<string, string>,
                            additional?: {context: Record<string, string>}) => {
            if (owner.lite) {
                return;
            }
            changes.push({
                doOperations: [{action: "update", id: block.getAttribute("data-node-id"), data: api.cleanTableCellRichHTML(block.outerHTML)}],
                undoOperations: [{action: "update", id: block.getAttribute("data-node-id"), data: api.cleanTableCellRichHTML(oldHTML)}],
                undoContext, context: additional?.context,
            });
            owner.wysiwyg.lastHTMLs[block.getAttribute("data-node-id")] = api.cleanTableCellRichHTML(block.outerHTML);
        },
    };
    const api = new Function(...Object.keys(dependencies), source.replace('import("../render/tableCellRichEditor")',
        "loadTableCellEditor()") + "\nreturn {input, insertRow, insertRowAbove, insertColumn, " +
        "getAgentLute, configureAVRichTextLute, getTableCellEditorLute, getAVRichTextLute, " +
        "getTableCellRichBlockDOM, serializeTableCellRich, cleanTableCellRichHTML, renderTableCellRich, " +
        "setTableCellRich, getTableCellInlineHTML, getSelectionOffset, focusByOffset, focusByWbr, " +
        "updateTableCellEditingValue, captureRichCellSelection, restoreRichCellSelection, " +
        "captureInlineCellSelection, restoreInlineCellSelection, " +
        "hasClosestBlock, hasClosestByClassName, getContenteditableElement, hasPreviousSibling, hasNextSibling, " +
        "isTableCellBlockSlash, navigateToRichTableCell};")(...Object.values(dependencies)) as
        typeof import("../wysiwyg/input") & typeof import("../util/table") & typeof import("./setLute") &
        typeof import("./av/richText") & typeof import("./av/richTextValue") & typeof import("../util/tableCellRichLute") &
        typeof import("../util/tableCellRich") & typeof import("../util/selection") &
        typeof import("../util/tableCellRichSelection") & typeof import("../util/hasClosest") &
        typeof import("../wysiwyg/getBlock") & typeof import("../util/tableCellRichMenu") &
        typeof import("../util/tableCellRichNavigation");
    const lute = api.configureAVRichTextLute(api.getAgentLute({emojiSite: "/emojis", emojis: {},
        headingAnchor: false, listStyle: false, paragraphBeginningSpace: true, sanitize: true}));
    const Queue = new Function(queueSource + "\nreturn InputQueue;")() as new () => {
        scheduleInput: (callback: () => void | Promise<void>, delay?: number, replace?: boolean) => void,
        flushPendingInput: () => Promise<void>,
    };
    {
        const queue = new Queue();
        const calls: string[] = [];
        queue.scheduleInput(() => { calls.push("replaced"); }, 1000);
        queue.scheduleInput(async () => {
            calls.push("input");
            await tick();
            queue.scheduleInput(() => { calls.push("followup"); }, 1000);
        }, 1000);
        await queue.flushPendingInput();
        check.deepEqual(calls, ["input", "followup"]);
        await tick();
        check.deepEqual(calls, ["input", "followup"], "flushed timers must not run twice");
        queue.scheduleInput(() => { throw new Error("input failed"); });
        await check.rejects(queue.flushPendingInput(), /input failed/);
        await queue.flushPendingInput();
    }
    const fixture = () => {
        const element = document.createElement("div");
        const wysiwyg = document.createElement("div");
        wysiwyg.className = "protyle-wysiwyg";
        wysiwyg.contentEditable = "true";
        wysiwyg.innerHTML = lute.Md2BlockDOM("| **Hello** | Keep | |\n| --- | --- | --- |\n| | | |\n| | | |");
        element.appendChild(wysiwyg);
        document.body.appendChild(element);
        const table = wysiwyg.firstElementChild as HTMLElement;
        const hidden = document.createElement("div");
        hidden.className = "fn__none";
        const queue = Object.assign(new Queue(), {element: wysiwyg, lastHTMLs: {[table.dataset.nodeId]: table.outerHTML}});
        const owner = {element, wysiwyg: queue, lute, contentElement: wysiwyg, options: {typewriterMode: false},
            hint: {render: noop, element: hidden}, toolbar: {subElement: hidden},
            block: {rootID: "root"}, disabled: false} as unknown as IProtyle;
        const range = document.createRange();
        range.selectNodeContents(table.querySelector("th"));
        range.collapse(false);
        focusByRange(range);
        changes.length = 0;
        return {owner, queue, element, wysiwyg, table, range};
    };
    const hintDependencies = {
        ...dependencies, ...api, isProtyleListItemFragment: () => false, isBuiltinSlashHint: () => true,
        shouldCaptureHintUndoFocus: () => false, processRender: noop, highlightRender: noop,
    };
    const Hint = new Function(...Object.keys(hintDependencies), hintSource + "\nreturn Hint;")(
        ...Object.values(hintDependencies)) as new () => IProtyle["hint"];
    const editorDependencies = {
        ...dependencies, ...api, TABLE_CELL_INLINE_ATTRIBUTE: "data-sy-table-cell-inline",
        TABLE_CELL_RICH_ATTRIBUTE: "data-sy-table-cell-rich", TABLE_CELL_SLASH_IDS: new Set(),
        hintRef: noop, hintTag: noop, registerBuiltinSlashHint: (callback: unknown) => callback,
        getDefaultToolbar: (): string[] => [], updateOutlineCurrentBlock: noop,
        getUndoFocusContext: () => ({}),
        setMobileToolbarUndo: noop, setTableCellRichContext: noop, bindTableCellRichDrag: noop,
        bindLiteCodeActions: noop, updateTableCellContentLayout: noop, renderTableCellRichElements: noop,
        showMessage: (message: string) => { throw new Error(message); },
        mountProtyleLiteFragment: (host: HTMLElement, options: import("../lite/fragmentEditor").ProtyleLiteFragmentOptions) => {
            // 保留会被 Lute 误读为正文的界面，验证输入任务与实际挂载边界的交接。
            host.innerHTML = '<div class="protyle-content"><div class="protyle-wysiwyg">' +
                options.initialBlockHTML + '</div></div><div class="protyle-preview">DesktopTabletMobile</div>' +
                '<div class="protyle-toolbar"><svg><use href="#iconBold"></use></svg>Font family Font Size</div>' +
                "<style>.protyle-content::highlight(search-mark-regression) {color: red;}</style>";
            const wysiwyg = host.querySelector<HTMLElement>(".protyle-wysiwyg");
            const hidden = document.createElement("div");
            hidden.className = "fn__none";
            const observer = new MutationObserver(() => options.onChange());
            observer.observe(wysiwyg, {childList: true, characterData: true, subtree: true});
            return {
                wysiwyg, hintElement: hidden,
                protyle: {block: {}, element: host, wysiwyg: {element: wysiwyg}, lite: true,
                    lute: options.runtimeCapabilities.lute, options: options.protyleOptions, hint: new Hint(),
                    toolbar: {element: hidden, subElement: hidden, render: noop, showRender: noop}, undo: {clear: noop}},
                getBlockHTML: () => wysiwyg.innerHTML, destroy: () => observer.disconnect(),
                focus: () => {
                    const range = document.createRange();
                    range.selectNodeContents(wysiwyg.querySelector('[contenteditable="true"]') || wysiwyg);
                    range.collapse(true);
                    focusByRange(range);
                },
            };
        },
    };
    const activate = new Function(...Object.keys(editorDependencies), editorSource + "\nreturn openTableCellRichEditor;")(
        ...Object.values(editorDependencies)) as typeof import("./tableCellRichEditor").openTableCellRichEditor;
    const open = (owner: IProtyle, cell: HTMLTableCellElement) =>
        activate(owner, cell, undefined, undefined, undefined, true);
    const noUI = (html: string) => check.doesNotMatch(html, /DesktopTabletMobile|Font family|Font Size|search-mark-regression|table__cell-editor/);
    const operationHTML = (operation: IOperation) => {
        check.ok(typeof operation.data === "string");
        noUI(operation.data);
        return operation.data;
    };
    const finish = async (element: HTMLElement) => {
        element.remove();
        await tick();
    };

    {
        const {owner, element, table, range} = fixture();
        const cell = table.querySelector("th");
        await activate(owner, cell);
        check.equal(table.querySelector(".table__cell-editor"), null);
        check.equal(cell.textContent, "Hello");
        check.equal(changes.length, 0);
        for (const key of ["ArrowLeft", "ArrowRight"]) {
            await activate(owner, cell, {key, goalX: 0});
            const position = api.getSelectionOffset(cell, owner.wysiwyg.element, getSelection().getRangeAt(0));
            check.equal(position.start, key === "ArrowLeft" ? 5 : 0);
            check.equal(table.querySelector(".table__cell-editor"), null);
        }
        await activate(owner, cell, undefined, undefined,
            {startIndex: 0, endIndex: 0, start: 1, end: 4, backward: true});
        check.equal(getSelection().toString(), "ell");
        check.equal(getSelection().anchorOffset, 4);
        check.equal(table.querySelector(".table__cell-editor"), null, "undo restores inline selection without mounting");
        const rich = table.querySelectorAll("th")[1];
        api.setTableCellRich(rich, "first\n\nsecond");
        range.selectNodeContents(rich);
        range.collapse(true);
        focusByRange(range);
        await activate(owner, rich);
        check.ok(rich.querySelector(".table__cell-editor"));
        await activate(owner, cell, {key: "ArrowLeft", goalX: 0});
        check.equal(table.querySelector(".table__cell-editor"), null, "leaving a rich cell returns to direct inline editing");
        check.equal(api.getSelectionOffset(cell, owner.wysiwyg.element, getSelection().getRangeAt(0)).start, 5);
        const arrow = new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true});
        check.equal(api.navigateToRichTableCell(owner, arrow), true);
        check.equal(arrow.defaultPrevented, true);
        await tick();
        await opening;
        check.ok(rich.querySelector(".table__cell-editor"), "horizontal navigation does not skip a read-only rich preview");
        await activate(owner, cell, {key: "ArrowLeft", goalX: 0});
        api.focusByOffset(cell, 2, 2);
        check.equal(api.navigateToRichTableCell(owner, arrow), false, "arrows inside inline text stay native");
        api.focusByOffset(cell, 5, 5);
        check.equal(api.navigateToRichTableCell(owner, new KeyboardEvent("keydown", {key: "ArrowRight", shiftKey: true})), false);
        await finish(element);
    }

    for (const prefix of ["", "before ", "**bold** "]) {
        for (const [value, type] of [["```", "NodeCodeBlock"], ["- " + Lute.Caret, "NodeList"],
            ["# " + Lute.Caret, "NodeHeading"], ["$$", "NodeMathBlock"]]) {
            const {owner, queue, element, table, range} = fixture();
            const cell = table.querySelector("th");
            cell.textContent = prefix + "/command";
            range.selectNodeContents(cell);
            range.collapse(false);
            range.setStart(cell.firstChild, cell.textContent.length);
            focusByRange(range);
            const pendingRange = range.cloneRange();
            queue.scheduleInput(() => api.input(owner, table, pendingRange));
            const hint = new Hint();
            hint.render = noop;
            hint.splitChar = "/";
            hint.lastIndex = prefix.length;
            owner.toolbar = {range} as IProtyle["toolbar"];
            owner.hint = hint;
            window.siyuan.storage.codeLang = "";
            hint.fill(value, owner, false);
            await tick();
            check.ok(await opening, "the command opens its target cell");
            await tick();
            const current = owner.wysiwyg.element.querySelector("table");
            const editedCell = current.querySelector("th");
            check.ok(editedCell.querySelector(`.table__cell-editor [data-type="${type}"]`), value + editedCell.outerHTML);
            check.doesNotMatch(editedCell.querySelector(".protyle-wysiwyg").textContent, /\/command/);
            check.ok(editedCell.hasAttribute("data-sy-table-cell-rich"));
            check.equal(current.querySelectorAll("th")[1].textContent, "Keep");
            check.equal(current.querySelectorAll("tr").length, 3);
            check.equal(changes.length, 2, "pending input and the command each produce one outer table transaction");
            check.match(operationHTML(changes[1].undoOperations[0]), /\/command/);
            operationHTML(changes[1].doOperations[0]);
            const command = changes[1];
            current.closest('[data-type="NodeTable"]').outerHTML = operationHTML(command.undoOperations[0]);
            await tick();
            const restored = owner.wysiwyg.element.querySelector("th");
            await activate(owner, restored, undefined, undefined, JSON.parse(command.undoContext.undoFocusTableSelection));
            check.equal(getSelection().toString(), "/command", "undo selects the original command in the inline cell");
            check.equal(restored.querySelector(".table__cell-editor"), null);
            restored.closest('[data-type="NodeTable"]').outerHTML = operationHTML(command.doOperations[0]);
            await activate(owner, owner.wysiwyg.element.querySelector("th"), undefined, undefined,
                JSON.parse(command.context.undoFocusTableSelection));
            check.ok(owner.wysiwyg.element.querySelector(`.table__cell-editor [data-type="${type}"]`));
            await finish(element);
        }
    }

    for (const count of [1, 5]) {
        for (const running of [false, true]) {
            for (const text of ["", "**pending**"]) {
                const {owner, queue, element, wysiwyg, table, range} = fixture();
                api.setTableCellRich(table.querySelectorAll("th")[2], "first\n\nsecond");
                api.insertRow(owner, range, table.querySelector("th"), table, count);
                const inserted = table.querySelector("td");
                inserted.textContent = text;
                range.selectNodeContents(inserted);
                range.collapse(false);
                focusByRange(range);
                let release: () => void;
                const gate = new Promise<void>(resolve => { release = resolve; });
                queue.scheduleInput(async () => {
                    if (running) {
                        await gate;
                    }
                    await api.input(owner, table, range, true, new InputEvent("input", {inputType: "insertParagraph"}));
                });
                if (running) {
                    await tick();
                }
                const opening = open(owner, inserted);
                if (running) {
                    await tick();
                    check.equal(table.querySelector(".table__cell-editor"), null,
                        "an input callback waiting for asynchronous work still owns the outer table");
                }
                release();
                await opening;
                await tick();
                changes.forEach(change => [...change.doOperations, ...change.undoOperations].forEach(operationHTML));
                const current = wysiwyg.querySelector("table");
                check.equal(current.rows.length, count + 3);
                check.equal(current.rows[0].cells[0].textContent, "Hello");
                check.ok(current.rows[0].cells[0].querySelector('[data-type="strong"]'));
                check.ok(current.rows[0].cells[2].hasAttribute("data-sy-table-cell-rich"));
                const host = current.rows[1].cells[0].querySelector(".table__cell-editor");
                check.ok(host?.isConnected, "pending input finishes before mounting, including after table replacement");
                check.equal(host.querySelector(".protyle-wysiwyg").textContent.replace(/\u200b/g, ""), text ? "pending" : "");
                check.ok(host.contains(getSelection().anchorNode), "the caret stays in the new cell editor");
                check.equal(changes.length, 2, "insertion and pending input each reach the transaction boundary");
                const stored = document.createElement("div");
                stored.innerHTML = operationHTML(changes[1].doOperations[0]);
                check.equal(stored.querySelector("td").textContent.replace(/\u200b/g, ""), text ? "pending" : "");
                check.equal(stored.querySelectorAll("tr").length, count + 3);
                stored.innerHTML = operationHTML(changes[0].undoOperations[0]);
                check.equal(stored.querySelectorAll("tr").length, 3, "undo restores the original row count");
                stored.innerHTML = operationHTML(changes[0].doOperations[0]);
                check.equal(stored.querySelectorAll("tr").length, count + 3, "redo restores the inserted empty rows");
                check.equal(stored.querySelector("td").textContent, "");
                await finish(element);
            }
        }
    }

    {
        const {owner, queue, element, wysiwyg, table, range} = fixture();
        const embed = document.createElement("div");
        embed.className = "protyle-wysiwyg__embed";
        embed.innerHTML = table.outerHTML;
        wysiwyg.prepend(embed);
        const cell = table.querySelector("td");
        cell.textContent = "**pending**";
        range.selectNodeContents(cell);
        range.collapse(false);
        focusByRange(range);
        queue.scheduleInput(() => api.input(owner, table, range));
        await open(owner, cell);
        check.equal(table.isConnected, false, "Markdown input replaces the table DOM");
        check.equal(embed.querySelector(".table__cell-editor"), null, "an embedded copy must not receive the cell editor");
        check.ok(wysiwyg.lastElementChild.querySelector("td .table__cell-editor"));
        await finish(element);
    }

    // 同一轮异步输入期间的多次打开请求只采用最后一次目标。
    {
        const {owner, queue, element, table} = fixture();
        let release: () => void;
        queue.scheduleInput(() => new Promise<void>(resolve => { release = resolve; }));
        const cells = table.querySelectorAll("td");
        const first = open(owner, cells[0]);
        const second = open(owner, cells[1]);
        check.equal(table.querySelector(".table__cell-editor"), null);
        release();
        await Promise.all([first, second]);
        check.equal(cells[0].querySelector(".table__cell-editor"), null);
        check.ok(cells[1].querySelector(".table__cell-editor"));
        await finish(element);
    }
    for (const invalidate of ["disabled", "removed"]) {
        const {owner, queue, element, table} = fixture();
        let release: () => void;
        queue.scheduleInput(() => new Promise<void>(resolve => { release = resolve; }));
        const cell = table.querySelector("td");
        const opening = open(owner, cell);
        if (invalidate === "disabled") {
            owner.disabled = true;
        } else {
            cell.remove();
        }
        release();
        await opening;
        check.equal(table.querySelector(".table__cell-editor"), null);
        await finish(element);
    }

    for (const count of [1, 5]) {
        for (const id of ["insertRowAbove", "insertRowBelow", "insertColumnLeft", "insertColumnRight"]) {
            const {owner, element, table, range} = fixture();
            const menuDependencies = {...api, protyle: owner, range, nodeElement: table,
                cellElement: table.querySelector("th"), nextHasNone: false, nextHasRowSpan: false, nextHasColSpan: false,
                colIsPure: true, previousColIsPure: true, nextColIsPure: true};
            const menus = new Function(...Object.keys(menuDependencies), menuSource + "\nreturn insertMenus;")(
                ...Object.values(menuDependencies)) as IMenu[];
            const item = menus.find(menu => menu.id === id);
            const menu = document.createElement("div");
            menu.innerHTML = item.label;
            document.body.appendChild(menu);
            const field = menu.querySelector("input");
            field.value = count.toString();
            field.focus();
            item.bind(menu);
            let bubbled = 0;
            menu.addEventListener("keydown", () => { bubbled++; });
            let removed = 0;
            window.siyuan.menus.menu.remove = () => { removed++; menu.remove(); };
            const composition = new KeyboardEvent("keydown", {key: "Enter", isComposing: true, bubbles: true, cancelable: true});
            field.dispatchEvent(composition);
            check.equal(changes.length, 0);
            check.equal(composition.defaultPrevented, false);
            bubbled = 0;
            const enter = new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true});
            field.dispatchEvent(enter);
            check.equal(enter.defaultPrevented, true, id);
            check.equal(bubbled, 0, id);
            check.equal(removed, 1);
            check.equal(changes.length, 1, "Enter inserts exactly once");
            check.equal(table.querySelectorAll("tr").length, id.startsWith("insertRow") ? count + 3 : 3);
            check.equal(table.querySelector("tr").cells.length, id.startsWith("insertColumn") ? count + 3 : 3);
            operationHTML(changes[0].doOperations[0]);
            await finish(element);
        }
    }
    return "Table cell input handoff cases passed";
};

test("table cell editors wait for outer input and table menu Enter is consumed", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const read = (file: string) => readFileSync(path.join(__dirname, file), "utf8");
    const compile = (source: string) => transpileModule(source.replace(/^import [\s\S]*?;\r?\n/gm, "")
        .replace(/^export (?:type )?\{[\s\S]*?\}(?: from "[^"]+")?;\r?\n/gm, "")
        .replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const selection = createSourceFile("selection.ts", read("../util/selection.ts"), ScriptTarget.Latest, true);
    const selectionSource = selection.statements.filter(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(declaration =>
            ["focusByWbr", "focusByOffset", "getSelectionOffset", "selectIsEditor", "searchNode", "setLastNodeRange"]
                .includes(declaration.name.getText(selection))))
        .map(statement => statement.getText(selection)).join("\n");
    const source = ["../util/longTextWrap.ts", "../util/inlineElementBoundary.ts", "../toolbar/fontFamilyCore.ts",
        "../../util/escape.ts", "setLute.ts", "../wysiwyg/codeBlockUtil.ts", "av/richTextValue.ts", "av/richText.ts",
        "../wysiwyg/taskListMarker.ts", "../util/tableCellRichLute.ts", "../util/tableCellRichValue.ts", "../util/tableCellRich.ts",
        "../util/trackedRangeAnchor.ts", "../util/tableCellRichSelection.ts", "../util/tableCellRichMenu.ts",
        "../util/tableCellRichNavigation.ts",
        "../util/hasClosest.ts", "../wysiwyg/getBlock.ts", "../util/table.ts", "../wysiwyg/input.ts"]
        .map(file => compile(read(file))).join("\n") + "\n" + compile(selectionSource);
    const wysiwyg = createSourceFile("wysiwyg.ts", read("../wysiwyg/index.ts"), ScriptTarget.Latest, true);
    const members = wysiwyg.statements.find(isClassDeclaration).members.filter(member =>
        ["inputTimeout", "pendingInputTimeouts", "runningInputTasks", "scheduleInput", "runInput", "flushPendingInput"]
            .includes(member.name?.getText(wysiwyg)));
    const queue = compile("class InputQueue {" + members.map(member => member.getText(wysiwyg)).join("\n") + "}");
    const menu = read("../../menus/protyle.ts");
    const menuStart = menu.indexOf("const insertMenus = [];", menu.indexOf("export const tableMenu"));
    const menuSource = compile(menu.substring(menuStart, menu.indexOf("menus.push(...insertMenus);", menuStart)));
    const hint = createSourceFile("hint.ts", read("../hint/index.ts"), ScriptTarget.Latest, true);
    const hintMembers = hint.statements.find(isClassDeclaration).members.filter(member =>
        ["fill", "fixImageCursor"].includes(member.name?.getText(hint)));
    const hintSource = compile("class Hint {" + hintMembers.map(member => member.getText(hint)).join("\n") + "}")
        .replace('import("../render/tableCellRichEditor")', "loadTableCellEditor()");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-table-cell-input-test-"));
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
        browserCases.toString() + ")(" + [source, queue, compile(read("tableCellRichEditor.ts")), menuSource, hintSource]
            .map(value => JSON.stringify(value)).join(",") + ")")}));
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
        assert.match(result.stdout, /Table cell input handoff cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-table-cell-input-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
