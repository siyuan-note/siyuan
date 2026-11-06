const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const ts = require("typescript");

const directory = path.join(__dirname, "../src/protyle/render/av");
const source = ts.createSourceFile("cell.ts", readFileSync(path.join(directory, "cell.ts"), "utf8"),
    ts.ScriptTarget.ES2022, true);
const functionNames = new Set(["getStoredCellValueByElement", "genCellValueByElement", "genCellValue",
    "createCellInputTarget", "popTextCell", "updateCellValueByInput", "updateCellsValue"]);
const compile = text => ts.transpileModule(text, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;
const functions = source.statements.filter(statement => ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(declaration => functionNames.has(declaration.name.getText(source))))
    .map(statement => statement.getText(source).replace(/^export /, "")).join("\n");
assert.equal(functions.match(/^(?:const|let) /gm).length, functionNames.size);
const modules = new Map();
const load = name => {
    if (!modules.has(name)) {
        const exports = {};
        runInNewContext(compile(readFileSync(path.join(directory, `${name}.ts`), "utf8")), {
            exports, require: dependency => load(dependency.replace(/^\.\//, "")),
        });
        modules.set(name, exports);
    }
    return modules.get(name);
};

const makeElement = (dataset = {}) => Object.assign(new EventTarget(), {
    dataset, isConnected: true, style: {},
    classList: {add() {}, contains: () => false},
    getAttribute(name) {
        return this.dataset[name.replace(/^data-/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] || null;
    },
    getBoundingClientRect: () => ({left: 0, top: 0, bottom: 30, width: 200, height: 30}),
    matches: () => false,
    querySelector: () => null,
    closest: () => null,
});

const fixture = (type = "number", {groups = false, batch = false, count = 1, viewType = "table", cached = true} = {}) => {
    const transactions = [];
    const updated = [];
    const owner = {contains: () => true};
    const values = Array.from({length: count}, (_, index) => ({
        id: `value-${index}`, keyID: "column", blockID: `row-${index}`, type,
        ...(type === "number" ? {number: {content: index + 1, isNotEmpty: true}} :
            {[type]: {content: `original-${index}`, ...(type === "block" ? {id: `bound-${index}`, icon: "icon"} : {})}}),
        ...(type === "block" ? {isDetached: false} : {}),
    }));
    const columns = [{id: "column", type}];
    const rows = values.map((value, index) => ({id: `row-${index}`, cells: [{id: value.id, value, valueType: type}]}));
    const view = {id: groups ? "group-a" : "view", columns, rows};
    if (viewType === "gallery") {
        view.fields = columns;
        view.cards = rows.map(row => ({id: row.id, values: row.cells}));
        delete view.columns;
        delete view.rows;
    }
    const state = {data: cached ? {id: "database", viewID: "view", view: groups ?
        {id: "view", columns, groups: [view]} : view} : undefined};
    const block = makeElement({avId: "database", nodeId: "carrier", avType: viewType});
    const protyle = {block: {rootID: "document"}, options: {}, disabled: false, toolbar: {}};
    const cells = values.map((value, index) => {
        const cell = makeElement({id: value.id, colId: "column", fieldId: "column", dtype: type,
            cellValue: encodeURIComponent(JSON.stringify(value)),
            ...(!cached || batch ? {avId: "database", rowId: `row-${index}`, type} : {}),
            ...(batch ? {avBatchOriginalValue: encodeURIComponent(JSON.stringify(value)), avBatchMode: "replace"} : {}),
        });
        cell.row = makeElement({id: `row-${index}`});
        cell.group = makeElement({groupId: groups && !batch ? "group-a" : ""});
        cell.closest = selector => selector.includes("av__body") ? cell.group :
            selector.includes("av__row") || selector.includes("av__gallery-item") ? cell.row : null;
        cell.querySelector = selector => selector === ".av__celltext" ? {textContent: `original-${index}`} : null;
        return cell;
    });
    const originalCells = [...cells];
    const mounted = [...cells];
    block.contains = element => mounted.includes(element) && element.isConnected;
    block.querySelector = selector => mounted.find(cell => cell.isConnected &&
        (!selector.includes("data-group-id") || selector.includes(`data-group-id="${cell.group.dataset.groupId}"`)) &&
        (!selector.includes("data-id=") || selector.includes(`data-id="${cell.row.dataset.id}"`))) || null;
    const mask = makeElement();
    mask.isConnected = false;
    mask.remove = () => {mask.isConnected = false;};
    const input = makeElement();
    input.value = "";
    input.select = () => {};
    input.focus = () => {document.activeElement = input;};
    mask.querySelector = () => input;
    const document = {
        activeElement: input,
        body: {insertAdjacentHTML: () => {mask.isConnected = true;}},
        querySelector: selector => selector === ".b3-dialog" ? null : mask.isConnected ? mask : null,
        querySelectorAll: () => mask.isConnected ? [mask] : [],
    };
    const window = {siyuan: {config: {}, menus: {menu: {remove() {}}}, zIndex: 0}};
    const context = {
        ...load("capabilities"), ...load("cellValue"), ...load("batchValue"), ...load("dragFillValue"),
        ...load("viewType"), document, window,
        getAVData: target => {assert.equal(target, block); return state.data;},
        getAVHostIdentity: target => target.dataset.avHost || target.dataset.nodeId,
        getAVCellEditorOwner: () => owner,
        getAVRelationHost: () => undefined,
        canEditAVHost: (_block, editor) => !editor.disabled && !window.siyuan.config.readonly &&
            !window.siyuan.isPublish && !editor.options.history?.created && !editor.options.history?.snapshot,
        hasClosestBlock: () => block,
        hasClosestByClassName: (element, name) => name === "custom-attr" ?
            (element.dataset.avId ? {} : null) : name === "av__row" ? element.row : null,
        getColId: element => element.dataset.colId,
        getFieldIdByCellElement: element => element.dataset.rowId || element.row.dataset.id,
        getComputedStyle: () => ({}), cellScrollIntoView() {},
        bindAnchoredInputPosition: (_input, getter) => {state.anchor = getter;},
        escapeHtml: value => value, escapeAttr: value => value,
        callMobileAppShowKeyboard() {}, setPosition() {}, addDragFill() {}, focusBlock() {},
        electronUndo: () => false, isNotCtrl: () => true,
        Constants: {BLOCK_HINT_KEYS: ["(("], CUSTOM_SY_AV_VIEW: "custom-sy-av-view"},
        AV_CELL_EDITOR_CLOSE_EVENT: "siyuan-av-cell-editor-close",
        getCellText: () => "original", getCellValueText: value => String(value[value.type]?.content),
        getAVSelectedCells: () => assert.fail("saving must not follow a later selection"),
        objEquals: (left, right) => JSON.stringify(left) === JSON.stringify(right),
        dayjs: () => ({format: () => "time"}),
        updateAttrViewCellAnimation() {}, updateAVSelectedCellValue() {},
        updateAttrViewCellInOtherElements: (_protyle, _avID, rowID, colID, value, element) => {
            if (state.data) load("cellValue").updateAVCachedCellValue(state.data.view, rowID, colID, value);
            if (element?.dataset.avBatchOriginalValue) {
                element.dataset.avBatchChanged = "true";
                element.dataset.cellValue = encodeURIComponent(JSON.stringify(value));
            }
            updated.push(value);
        },
        transaction: (_protyle, operations, undo) => transactions.push({operations, undo}),
    };
    const api = runInNewContext(compile(functions) + "\n({popTextCell, updateCellsValue});", context);
    api.popTextCell(protyle, cells, type, {scrollIntoView: false});
    const edit = value => {input.value = value; input.dispatchEvent(new Event("input"));};
    const save = () => mask.dispatchEvent(new Event(context.AV_CELL_EDITOR_CLOSE_EVENT));
    const unmount = () => originalCells.forEach(cell => {cell.isConnected = false;});
    const close = (saveDraft = false) => {
        const exports = {};
        runInNewContext(compile(readFileSync(path.join(directory, "cellEditor.ts"), "utf8")),
            {exports, document, window, CustomEvent});
        exports.closeAVCellEditor(undefined, saveDraft);
    };
    return {state, view, rows, columns, block, protyle, owner, cells, originalCells, mounted, input, mask,
        transactions, updated, edit, save, unmount, close, window};
};

for (const type of ["number", "url", "email", "phone", "block"]) {
    test(`${type} input saves through real updateCellsValue after its row is unmounted`, () => {
        const f = fixture(type);
        f.edit(type === "number" ? "42" : "updated");
        f.unmount();
        f.save();
        assert.equal(f.transactions.length, 1);
        const operation = f.transactions[0].operations[0];
        assert.equal(operation.action, "updateAttrViewCell");
        assert.equal(operation.avID, "database");
        assert.equal(operation.blockID, "carrier");
        assert.equal(operation.rowID, "row-0");
        assert.equal(operation.keyID, "column");
        assert.equal(operation.id, "value-0");
        assert.equal(operation.data[type].content, type === "number" ? 42 : "updated");
        if (type === "block") {
            assert.equal(operation.data.block.id, "bound-0");
            assert.equal(operation.data.block.icon, "icon");
            assert.equal(operation.data.isDetached, false);
        }
        assert.equal(f.mask.isConnected, false);
    });
}

test("save resolves reordered columns and the current undo value, not the opening snapshot", () => {
    const f = fixture();
    f.edit("42");
    f.unmount();
    f.rows[0].cells[0].value.number.content = 19;
    f.columns.unshift({id: "other", type: "number"});
    f.rows[0].cells.unshift({id: "other-value", value: {type: "number", number: {content: 999}}});
    f.save();
    assert.equal(f.transactions[0].undo[0].data.number.content, 19);
    assert.equal(f.transactions[0].operations[0].keyID, "column");
    assert.equal(f.rows[0].cells[0].value.number.content, 999);
});

test("the draft follows a remounted occurrence without targeting a duplicate row in another group", () => {
    const f = fixture("number", {groups: true});
    f.edit("42");
    f.unmount();
    const wrong = {...f.originalCells[0], isConnected: true, group: {dataset: {groupId: "group-b"}}};
    const remounted = {...f.originalCells[0], isConnected: true};
    f.mounted.push(wrong, remounted);
    assert.equal(f.state.anchor(), remounted);
    f.save();
    assert.equal(f.transactions[0].operations[0].rowID, "row-0");
    assert.equal(f.transactions[0].operations[0].data.number.content, 42);
});

for (const [name, invalidate] of [
    ["database", f => {f.block.dataset.avId = "other";}],
    ["display instance", f => {f.block.dataset.nodeId = "other";}],
    ["host identity", f => {f.block.dataset.avHost = "other";}],
    ["document", f => {f.protyle.block.rootID = "other";}],
    ["owner", f => {f.owner.contains = () => false;}],
    ["host removal", f => {f.block.isConnected = false;}],
    ["view", f => {f.state.data.viewID = "other";}],
    ["pending view selection", f => {f.block.dataset.customSyAvView = "other";}],
    ["view type", f => {f.block.dataset.avType = "gallery";}],
    ["row deletion", f => {f.view.rows = [];}],
    ["field deletion", f => {f.view.columns = [];}],
    ["field type", f => {f.columns[0].type = "url";}],
    ["missing cache", f => {f.state.data = undefined;}],
    ["readonly", f => {f.protyle.disabled = true;}],
    ["publish", f => {f.window.siyuan.isPublish = true;}],
    ["history", f => {f.protyle.options.history = {snapshot: "snapshot"};}],
]) {
    test(`${name} changes invalidate the draft instead of redirecting its transaction`, () => {
        const f = fixture();
        f.edit("42");
        invalidate(f);
        f.save();
        assert.equal(f.transactions.length, 0);
        assert.equal(f.mask.isConnected, false);
    });
}

test("removing the original group cannot redirect an edit to another occurrence of the row", () => {
    const f = fixture("number", {groups: true});
    f.edit("42");
    f.state.data.view.groups = [{...f.view, id: "group-b"}];
    f.unmount();
    f.save();
    assert.equal(f.transactions.length, 0);
});

test("adding grouping invalidates an ungrouped draft rather than selecting an arbitrary occurrence", () => {
    const f = fixture();
    f.edit("42");
    f.state.data.view = {id: "view", groups: [{...f.view, id: "group-b"}]};
    f.save();
    assert.equal(f.transactions.length, 0);
});

test("multiple original cells save after unmount without consulting the later selection", () => {
    const f = fixture("number", {count: 2});
    f.edit("42");
    f.unmount();
    f.save();
    const operations = f.transactions[0].operations.filter(operation => operation.action === "updateAttrViewCell");
    assert.deepEqual(Array.from(operations, operation => operation.rowID), ["row-0", "row-1"]);
    assert.ok(operations.every(operation => operation.data.number.content === 42));
});

test("batch proxies retain changed values after redraw, including grouped rows and hidden fields", () => {
    const f = fixture("number", {count: 2, batch: true, groups: true});
    f.originalCells.forEach(cell => {cell.group.dataset.groupId = "";});
    f.columns[0].hidden = true;
    f.edit("42");
    f.unmount();
    f.save();
    assert.equal(f.transactions[0].operations.length, 3);
    f.originalCells.forEach(cell => {
        assert.equal(cell.dataset.avBatchChanged, "true");
        assert.equal(JSON.parse(decodeURIComponent(cell.dataset.cellValue)).number.content, 42);
    });
});

for (const viewType of ["list", "gallery"]) {
    test(`${viewType} scalar editors retain their original model target after unmount`, () => {
        const f = fixture("number", {viewType});
        f.edit("42");
        f.unmount();
        f.save();
        assert.equal(f.transactions[0].operations[0].data.number.content, 42);
    });
}

test("attribute editors without a model preserve their existing connected-cell save path", () => {
    const f = fixture("number", {cached: false});
    f.edit("42");
    f.save();
    assert.equal(f.transactions[0].operations[0].data.number.content, 42);
    const stale = fixture("number", {cached: false});
    stale.edit("42");
    stale.unmount();
    stale.save();
    assert.equal(stale.transactions.length, 0);
});

test("clearing a number, unchanged close, and cancellation retain their existing behavior", () => {
    const cleared = fixture();
    cleared.edit("");
    cleared.unmount();
    cleared.save();
    assert.equal(cleared.transactions[0].operations[0].data.number.isNotEmpty, false);
    const unchanged = fixture();
    unchanged.unmount();
    unchanged.save();
    assert.equal(unchanged.transactions.length, 0);
    const cancelled = fixture();
    cancelled.edit("42");
    cancelled.unmount();
    cancelled.close(false);
    assert.equal(cancelled.mask.isConnected, false);
    assert.equal(cancelled.transactions.length, 0);
});

test("typing a block reference while its anchor is unmounted leaves the draft available to save", () => {
    const f = fixture("block");
    f.unmount();
    f.edit("((draft");
    assert.equal(f.mask.isConnected, true);
    f.save();
    assert.equal(f.transactions[0].operations[0].data.block.content, "((draft");
});
