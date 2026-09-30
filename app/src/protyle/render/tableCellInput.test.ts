import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isClassDeclaration, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, queueSource: string, editorSource: string, menuSource: string, transactionSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    const noop = () => {};
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const changes: {doOperations: IOperation[], undoOperations: IOperation[]}[] = [];
    const focusByRange = (range: Range) => {
        getSelection().removeAllRanges();
        getSelection().addRange(range);
    };
    Object.assign(window, {siyuan: {
        config: {editor: {markdown: {}}, keymap: {editor: {table: new Proxy({}, {get: () => ({custom: ""})}),
            general: {undo: {custom: "Ctrl+Z"}, redo: {custom: "Ctrl+Y"}}}}},
        storage: {}, languages: new Proxy({}, {get: () => "${x}"}), menus: {menu: {remove: noop}},
    }});
    const dependencies = {
        Constants: {ZWSP: "\u200b", ATTRIBUTE_EDITING: "data-editing"},
        dayjs: () => ({format: () => "20260924120000"}), isMobile: () => true,
        normalizeSemanticInlineElements: noop, removeEmptySemanticInlineElement: noop,
        getSemanticMarkerPrefixLengthForNode: () => 0, getTextWithoutSemanticMarkers: (node: Node) => node.textContent,
        turnIntoTaskList: () => false, headingTurnIntoList: () => false, isProtyleListItemFirstParagraph: () => false,
        mathRender: noop, hideElements: noop, scrollCenter: noop, focusByRange,
        transaction: (_owner: IProtyle, doOperations: IOperation[], undoOperations: IOperation[]) => {
            changes.push({doOperations, undoOperations});
        },
        updateTransaction: (owner: IProtyle, block: Element, oldHTML: string) => {
            changes.push({
                doOperations: [{action: "update", id: block.getAttribute("data-node-id"), data: api.cleanTableCellRichHTML(block.outerHTML)}],
                undoOperations: [{action: "update", id: block.getAttribute("data-node-id"), data: api.cleanTableCellRichHTML(oldHTML)}],
            });
            owner.wysiwyg.lastHTMLs[block.getAttribute("data-node-id")] = api.cleanTableCellRichHTML(block.outerHTML);
        },
    };
    const api = new Function(...Object.keys(dependencies), source + "\nreturn {input, insertRow, insertRowAbove, insertColumn, " +
        "getAgentLute, configureAVRichTextLute, getTableCellEditorLute, getAVRichTextLute, " +
        "getTableCellRichBlockDOM, serializeTableCellRich, cleanTableCellRichHTML, renderTableCellRich, " +
        "setTableCellRich, getTableCellInlineHTML, getSelectionOffset, focusByOffset, getTableBlockHTML, updateTableCellEditingValue, " +
        "updateTableCellContentLayout, captureRichCellSelection, captureRichCellSelectionAtPoint, restoreRichCellSelection, setTableCellRichEventTarget, " +
        "LargeTableVirtualizer, getTableVirtualCellIndex, getTableVirtualRowIndex, restoreTableVirtualizationDOM};")(...Object.values(dependencies)) as
        typeof import("../wysiwyg/input") & typeof import("../util/table") & typeof import("./setLute") &
        typeof import("./av/richText") & typeof import("./av/richTextValue") & typeof import("../util/tableCellRichLute") &
        typeof import("../util/tableCellRich") & typeof import("../util/selection") & typeof import("../util/tableVirtualizationDOM") &
        typeof import("../wysiwyg/tableVirtualization") & typeof import("../util/tableCellRichContext") & typeof import("../util/tableCellRichSelection");
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
        const queue = Object.assign(new Queue(), {element: wysiwyg, lastHTMLs: {[table.dataset.nodeId]: table.outerHTML}});
        const owner = {element, wysiwyg: queue, lute, contentElement: wysiwyg, options: {typewriterMode: false},
            hint: {render: noop},
            block: {rootID: "root"}, disabled: false} as unknown as IProtyle;
        const range = document.createRange();
        range.selectNodeContents(table.querySelector("th"));
        range.collapse(false);
        focusByRange(range);
        changes.length = 0;
        return {owner, queue, element, wysiwyg, table, range};
    };
    const editorDependencies = {
        ...dependencies, ...api, TABLE_CELL_INLINE_ATTRIBUTE: "data-sy-table-cell-inline",
        TABLE_CELL_RICH_ATTRIBUTE: "data-sy-table-cell-rich", TABLE_CELL_SLASH_IDS: new Set(),
        hintRef: noop, hintTag: noop, registerBuiltinSlashHint: (callback: unknown) => callback,
        getDefaultToolbar: (): string[] => [], updateOutlineCurrentBlock: noop,
        setMobileToolbarUndo: noop, setTableCellRichContext: noop, bindTableCellRichDrag: noop,
        bindLiteCodeActions: noop, highlightRender: noop,
        imgMenu: (protyle: IProtyle, _range: Range, image: HTMLElement) => {
            check.equal(image.closest(".protyle-wysiwyg"), image.closest(".table__cell-editor").querySelector(".protyle-wysiwyg"));
            check.ok(protyle !== tableImageOwner, "the menu must use the cell editor's transaction context");
            image.querySelector("img").setAttribute("src", "assets/changed.png");
            image.querySelector("img").setAttribute("data-src", "assets/changed.png");
            image.dispatchEvent(new Event("input", {bubbles: true}));
            imageMenus++;
        },
        matchHotKey: () => false,
        getUndoFocusContext: (_element: Element, range: Range) => {
            const table = (range.startContainer as Element).closest('[data-type="NodeTable"]');
            return {undoFocusId: table.getAttribute("data-node-id"), undoFocusIndex: "0", undoFocusStart: "0", undoFocusEnd: "0"};
        },
        showMessage: (message: string) => { throw new Error(message); },
        mountProtyleLiteFragment: (host: HTMLElement, options: {initialBlockHTML: string, onChange: () => void}) => {
            // 保留会被 Lute 误读为正文的界面，验证输入任务与实际挂载边界的交接。
            host.innerHTML = '<div class="protyle-content"><div class="protyle-wysiwyg">' +
                options.initialBlockHTML + '</div></div><div class="protyle-preview">DesktopTabletMobile</div>' +
                '<div class="protyle-toolbar"><svg><use href="#iconBold"></use></svg>Font family Font Size</div>' +
                "<style>.protyle-content::highlight(search-mark-regression) {color: red;}</style>";
            const wysiwyg = host.querySelector<HTMLElement>(".protyle-wysiwyg");
            const hidden = document.createElement("div");
            hidden.className = "fn__none";
            api.updateTableCellContentLayout(host, options.initialBlockHTML);
            wysiwyg.addEventListener("input", () => options.onChange());
            return {
                wysiwyg, hintElement: hidden,
                protyle: {block: {}, toolbar: {element: hidden, subElement: hidden}, undo: {clear: noop}},
                getBlockHTML: () => wysiwyg.innerHTML, destroy: noop,
                focus: () => {
                    wysiwyg.querySelector<HTMLElement>('[contenteditable="true"]').focus();
                    const range = document.createRange();
                    range.selectNodeContents(wysiwyg.querySelector('[contenteditable="true"]'));
                    range.collapse(true);
                    focusByRange(range);
                },
            };
        },
    };
    let snapshotParses = 0;
    const transactionDependencies = {...dependencies, ...api,
        TABLE_VIRTUAL_ID: "data-sy-table-virtual-id",
        cleanListMindmapHTML: (html: string) => html, cleanHeadingNumberHTML: (html: string) => html,
        cleanBlockSelectionModeHTML: (html: string) => html,
        getVisibleFoldHeadingHTML: (html: string) => { snapshotParses++; return html; },
        getEmbedChildOperationContext: noop,
        isInEmbedBlock: (element: Element) => element.closest(".protyle-wysiwyg__embed"),
        captureBlockSelectionModeState: noop, restoreBlockSelectionModeState: noop,
        disposeCustomBlocksInElement: noop, processRender: noop, highlightRender: noop,
        focusRestoredBlockSelectionMode: noop, syncTrackedRanges: noop, queueTransactionBatch: noop,
    };
    delete transactionDependencies.updateTransaction;
    const transactionAPI = new Function(...Object.keys(transactionDependencies),
        transactionSource + "\nreturn {updateTransaction, promiseTransaction};")(...Object.values(transactionDependencies));
    editorDependencies.updateTransaction = transactionAPI.updateTransaction;
    const open = new Function(...Object.keys(editorDependencies), editorSource + "\nreturn openTableCellRichEditor;")(
        ...Object.values(editorDependencies)) as typeof import("./tableCellRichEditor").openTableCellRichEditor;
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

    let tableImageOwner: IProtyle;
    let imageMenus = 0;
    {
        const {owner, queue, element, table} = fixture();
        const first = table.querySelector("th");
        const next = first.nextElementSibling as HTMLTableCellElement;
        await open(owner, first);
        const oldHost = first.querySelector(".table__cell-editor");
        const focused = document.activeElement;
        check.ok(oldHost.contains(focused));
        focused.textContent = "Saved before switching";
        focused.dispatchEvent(new Event("input", {bubbles: true}));
        const flush = queue.flushPendingInput.bind(queue);
        let focusLost = false;
        queue.flushPendingInput = async () => {
            focusLost ||= document.activeElement === document.body;
            await flush();
        };
        const pointer = new PointerEvent("pointerdown", {bubbles: true, cancelable: true});
        next.dispatchEvent(pointer);
        check.equal(document.activeElement, focused, "pressing another cell retains the current input focus");
        await open(owner, next);
        check.equal(focusLost, false, "cell handoff never leaves the document without an editing focus");
        check.ok(next.contains(document.activeElement));
        check.equal(oldHost.isConnected, false);
        check.match(api.getTableCellRichBlockDOM(first), /Saved before switching/);
        changes.forEach(change => change.doOperations.forEach(operationHTML));
        const third = next.nextElementSibling as HTMLTableCellElement;
        const releases: Array<() => void> = [];
        queue.flushPendingInput = async () => {
            await new Promise<void>(resolve => { releases.push(resolve); });
            focusLost ||= document.activeElement === document.body;
        };
        const obsolete = open(owner, first);
        const latest = open(owner, third);
        releases[0]();
        await obsolete;
        check.ok(next.contains(document.activeElement), "a cancelled switch retains focus while the latest switch waits");
        releases[1]();
        await latest;
        check.equal(focusLost, false, "rapid switches keep focus until the latest cell is ready");
        check.ok(third.contains(document.activeElement));
        await finish(element);
    }
    for (const rich of [false, true]) {
        const {owner, element, table} = fixture();
        const cell = table.querySelector("th");
        if (rich) {
            api.setTableCellRich(cell, "![first](assets/first.png)\n\n![second](assets/second.png)");
            cell.querySelector(".table__cell-rich").innerHTML = api.getTableCellRichBlockDOM(cell);
        } else {
            cell.innerHTML = lute.Md2BlockDOM("![first](assets/first.png)");
            cell.innerHTML = cell.querySelector('[contenteditable="true"]').innerHTML;
        }
        const images = cell.querySelectorAll<HTMLElement>('.img[data-type="img"]');
        const image = images[images.length - 1];
        const action = image.querySelector(".protyle-action");
        check.ok(action);
        tableImageOwner = owner;
        const previous = imageMenus;
        await open(owner, cell, undefined, {x: 10, y: 20, target: action});
        check.equal(imageMenus, previous + 1, "one click opens the selected image menu");
        check.equal(cell.querySelectorAll("img")[images.length - 1].getAttribute("src"), "assets/changed.png");
        check.ok(changes.length > 0);
        const saved = document.createElement("div");
        saved.innerHTML = operationHTML(changes[changes.length - 1].doOperations[0]);
        check.match(api.getTableCellRichBlockDOM(saved.querySelector("th")), /assets\/changed\.png/);
        await finish(element);
    }

    {
        const {owner, element, wysiwyg, table} = fixture();
        await open(owner, table.querySelector("th"));
        const host = table.querySelector(".table__cell-editor");
        const operation = {action: "update", id: table.dataset.nodeId, data: api.getTableBlockHTML(table)};
        transactionAPI.promiseTransaction({protyle: owner, doOperations: [operation]});
        check.equal(snapshotParses, 0, "saving the active block without embedded copies never parses its complete HTML");
        const copy = table.cloneNode(true) as HTMLElement;
        copy.querySelector("th").textContent = "stale";
        wysiwyg.appendChild(copy);
        const embed = document.createElement("div");
        embed.className = "protyle-wysiwyg__embed";
        embed.dataset.id = table.dataset.nodeId;
        embed.innerHTML = `<div data-node-id="${table.dataset.nodeId}">stale embedded table</div>`;
        wysiwyg.appendChild(embed);
        const unrelated = document.createElement("div");
        unrelated.className = "protyle-wysiwyg__embed";
        unrelated.dataset.id = "other";
        unrelated.innerHTML = '<div data-node-id="other">Keep unrelated</div>';
        wysiwyg.appendChild(unrelated);
        transactionAPI.promiseTransaction({protyle: owner, doOperations: [operation]});
        check.equal(copy.isConnected, false, "another visible copy receives the complete snapshot");
        check.equal(embed.querySelector("th").textContent, "Hello", "embedded copies still synchronize");
        check.equal(unrelated.textContent, "Keep unrelated");
        check.equal(snapshotParses, 4, "one shared lookup snapshot serves all embedded copies");
        check.ok(host.isConnected && host.contains(getSelection().anchorNode), "local synchronization preserves the current editor");
        await finish(element);
    }

    for (const mobile of [false, true]) {
        const {owner, element, wysiwyg, table} = fixture();
        element.style.cssText = "height:240px;width:640px;overflow:auto";
        table.querySelector("tbody").innerHTML = Array.from({length: 600}, (_, row) =>
            `<tr style="height:28px"><td>Row ${row}</td><td>Value ${row}</td><td>Keep ${row}</td></tr>`).join("");
        const actualTable = table.querySelector("table");
        const target = actualTable.rows[401].cells[1];
        const lastRow = actualTable.rows[600];
        element.scrollTop = target.offsetTop - 40;
        const virtualizer = new api.LargeTableVirtualizer(element, wysiwyg, element, () => false, !mobile);
        const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 30))));
        await frame();
        const bounded = (phase = "input") => {
            check.ok(actualTable.rows.length < 180,
                `cell editing keeps offscreen rows detached (${phase}): ${actualTable.rows.length}, ${actualTable.outerHTML.slice(0, 400)}`);
            check.equal(lastRow.isConnected, false);
        };
        bounded("before opening");
        check.ok(target.isConnected);
        await open(owner, target);
        await frame();
        bounded("after opening");
        const host = target.querySelector<HTMLElement>(".table__cell-editor");
        const editable = host.querySelector<HTMLElement>('[contenteditable="true"]');
        const focus = () => {
            const range = document.createRange();
            range.selectNodeContents(editable);
            range.collapse(false);
            focusByRange(range);
        };
        const input = async (text: string) => {
            editable.dispatchEvent(new InputEvent("beforeinput", {bubbles: true, inputType: "insertText", data: text}));
            editable.textContent += text;
            focus();
            editable.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText", data: text}));
            await frame();
            bounded();
            check.ok(host.contains(getSelection().anchorNode), "saving preserves the native caret");
        };
        const readCell = (operation: IOperation, expected: string) => {
            const html = operationHTML(operation);
            check.doesNotMatch(html, /data-sy-table-virtual|data-sy-table-cell-inline/);
            const snapshot = document.createElement("div");
            snapshot.innerHTML = html;
            const rows = snapshot.querySelector("table").rows;
            check.equal(rows.length, 601);
            check.equal(rows[401].cells[1].textContent, expected);
            check.equal(rows[600].cells[2].textContent, "Keep 599");
            check.equal(operation.context.undoFocusTableCell, (401 * 3 + 1).toString());
            return snapshot;
        };
        focus();
        await input(" A");
        check.equal(changes.length, 1, "the first edit is submitted immediately");
        const firstSnapshot = operationHTML(changes[0].doOperations[0]);
        readCell(changes[0].undoOperations[0], "Value 400");
        readCell(changes[0].doOperations[0], "Value 400 A");
        await input(" B");
        check.equal(changes.length, 2, "successive edits retain separate transactions");
        readCell(changes[1].undoOperations[0], "Value 400 A");
        readCell(changes[1].doOperations[0], "Value 400 A B");
        check.equal(operationHTML(changes[0].doOperations[0]), firstSnapshot, "later edits do not mutate earlier snapshots");
        editable.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
        await input("中文");
        check.equal(changes.length, 2, "IME intermediate text is not committed");
        editable.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true, data: "中文"}));
        await frame();
        bounded();
        check.equal(changes.length, 3, "IME completion is committed once");
        readCell(changes[2].doOperations[0], "Value 400 A B中文");
        const selection = JSON.parse(changes[2].doOperations[0].context.undoFocusTableSelection);
        check.equal(selection.start, editable.textContent.length);
        const replay = readCell(changes[2].undoOperations[0], "Value 400 A B");
        const previousCell = replay.querySelector("table").rows[401].cells[1];
        previousCell.innerHTML = api.getTableCellRichBlockDOM(previousCell);
        document.body.appendChild(replay);
        check.ok(api.restoreRichCellSelection(previousCell, JSON.parse(changes[2].undoOperations[0].context.undoFocusTableSelection)));
        check.equal(getSelection().anchorOffset, "Value 400 A B".length, "undo restores the previous caret offset");
        replay.remove();
        focus();
        const range = document.createRange();
        range.selectNodeContents(editable);
        focusByRange(range);
        document.dispatchEvent(new Event("selectionchange"));
        for (const type of ["copy", "cut", "paste"]) {
            editable.dispatchEvent(new Event(type, {bubbles: true}));
            bounded();
        }
        focus();
        editable.dispatchEvent(new KeyboardEvent("keydown", {bubbles: true, key: "a"}));
        bounded();
        // 多块内容切换回完整表格，事务仍包含全部行和最后一次内联内容。
        editable.parentElement.insertAdjacentHTML("afterend", '<div data-type="NodeParagraph"><div contenteditable="true">Second paragraph</div></div>');
        editable.dispatchEvent(new Event("input", {bubbles: true}));
        check.equal(actualTable.rows.length, 601);
        readCell(changes[3].undoOperations[0], "Value 400 A B中文");
        check.ok(operationHTML(changes[3].doOperations[0]).includes("data-sy-table-cell-rich"));
        virtualizer.destroy();
        await finish(element);
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
        "../../util/escape.ts", "../util/tableVirtualizationDOM.ts", "setLute.ts", "../wysiwyg/codeBlockUtil.ts", "av/richTextValue.ts", "av/richText.ts",
        "../wysiwyg/taskListMarker.ts", "../util/tableCellRichLute.ts", "../util/tableCellRichValue.ts", "../util/tableCellRich.ts",
        "../util/tableCellRichContext.ts", "../util/tableCellRichSelection.ts", "../wysiwyg/tableVirtualization.ts",
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
    const transactionFile = createSourceFile("transaction.ts", read("../wysiwyg/transaction.ts"), ScriptTarget.Latest, true);
    const transactionSource = compile(transactionFile.statements.filter(isVariableStatement).filter(statement =>
        statement.declarationList.declarations.some(declaration =>
            ["updateTransaction", "promiseTransaction"].includes(declaration.name.getText(transactionFile))))
        .map(statement => statement.getText(transactionFile)).join("\n"));
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-table-cell-input-test-"));
    const script = path.join(temporary, "run.cjs");
    const lutePath = path.resolve(__dirname, "../../../stage/protyle/js/lute/lute.min.js");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {
        nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false,
    }});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(lutePath)}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" +
        browserCases.toString() + ")(" + [source, queue, compile(read("tableCellRichEditor.ts")), menuSource, transactionSource]
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
