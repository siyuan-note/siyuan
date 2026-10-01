const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const ts = require("typescript");

const compiled = new Map();
const load = (name, dependencies, window, Lute) => {
    if (!compiled.has(name)) {
        compiled.set(name, ts.transpileModule(readFileSync(path.join(__dirname, "../src", name + ".ts"), "utf8"), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
        }).outputText);
    }
    const exports = {};
    new Function("require", "exports", "window", "Lute", compiled.get(name))(
        reference => dependencies[reference] || dependencies, exports, window, Lute);
    return exports;
};

const fixture = () => {
    const window = {siyuan: {
        languages: {newFileAtPath: "Choose location and create document", newFile: "Create doc", newSubDoc: "Create sub doc"},
        notebooks: [{id: "source"}, {id: "other"}, {id: "secret", encrypted: true}, {id: "secret2", encrypted: true}],
        config: {editor: {blockRefDynamicAnchorTextMaxLen: 64}},
    }};
    const Lute = {NewNodeID: () => "20260927120000-newdoc1", Caret: "‸", UnEscapeHTMLStr: value => value};
    const block = {outerHTML: "original", getAttribute: () => "block"};
    const text = {isConnected: true, textContent: "[[New title", block};
    const makeRange = () => ({
        startContainer: text, endContainer: text, startOffset: 0, endOffset: text.textContent.length,
        cloneRange: () => makeRange(),
        toString() { return text.textContent.slice(this.startOffset, this.endOffset); },
        collapse() {},
    });
    const range = makeRange();
    const protyle = {
        notebookId: "source", path: "/source.sy", block: {rootID: "sourceDoc"},
        wysiwyg: {element: {contains: node => node === text}}, toolbar: {range},
        element: {clientWidth: 800}, options: {},
    };
    const requests = [];
    const inserted = [];
    const focused = [];
    let picker;
    const deps = {
        hasClosestBlock: node => node.block,
        Constants: {ZWSP: "\u200b", BLOCK_HINT_KEYS: ["((", "[[", "（（", "【【"]},
        fetchPost: (url, data, cb) => requests.push({url, data, cb}),
        focusByRange: value => focused.push(value),
        getEditorRange: () => range,
        replaceFileName: value => value,
        validateName: () => true,
        hideElements: () => {},
        shouldCaptureHintUndoFocus: () => true,
        getUndoFocusContext: () => ({undoFocusId: "block"}),
        setPosition: () => {},
        registerBuiltinSlashHint: value => value,
        path: path,
    };
    const paths = load("util/pathName", {...deps, path}, window, Lute);
    Object.assign(deps, load("util/newFileSelection", deps, window, Lute), {
        ...paths,
        pathPosix: () => path.posix,
        movePathTo: options => { picker = options; },
    });
    const api = load("util/newFile", deps, window, Lute);
    Object.assign(deps, api);
    const hintAPI = load("protyle/hint/index", deps, window, Lute);
    const hint = Object.create(hintAPI.Hint.prototype);
    Object.assign(hint, {source: "hint", splitChar: "[[", lastIndex: -1, element: {
        lastElementChild: {innerHTML: ""}, style: {left: "0", right: "0"},
    }});
    hint.prepareCreateTarget = () => ({promise: Promise.resolve(false), isCurrent: () => true});
    hint.genLoading = () => {};
    hint.genHTML = items => { hint.items = items; };
    protyle.hint = hint;
    protyle.toolbar.setInlineMark = (...args) => { inserted.push(args); return []; };
    return {api, deps, paths, window, Lute, protyle, hint, range, text, block, requests, inserted, focused,
        get picker() { return picker; },
        open() { api.newFileByRefHintAtPath(protyle, "New title", range, (...args) => inserted.push(args)); },
    };
};

test("selected ID paths create at notebook root or the exact parent, without changing preferences", () => {
    for (const parent of ["/", "/same-name-one.sy", "/same-name-two.sy", "/ancestor/parent.sy"]) {
        const f = fixture();
        const config = JSON.stringify(f.window.siyuan.config);
        f.open();
        assert.equal(f.requests.length, 0);
        f.picker.cb([parent], ["other"]);
        assert.equal(f.requests.length, 1);
        assert.deepEqual(f.requests[0].data, {
            notebook: "other", path: path.posix.join(parent.replace(/\.sy$/, ""), "20260927120000-newdoc1.sy"),
            title: "New title", md: "",
        });
        assert.equal(f.requests[0].url, "/api/filetree/createDoc");
        assert.equal(f.inserted.length, 0);
        f.requests[0].cb({code: 0});
        assert.equal(f.inserted[0][0], "20260927120000-newdoc1");
        assert.notEqual(f.inserted[0][1], f.range);
        assert.equal(JSON.stringify(f.window.siyuan.config), config);
        f.picker.cb([parent], ["other"]);
        assert.equal(f.requests.length, 1);
    }
});

