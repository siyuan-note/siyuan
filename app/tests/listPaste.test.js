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
    return ts.transpileModule([
        read("util/hasClosest").replace(/^export /gm, ""),
        extract("wysiwyg/getBlock", ["getContenteditableElement", "getParentBlock", "getPreviousBlockSibling",
            "getNextBlockSibling", "hasPreviousSibling", "hasNextSibling", "isEndOfBlock", "getNextBlock", "getPreviousBlock"]),
        extract("util/selectionOffsets", ["selectIsEditor", "getSelectionOffset"]),
        extract("util/selection", ["getBlockRanges", "getUndoFocusContext"]),
        extract("wysiwyg/removeRange", ["getListItemElement", "getCrossBlockMergeRemoveElement"]),
        extract("wysiwyg/list", ["updateListOrder"]),
        extract("wysiwyg/listContext", ["getOrderedListMarkerUpdates"]),
        extract("util/insertHTML", ["markFoldHeadingChildren", "focusInsertedBlock", "insertHTML"]),
        "return insertHTML;",
    ].join("\n"), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
};

const runCases = source => {
    const check = require("node:assert/strict");
    const lute = window.Lute.New();
    lute.SetKramdownIAL(true);
    lute.SetSpin(true);
    lute.SetProtyleWYSIWYG(true);
    const editor = document.createElement("div");
    editor.className = "protyle-wysiwyg";
    editor.contentEditable = "true";
    document.body.append(editor);
    let transactions = [];
    let mobile = false;
    const dependencies = {
        Lute: window.Lute,
        Constants: {INLINE_TYPE: [], ZWSP: "\u200b", ATTRIBUTE_EDITING: "data-editing"},
        dayjs: () => ({format: () => "20261105120000"}),
        getEditorRange: () => getSelection().getRangeAt(0),
        getTextWithoutSemanticMarkers: element => element.textContent,
        stripSemanticMarkersFromRangeText: range => range.toString(),
        getSemanticMarkerPrefixLengthForNode: () => 0,
        prepareInlineElementBoundaryMutation() {},
        normalizeHTMLAssetIFrameSources() {},
        resetCodeBlockRenderState() {},
        renderIFrameResize() {},
        isHiddenTabContent: () => false,
        isMobile: () => mobile,
        focusBlock: element => {
            const range = document.createRange();
            range.selectNodeContents(element.querySelector('[contenteditable="true"]') || element);
            range.collapse(false);
            getSelection().removeAllRanges();
            getSelection().addRange(range);
            return range;
        },
        transaction: (_protyle, doOperations, undoOperations) => transactions.push({doOperations, undoOperations}),
    };
    const insertHTML = new Function(...Object.keys(dependencies), source)(...Object.values(dependencies));
    const normalize = element => {
        const clone = element.cloneNode(true);
        clone.querySelectorAll("wbr").forEach(item => item.remove());
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
                check.ok(target, `delete missing block ${operation.id}`);
                target.remove();
            } else if (operation.action === "update") {
                check.ok(target, `update missing block ${operation.id}`);
                target.outerHTML = operation.data;
            } else if (operation.action === "insert") {
                check.equal(target, null, `duplicate insert ${operation.id}`);
                const previous = operation.previousID && root.querySelector(`[data-node-id="${operation.previousID}"]`);
                const next = operation.nextID && root.querySelector(`[data-node-id="${operation.nextID}"]`);
                if (previous) previous.insertAdjacentHTML("afterend", operation.data);
                else if (next) next.insertAdjacentHTML("beforebegin", operation.data);
                else {
                    const parent = operation.parentID === "document" ? root : root.querySelector(`[data-node-id="${operation.parentID}"]`);
                    check.ok(parent, `insert missing parent ${operation.parentID}`);
                    const action = parent.querySelector(":scope > .protyle-action");
                    if (action) action.insertAdjacentHTML("afterend", operation.data);
                    else parent.insertAdjacentHTML("afterbegin", operation.data);
                }
            } else check.fail(`unexpected operation ${operation.action}`);
            const ids = Array.from(root.querySelectorAll("[data-node-id]"), item => item.dataset.nodeId);
            check.equal(new Set(ids).size, ids.length, "every operation preserves unique block IDs");
        }
    };
    for (mobile of [false, true]) {
        for (const marker of ["-", "1.", "- [ ]"]) {
            for (const selection of ["single", "middle", "multiple", "partial", "nested", "backward"]) {
                for (const fragment of [false, true]) {
                    const label = `${mobile}/${marker}/${selection}/fragment=${fragment}`;
                    const nested = selection === "nested" ? "\n  - nested child" : "";
                    editor.innerHTML = lute.Md2BlockDOM(`${marker} AAAA${nested}\n${marker} BBBB\n${marker} CCCC\n\nsource\n\n- XXX\n- YYY`);
                    const targetList = editor.querySelector('[data-type="NodeList"]');
                    const items = targetList.querySelectorAll(":scope > .li");
                    const firstItem = selection === "middle" ? items[1] : items[0];
                    const first = firstItem.querySelector('[contenteditable="true"]').firstChild;
                    const last = (["multiple", "partial", "backward"].includes(selection) ? items[1] : firstItem)
                        .querySelector('[contenteditable="true"]').firstChild;
                    if (selection === "backward") getSelection().setBaseAndExtent(last, 4, first, 0);
                    else getSelection().setBaseAndExtent(first, selection === "partial" ? 2 : 0, last, selection === "partial" ? 2 : 4);
                    const range = getSelection().getRangeAt(0);
                    const protyle = {toolbar: {range, getCurrentType: () => []}, wysiwyg: {element: editor},
                        block: {parentID: "document"}, lute};
                    const pasted = document.createElement("template");
                    pasted.innerHTML = lute.Md2BlockDOM("- XXX\n- YYY");
                    const html = fragment ? Array.from(pasted.content.firstElementChild.querySelectorAll(":scope > .li"), item => item.outerHTML).join("") : pasted.innerHTML;
                    const before = normalize(editor);
                    const replayed = editor.cloneNode(true);
                    transactions = [];
                    insertHTML(html, protyle, false, false, mobile);
                    check.equal(transactions.length, 1, label + ": one transaction");
                    const after = normalize(editor);
                    check.notEqual(after, before, label + ": paste changes the target");
                    const {doOperations, undoOperations} = transactions[0];
                    replay(replayed, doOperations);
                    check.equal(normalize(replayed), after, label + ": transaction matches rendered result");
                    for (let repeat = 0; repeat < 2; repeat++) {
                        replay(replayed, undoOperations);
                        check.equal(normalize(replayed), before, label + ": undo restores content, IDs, nesting and markers");
                        replay(replayed, doOperations);
                        check.equal(normalize(replayed), after, label + ": redo restores pasted content");
                    }
                }
            }
        }
    }
    return "List paste undo and redo cases passed";
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
        let code = 0;
        try {
            await win.loadURL("about:blank");
            await win.webContents.executeJavaScript(readFileSync(path.join(__dirname, "../stage/protyle/js/lute/lute.min.js"), "utf8"));
            const result = await win.webContents.executeJavaScript(`(() => {
                try { return (${runCases.toString()})(${JSON.stringify(compile())}); }
                catch (error) { return error.stack; }
            })()`);
            assert.equal(result, "List paste undo and redo cases passed");
            console.log(result);
        } catch (error) {console.error(error); code = 1;}
        finally {win.destroy(); app.exit(code);}
    });
} else {
    require("node:test").test("pasting list items over selected desktop and mobile list content preserves undo and redo", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-list-paste-test-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /List paste undo and redo cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-list-paste-test-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
