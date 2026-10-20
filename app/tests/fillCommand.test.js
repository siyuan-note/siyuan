const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const compile = () => {
    const root = path.join(__dirname, "../src/protyle");
    const read = file => readFileSync(path.join(root, file + ".ts"), "utf8");
    const extract = (file, names) => {
        const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
        const statements = source.statements.filter(statement => ts.isVariableStatement(statement) &&
            statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source))));
        assert.equal(statements.length, names.length, file);
        return statements.map(statement => statement.getText(source).replace(/^export /, "")).join("\n");
    };
    const hint = ts.createSourceFile("hint/index", read("hint/index"), ts.ScriptTarget.Latest, true);
    const declaration = hint.statements.find(node => ts.isClassDeclaration(node) && node.name.text === "Hint");
    assert.ok(declaration);
    const methods = declaration.members.filter(member => ["fillCommand", "fill", "consumeRefBracketClose",
        "fixImageCursor", "openNewTableCell"].includes(member.name?.getText(hint))).map(member => member.getText(hint));
    const keyboard = ts.createSourceFile("keydown", read("wysiwyg/keydown"), ts.ScriptTarget.Latest, true);
    const keyboardCases = [];
    const visit = node => {
        if (ts.isIfStatement(node) && [
            'matchHotKey("⇧↑", event)', 'matchHotKey("⇧↓", event)',
            "matchHotKey(window.siyuan.config.keymap.editor.insert.table, event) && !isInEmbedBlock(nodeElement)",
        ].includes(node.expression.getText(keyboard).replace(/\s+/g, " "))) keyboardCases.push(node.getText(keyboard));
        ts.forEachChild(node, visit);
    };
    visit(keyboard);
    assert.equal(keyboardCases.length, 3);
    // 使用真实命令、跨块事务、选区解析和块定位，只替换界面渲染及事务传输。
    return ts.transpileModule([
        read("util/hasClosest").replace(/^export /gm, ""),
        extract("wysiwyg/getBlock", ["getContenteditableElement", "getParentBlock", "getPreviousBlockSibling",
            "getNextBlockSibling", "hasPreviousSibling", "hasNextSibling", "isEndOfBlock", "getNextBlock", "getPreviousBlock"]),
        extract("wysiwyg/blockSelection", ["BLOCK_SELECTION_CLASS", "BLOCK_SELECTION_MODE_CLASS", "clearSelectionState",
            "getBlockSelectionModeElement",
            "clearBlockSelection", "clearBlockSelectionMode"]),
        extract("wysiwyg/commonHotkey", ["extendSelectionToBlockEdge", "getSelectionFocus", "upSelect", "downSelect",
            "getStartEndElement"]),
        extract("util/selectionOffsets", ["selectIsEditor", "getSelectionOffset", "focusByRange"]),
        extract("util/selection", ["getBlockRanges", "getUndoFocusContext", "focusByWbr"]),
        extract("render/tabsVisibility", ["isHiddenTabContent"]),
        extract("wysiwyg/removeRange", ["getListItemElement", "getCrossBlockMergeRemoveElement"]),
        extract("wysiwyg/list", ["updateListOrder"]),
        extract("wysiwyg/listContext", ["getOrderedListMarkerUpdates"]),
        extract("hint/blockHintRange", ["shouldCaptureHintUndoFocus"]),
        extract("util/insertHTML", ["markFoldHeadingChildren", "focusInsertedBlock", "insertHTML"]),
        extract("wysiwyg/transaction", ["updateTransaction"]),
        `const keyboardHandler = (protyle, event) => {
            const editorElement = protyle.wysiwyg.element;
            const range = getEditorRange(editorElement);
            const nodeElement = hasClosestBlock(range.startContainer);
            const blockSelectionModeElement = getBlockSelectionModeElement(editorElement);
            ${keyboardCases.join("\n")}
        };`,
        `class Hint {${methods.join("\n")}}`,
        "return {Hint, keyboardHandler, clearBlockSelectionMode};",
    ].join("\n"), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
};