test("cancel restores the saved selection without creating or inserting anything", () => {
    const f = fixture();
    f.open();
    f.picker.restoreFocus();
    assert.equal(f.requests.length, 0);
    assert.equal(f.inserted.length, 0);
    assert.equal(f.focused.length, 1);
    assert.notEqual(f.focused[0], f.range);
});

test("changed, detached or navigated source contexts prevent creation and focus restoration", () => {
    for (const invalidate of [
        f => { f.text.isConnected = false; },
        f => { f.text.textContent = "different"; },
        f => { f.protyle.block.rootID = "different"; },
        f => { f.protyle.notebookId = "other"; },
    ]) {
        const f = fixture();
        f.open();
        invalidate(f);
        f.picker.cb(["/"], ["other"]);
        f.picker.restoreFocus();
        assert.equal(f.requests.length, 0);
        assert.equal(f.focused.length, 0);
    }
});

test("an invalidated source after creation starts does not receive a reference", () => {
    const f = fixture();
    f.open();
    f.picker.cb(["/"], ["other"]);
    f.protyle.block.rootID = "different";
    f.requests[0].cb({code: 0});
    assert.equal(f.inserted.length, 0);
});

test("a creation that never succeeds does not insert a reference", () => {
    const f = fixture();
    f.open();
    f.picker.cb(["/"], ["other"]);
    assert.equal(f.inserted.length, 0);
});

test("encrypted notebook boundaries apply to explicitly selected destinations", () => {
    for (const [source, target, allowed] of [
        ["source", "other", true], ["source", "secret", false],
        ["secret", "source", false], ["secret", "secret2", false], ["secret", "secret", true],
    ]) {
        const f = fixture();
        f.protyle.notebookId = source;
        f.open();
        assert.deepEqual(f.picker.sourceNotebookIds, [source]);
        f.picker.cb(["/"], [target]);
        assert.equal(f.requests.length, allowed ? 1 : 0);
    }
});

test("hint selection preserves reference subtype, anchor text and undo context", () => {
    for (const trigger of ["((", "[[", "（（", "【【"]) {
        for (const staticRef of [true, false]) {
            const f = fixture();
            f.hint.splitChar = trigger;
            f.hint.fill(`((newFileAtPath "Original anchor"\u200b'New title${f.Lute.Caret}'))`, f.protyle, false, staticRef);
            assert.equal(f.inserted.length, 0);
            f.picker.cb(["/"], ["other"]);
            f.requests[0].cb({code: 0});
            assert.equal(f.inserted.length, 1);
            const args = f.inserted[0];
            assert.equal(args[3].color, `20260927120000-newdoc1\u200b${staticRef ? "s" : "d"}\u200b${staticRef ? "Original anchor" : "New title"}`);
            assert.equal(args[4], true);
            assert.deepEqual(args[5], {undoFocusId: "block"});
            assert.notEqual(f.protyle.toolbar.range, f.range);
        }
    }
});

test("typed and searched reference suggestions offer location selection including database bindings", async () => {
    for (const source of ["hint", "search", "av"]) {
        for (const hideConfigured of [true, false]) {
            const f = fixture();
            f.hint.prepareCreateTarget = () => ({promise: Promise.resolve(hideConfigured), isCurrent: () => true});
            const extend = load("protyle/hint/extend", f.deps, f.window, f.Lute);
            extend.hintRef("New title", f.protyle, source);
            f.requests[0].cb({data: {newDoc: true, k: "New title", blocks: []}});
            await Promise.resolve();
            assert.equal(f.hint.items.some(item => item.value.startsWith("((newFileAtPath ")), true);
            assert.equal(f.hint.items.some(item => item.value.startsWith("((newFile ")), !hideConfigured);
            assert.equal(f.hint.items.some(item => item.value.startsWith("((newSubDoc ")), true);
            f.hint.genSearchHTML(f.protyle, {value: "New title"}, false, "Original anchor", source);
            f.requests[1].cb({data: {newDoc: true, k: "New title", blocks: []}});
            await Promise.resolve();
            assert.equal(f.hint.element.lastElementChild.innerHTML.includes("newFileAtPath"), true);
        }
    }
});

const databaseFixture = (view = "table", isDetached = true) => {
    const f = fixture();
    const cell = {isConnected: true, hasAttribute: () => false};
    f.text.parentElement = {closest: () => cell};
    const row = {dataset: {id: "original-item"}, contains: node => node === cell};
    let currentValue = {type: "block", isDetached, block: {id: isDetached ? "" : "old-doc", content: "Original"}};
    Object.assign(f.block, {
        isConnected: true,
        dataset: {nodeId: "database-block"},
        getAttribute: name => name === "data-av-type" ? view : "database",
        contains: node => node === row,
    });
    f.protyle.id = "editor";
    f.protyle.wysiwyg.element.contains = node => node === f.block || node === f.text;
    f.hint.source = "av";
    const operations = [];
    const animations = [];
    Object.assign(f.deps, load("protyle/render/av/binding", f.deps, f.window, f.Lute),
        load("protyle/render/av/bindCreatedDocument", f.deps, f.window, f.Lute),
        load("protyle/render/av/viewType", f.deps, f.window, f.Lute), {
        hasClosestByClassName: (node, name) => {
            if (name === "av__cell") {
                return cell;
            }
            assert.equal(name, ["table", "list"].includes(view) ? "av__row" : "av__gallery-item");
            return row;
        },
        genCellValueByElement: () => currentValue,
        transaction: (_protyle, doOperations, undoOperations) => operations.push({doOperations, undoOperations}),
        updateAttrViewCellAnimation: (target, value) => animations.push({target, value}),
    });
    return Object.assign(f, {cell, row, operations, animations,
        changeValue: value => { currentValue = value; },
        openDatabase() {
            f.hint.fill(`((newFileAtPath "Original"\u200b'New title${f.Lute.Caret}'))`, f.protyle, false);
        },
    });
};

test("database creation binds only after success and preserves item identity and undo", async () => {
    for (const view of ["table", "list", "gallery", "kanban"]) {
        for (const isDetached of [false, true]) {
            const f = databaseFixture(view, isDetached);
            f.openDatabase();
            f.picker.cb(["/chosen-parent.sy"], ["other"]);
            assert.equal(f.operations.length, 0);
            assert.equal(f.animations.length, 0);
            assert.equal(f.requests[0].data.path, "/chosen-parent/20260927120000-newdoc1.sy");
            f.requests[0].cb({code: 0});
            await Promise.resolve();
            assert.equal(f.operations.length, 1);
            const {doOperations, undoOperations} = f.operations[0];
            assert.equal(doOperations[0].previousID, "original-item");
            assert.equal(doOperations[0].avID, "database");
            assert.equal(doOperations[0].blockID, "database-block");
            assert.equal(doOperations[0].nextID, "20260927120000-newdoc1");
            assert.equal(undoOperations[0].isDetached, isDetached);
            assert.equal(undoOperations[0].nextID, isDetached ? "" : "old-doc");
            assert.equal(f.animations.length, 1);
            assert.equal(f.animations[0].target, f.cell);
            assert.equal(f.animations[0].value.block.content, "New title");
            assert.equal(f.inserted.length, 0);
        }
    }
});

test("canceling database location selection leaves the original binding and display intact", () => {
    const f = databaseFixture();
    f.openDatabase();
    f.picker.restoreFocus();
    assert.equal(f.requests.length, 0);
    assert.equal(f.operations.length, 0);
    assert.equal(f.animations.length, 0);
    assert.equal(f.focused.length, 1);
});

test("database context changes before confirmation or after creation starts cannot replace another binding", async () => {
    const changes = [
        f => { f.cell.isConnected = false; },
        f => { f.block.isConnected = false; },
        f => { f.row.dataset.id = "other-item"; },
        f => { f.block.dataset.nodeId = "other-carrier"; },
        f => { f.block.getAttribute = () => "other-database"; },
        f => { f.protyle.block.rootID = "other-document"; },
        f => { f.protyle.notebookId = "other"; },
        f => { f.changeValue({type: "block", isDetached: false, block: {id: "another-doc", content: "Changed"}}); },
        f => { f.changeValue({type: "block", isDetached: true, block: {id: "", content: "Edited title"}}); },
    ];
    for (const change of changes) {
        for (const afterCreate of [false, true]) {
            const f = databaseFixture();
            f.openDatabase();
            if (afterCreate) {
                f.picker.cb(["/"], ["other"]);
            }
            change(f);
            if (afterCreate) {
                f.requests[0].cb({code: 0});
                await Promise.resolve();
            } else {
                f.picker.cb(["/"], ["other"]);
                assert.equal(f.requests.length, 0);
            }
            assert.equal(f.operations.length, 0);
            assert.equal(f.animations.length, 0);
        }
    }
});

test("ordinary new document references still create directly with the original anchor", () => {
    const f = fixture();
    const created = [];
    f.deps.newFileByRefHint = (protyle, name, cb) => {
        created.push({protyle, name});
        cb("new-doc");
    };
    f.hint.fill(`((newFile "Original anchor"\u200b'New title${f.Lute.Caret}'))`, f.protyle, false, true);
    assert.deepEqual(created, [{protyle: f.protyle, name: "New title"}]);
    assert.equal(f.picker, undefined);
    assert.equal(f.inserted[0][3].color, "new-doc\u200bs\u200bOriginal anchor");
});