const runCases = async source => {
    const check = require("node:assert/strict");
    const Lute = window.Lute;
    const style = document.createElement("style");
    style.textContent = ".protyle-attr {display:none}";
    document.head.append(style);
    const lute = Lute.New();
    lute.SetKramdownIAL(true);
    lute.SetSpin(true);
    lute.SetProtyleWYSIWYG(true);
    const editor = document.createElement("div");
    editor.className = "protyle-wysiwyg";
    editor.contentEditable = "true";
    document.body.append(editor);
    const outside = document.createElement("div");
    outside.contentEditable = "true";
    outside.textContent = "outside editor";
    document.body.append(outside);
    let mobile = false;
    let transactions = [];
    let openedCells = [];
    const focusBlock = (element, _parent, toStart = true) => {
        const cells = element.querySelectorAll("th, td");
        const target = cells.length ? cells[toStart ? 0 : cells.length - 1] : element.firstElementChild;
        const range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(toStart);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        return range;
    };
    const identity = value => value;
    const dependencies = {
        Lute,
        Constants: {BLOCK_HINT_KEYS: ["(("], INLINE_TYPE: [], ZWSP: "\u200b", ATTRIBUTE_EDITING: "data-editing"},
        dayjs: () => ({format: () => "20261019120000"}),
        hideElements: (panels, protyle) => {
            if (panels.includes("select")) clearBlockSelectionMode(protyle.wysiwyg.element, true);
        },
        isMac: () => false,
        matchHotKey: (key, event) => key === "F6" ? event.key === "F6" :
            key === "⇧↑" ? event.shiftKey && event.key === "ArrowUp" :
                key === "⇧↓" ? event.shiftKey && event.key === "ArrowDown" : false,
        getVerticalCaretRect: (_element, range) => range.getBoundingClientRect(),
        countBlockWord() {},
        preventScroll() {},
        isMobile: () => mobile,
        isProtyleListItemFragment: () => false,
        getEditorRange: () => getSelection().getRangeAt(0),
        getSuperBlockCommandLayout: () => undefined,
        getTextWithoutSemanticMarkers: element => element.textContent,
        stripSemanticMarkersFromRangeText: range => range.toString(),
        getSemanticMarkerPrefixLengthForNode: () => 0,
        prepareInlineElementBoundaryMutation() {},
        revealTabsForTarget() {},
        getAtomicVerticalNavigationOwner: () => undefined,
        normalizeHTMLAssetIFrameSources() {},
        renderIFrameResize() {},
        resetCodeBlockRenderState() {},
        cleanListMindmapHTML: identity,
        cleanHeadingNumberHTML: identity,
        cleanTableCellRichHTML: identity,
        cleanBlockSelectionModeHTML: identity,
        TABLE_VIRTUAL_ID: "data-table-virtual-id",
        focusBlock,
        transaction: (_protyle, doOperations, undoOperations) => {
            transactions.push({doOperations, undoOperations});
        },
        require: name => {
            check.equal(name, "../render/tableCellRichEditor");
            return {openTableCellRichEditor: (_protyle, cell) => openedCells.push(cell)};
        },
    };
    window.siyuan = {config: {keymap: {editor: {general: {expandUp: "alt-up", expandDown: "alt-down"},
        insert: {table: "F6"}}}}};
    const {Hint, keyboardHandler, clearBlockSelectionMode} = new Function(...Object.keys(dependencies), source)(...Object.values(dependencies));
    const hint = new Hint();
    const protyle = {toolbar: {getCurrentType: () => []}, wysiwyg: {element: editor},
        block: {parentID: "document"}, lute, hint, contentElement: editor, scroll: {lastScrollTop: 0}};
    editor.addEventListener("keydown", event => keyboardHandler(protyle, event));
    const normalize = element => {
        const clone = element.cloneNode(true);
        clone.querySelectorAll("wbr").forEach(item => item.remove());
        clone.querySelectorAll(".protyle-wysiwyg--select, .protyle-wysiwyg--select-mode").forEach(item => {
            item.classList.remove("protyle-wysiwyg--select", "protyle-wysiwyg--select-mode");
            item.removeAttribute("select-start");
            item.removeAttribute("select-end");
        });
        clone.querySelectorAll("[data-editing], [updated]").forEach(item => {
            item.removeAttribute("data-editing");
            item.removeAttribute("updated");
        });
        return clone.innerHTML;
    };
    const replay = (root, operations) => {
        for (const operation of operations) {
            const target = root.querySelector(`[data-node-id="${operation.id}"]`);
            if (operation.action === "delete") {
                check.ok(target, `delete ${operation.id}`);
                target.remove();
            } else if (operation.action === "update") {
                check.ok(target, `update ${operation.id}`);
                target.outerHTML = operation.data;
            } else if (operation.action === "insert") {
                check.equal(target, null, `duplicate insert ${operation.id}`);
                const previous = operation.previousID && root.querySelector(`[data-node-id="${operation.previousID}"]`);
                if (previous) {
                    previous.insertAdjacentHTML("afterend", operation.data);
                } else {
                    const parent = operation.parentID === "document" ? root :
                        root.querySelector(`[data-node-id="${operation.parentID}"]`);
                    check.ok(parent, `insert parent ${operation.parentID}`);
                    const action = parent.querySelector(":scope > .protyle-action");
                    if (action) action.insertAdjacentHTML("afterend", operation.data);
                    else parent.insertAdjacentHTML("afterbegin", operation.data);
                }
            } else {
                check.fail(`unexpected operation ${operation.action}`);
            }
        }
    };
    for (mobile of [false, true]) {
        for (const layout of ["paragraphs", "blockquote", "list", "ordered-list", "task-list"]) {
            for (const selection of ["partial-forward", "partial-backward", "full", "start-at-end", "end-at-start",
                "element-boundary", "single", "collapsed", "blocks", "block-mode", "keyboard-up", "keyboard-down"]) {
                if (selection.startsWith("keyboard") && (mobile || !["paragraphs", "blockquote"].includes(layout))) continue;
                const label = `${mobile ? "mobile" : "desktop"}/${layout}/${selection}`;
                const md = layout === "blockquote" ? "> AAAA\n>\n> BBBB\n>\n> CCCC\n\noutside" :
                    layout === "list" ? "- AAAA\n- BBBB\n- CCCC\n\noutside" :
                        layout === "ordered-list" ? "1. AAAA\n2. BBBB\n3. CCCC\n\noutside" :
                            layout === "task-list" ? "- [ ] AAAA\n- [x] BBBB\n- [ ] CCCC\n\noutside" :
                                "AAAA\n\nBBBB\n\nCCCC\n\noutside";
                editor.innerHTML = lute.Md2BlockDOM(md);
                const paragraphs = editor.querySelectorAll('[data-type="NodeParagraph"]');
                const first = paragraphs[0].firstElementChild.firstChild;
                const last = paragraphs[2].firstElementChild.firstChild;
                paragraphs[1].setAttribute("custom-note", "preserved");
                const firstOffset = selection === "full" ? 0 : selection === "single" ? 1 : selection === "start-at-end" ? 4 : 2;
                const end = selection === "single" || selection === "collapsed" ? first : last;
                const endOffset = selection === "full" ? 4 : selection === "single" ? 3 : selection === "end-at-start" ? 0 : 2;
                const reversed = selection === "partial-backward";
                getSelection().setBaseAndExtent(reversed ? end : first, reversed ? endOffset : firstOffset,
                    reversed ? first : end, reversed ? firstOffset : endOffset);
                if (selection === "element-boundary") {
                    getSelection().setBaseAndExtent(first.parentElement, first.parentElement.childNodes.length, last, 2);
                }
                if (selection === "blocks") {
                    Array.from(paragraphs).slice(0, 3).forEach(item =>
                        (item.closest(".li") || item).classList.add("protyle-wysiwyg--select"));
                    getSelection().collapse(first, 2);
                } else if (selection === "block-mode") {
                    paragraphs[0].classList.add("protyle-wysiwyg--select-mode");
                    getSelection().collapse(first, 2);
                } else if (selection.startsWith("keyboard")) {
                    const up = selection === "keyboard-up";
                    getSelection().collapse(up ? last : first, up ? 0 : 4);
                    for (let i = 0; i < 3; i++) {
                        const event = new KeyboardEvent("keydown", {key: up ? "ArrowUp" : "ArrowDown",
                            shiftKey: true, bubbles: true, cancelable: true});
                        editor.dispatchEvent(event);
                        check.ok(event.defaultPrevented, label + ": keyboard selection handled");
                    }
                    check.equal(editor.querySelectorAll(".protyle-wysiwyg--select").length, 3, label + ": three blocks selected");
                    check.ok(getSelection().isCollapsed, label + ": native range collapsed by block selection");
                }
                protyle.toolbar.range = getSelection().getRangeAt(0).cloneRange();
                const rangeOwner = node => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)
                    .closest("[data-node-id]").dataset.nodeId;
                const startID = rangeOwner(protyle.toolbar.range.startContainer);
                const endID = rangeOwner(protyle.toolbar.range.endContainer);
                // 移动工具栏点击后实时选区已在编辑器之外，命令必须使用保存的选区。
                if (mobile) getSelection().collapse(outside.firstChild, 1);
                transactions = [];
                openedCells = [];
                const original = normalize(editor);
                const replayed = editor.cloneNode(true);
                if (selection.startsWith("keyboard")) {
                    editor.dispatchEvent(new KeyboardEvent("keydown", {key: "F6", bubbles: true, cancelable: true}));
                } else {
                    hint.fillCommand(`| ${Lute.Caret} |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |`, protyle, !mobile);
                }
                await Promise.resolve();
                await Promise.resolve();
                check.equal(transactions.length, 1, label + ": single transaction");
                const {doOperations, undoOperations} = transactions[0];
                if (startID !== endID) {
                    const context = undoOperations.find(operation => operation.context?.undoFocusId)?.context;
                    check.equal(context?.undoFocusId, startID, label + ": undo start block retained");
                    check.equal(context?.undoFocusEndId, endID, label + ": undo end block retained");
                }
                const table = editor.querySelector('[data-type="NodeTable"]');
                check.ok(table, label + ": inserted table");
                if (["blocks", "block-mode"].includes(selection) || selection.startsWith("keyboard")) {
                    const retained = editor.cloneNode(true);
                    retained.querySelector('[data-type="NodeTable"]').remove();
                    check.equal(normalize(retained), original, label + ": block selection preserves all original content, IDs and attributes");
                } else if (selection === "full") {
                    check.doesNotMatch(editor.textContent, /AAAA|BBBB|CCCC/, label + ": full text selection replaced");
                    check.match(editor.textContent, /outside/, label + ": unselected text retained");
                } else if (selection.startsWith("partial-")) {
                    check.doesNotMatch(editor.textContent, /BBBB/, label + ": selected middle paragraph replaced");
                    check.equal(paragraphs[0].firstElementChild.textContent, "AA", label + ": start prefix retained");
                    check.match(editor.textContent, /CC/, label + ": end suffix retained");
                }
                check.equal(openedCells.length, 1, label + ": table cell editor opened");
                check.equal(openedCells[0], table.querySelector("th, td"), label + ": first cell focused");
                const inserted = normalize(editor);
                replay(replayed, doOperations);
                check.equal(normalize(replayed), inserted, label + ": transaction output matches editor");
                replay(editor, undoOperations);
                replay(replayed, undoOperations);
                check.equal(normalize(editor), original, label + ": undo restores content, IDs and attributes");
                check.equal(normalize(replayed), original, label + ": undo replay restores original");
                replay(editor, doOperations);
                replay(replayed, doOperations);
                check.equal(normalize(editor), inserted, label + ": redo restores replacement");
                check.equal(normalize(replayed), inserted, label + ": redo replay matches editor");
            }
        }
        for (const boundary of ["database", "embed"]) {
            editor.innerHTML = lute.Md2BlockDOM("AAAA\n\noutside");
            const first = editor.firstElementChild.firstElementChild.firstChild;
            const block = document.createElement("div");
            block.dataset.nodeId = Lute.NewNodeID();
            block.dataset.type = boundary === "database" ? "NodeAttributeView" : "NodeBlockQueryEmbed";
            block.className = boundary === "database" ? "av" : "render-node";
            block.innerHTML = boundary === "database" ? '<div class="av__title" contenteditable="true">database</div>' :
                lute.Md2BlockDOM("embedded text");
            editor.append(block);
            const end = block.querySelector('[contenteditable="true"]').firstChild;
            getSelection().setBaseAndExtent(first, 2, end, 2);
            protyle.toolbar.range = getSelection().getRangeAt(0).cloneRange();
            if (mobile) getSelection().collapse(outside.firstChild, 1);
            transactions = [];
            const original = normalize(editor);
            hint.fillCommand(`| ${Lute.Caret} |\n| --- |`, protyle, !mobile);
            check.equal(transactions.length, 0, boundary + ": unsupported boundary has no transaction");
            check.equal(normalize(editor), original, boundary + ": unsupported boundary preserves content");
            editor.querySelectorAll(":scope > [data-node-id]").forEach(item => item.classList.add("protyle-wysiwyg--select"));
            getSelection().collapse(first, 0);
            protyle.toolbar.range = getSelection().getRangeAt(0).cloneRange();
            if (mobile) getSelection().collapse(outside.firstChild, 1);
            const selectedOriginal = normalize(editor);
            const replayed = editor.cloneNode(true);
            hint.fillCommand(`| ${Lute.Caret} |\n| --- |`, protyle, !mobile);
            check.equal(transactions.length, 1, boundary + ": block selection uses the collapsed text caret");
            const retained = editor.cloneNode(true);
            retained.querySelector('[data-type="NodeTable"]').remove();
            check.equal(normalize(retained), selectedOriginal, boundary + ": selected atomic blocks retained");
            const {doOperations, undoOperations} = transactions[0];
            const inserted = normalize(editor);
            replay(replayed, doOperations);
            check.equal(normalize(replayed), inserted, boundary + ": transaction matches editor");
            replay(editor, undoOperations);
            check.equal(normalize(editor), selectedOriginal, boundary + ": undo restores original");
            replay(editor, doOperations);
            check.equal(normalize(editor), inserted, boundary + ": redo restores insertion");
        }
        for (const crossParent of [false, true]) {
            editor.innerHTML = lute.Md2BlockDOM(crossParent ? "> AAAA\n\nBBBB\n\nCCCC" : "AAAA\n\nBBBB\n\nCCCC");
            const paragraphs = editor.querySelectorAll('[data-type="NodeParagraph"]');
            paragraphs[0].classList.add("protyle-wysiwyg--select");
            paragraphs[2].classList.add("protyle-wysiwyg--select");
            getSelection().collapse(paragraphs[0].firstElementChild.firstChild, 0);
            protyle.toolbar.range = getSelection().getRangeAt(0).cloneRange();
            if (mobile) getSelection().collapse(outside.firstChild, 1);
            transactions = [];
            const original = normalize(editor);
            const replayed = editor.cloneNode(true);
            hint.fillCommand(`| ${Lute.Caret} |\n| --- |`, protyle, !mobile);
            check.equal(transactions.length, 1, "discontinuous block selection inserts at the text caret");
            const retained = editor.cloneNode(true);
            retained.querySelector('[data-type="NodeTable"]').remove();
            check.equal(normalize(retained), original, "discontinuous selection preserves selected blocks and unselected gaps");
            const {doOperations, undoOperations} = transactions[0];
            const inserted = normalize(editor);
            replay(replayed, doOperations);
            check.equal(normalize(replayed), inserted, "discontinuous selection transaction matches editor");
            replay(editor, undoOperations);
            check.equal(normalize(editor), original, "discontinuous selection undo restores original");
            replay(editor, doOperations);
            check.equal(normalize(editor), inserted, "discontinuous selection redo restores insertion");
        }
    }
    return "Table insertion, undo and redo cases passed";
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {
            nodeIntegration: true, contextIsolation: false, offscreen: true,
        }});
        let code = 0;
        try {
            await win.loadURL("about:blank");
            await win.webContents.executeJavaScript(readFileSync(path.join(__dirname,
                "../stage/protyle/js/lute/lute.min.js"), "utf8"));
            const result = await win.webContents.executeJavaScript(`(async () => {
                try { return await (${runCases.toString()})(${JSON.stringify(compile())}); }
                catch (error) { return error.stack; }
            })()`);
            assert.equal(result, "Table insertion, undo and redo cases passed");
            console.log(result);
        } catch (error) {
            console.error(error);
            code = 1;
        } finally {
            win.destroy();
            app.exit(code);
        }
    });
} else {
    require("node:test").test("table insertion keeps desktop and mobile block transactions reversible", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-table-insertion-test-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Table insertion, undo and redo cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-table-insertion-test-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
