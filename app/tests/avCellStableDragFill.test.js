const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const ts = require("typescript");
const dayjs = require("dayjs");

const directory = path.join(__dirname, "../src/protyle/render/av");
const source = ts.createSourceFile("cell.ts", readFileSync(path.join(directory, "cell.ts"), "utf8"),
    ts.ScriptTarget.ES2022, true);
const declaration = source.statements.find(statement => ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => item.name.getText(source) === "dragFillCellsValue"));
const compile = text => ts.transpileModule(text, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;
const modules = new Map();
const load = name => {
    if (!modules.has(name)) {
        const exports = {};
        runInNewContext(compile(readFileSync(path.join(directory, `${name}.ts`), "utf8")), {
            window: {siyuan: {config: {readonly: false}, isPublish: false}},
            exports, require: dependency => dependency === "../../util/hasClosest" ? {} :
                load(dependency.replace(/^\.\//, "")),
        });
        modules.set(name, exports);
    }
    return modules.get(name);
};

const fixture = ({types = ["text", "number"], grouped = false, upward = false, related = false} = {}) => {
    const columns = types.map((type, index) => ({id: `column-${index}`, type}));
    const rowIDs = upward ? ["target-0", "target-1", "target-2", "source-0", "source-1"] :
        ["source-0", "source-1", "target-0", "target-1", "target-2"];
    const makeRow = rowID => ({
        id: rowID,
        cells: columns.map((column, index) => ({
            id: `${rowID}-${index}`, valueType: column.type,
            value: {id: `${rowID}-${index}`, blockID: rowID, keyID: column.id, type: column.type,
                [column.type]: column.type === "number" ? {content: rowIDs.indexOf(rowID), isNotEmpty: true} :
                    {content: `${rowID}:${index}`, ...(column.type === "block" ? {id: "bound-source", icon: "icon"} : {})},
                ...(column.type === "block" ? {isDetached: !rowID.startsWith("source")} : {}),
            },
        })),
    });
    const rows = rowIDs.map(makeRow);
    const view = {id: grouped ? "group-a" : "view", columns, rows};
    const state = {editable: true, data: {id: "database", viewID: "view", view: grouped ?
        {id: "view", groups: [view]} : view}};
    const node = {dataset: {avId: "database", nodeId: "carrier"}, isConnected: true,
        getAttribute: name => name === "updated" ? "20261101000000" : null, querySelector: () => null,
        querySelectorAll: () => assert.fail("model drag fill must not enumerate mounted cells")};
    const host = load("host");
    if (related) host.setAVRelationHost(node, {sourceBlockID: "source-carrier", active: true, available: true,
        readonly: () => false,
        relationContext: {sourceAvID: "source-database", sourceItemID: "source-row", relationKeyID: "relation"}});
    const editor = related ? host.createAVHostProtyle({options: {}}, node) : {};
    const selection = load("selectionState");
    let selected = [];
    const setSelection = (points = rows.flatMap(row => columns.map(column => ({
        groupID: grouped ? "group-a" : "", rowID: row.id, colID: column.id,
    })))) => {
        selected = points.map(point => selection.resolveAVSelectedCell(state.data, point));
        assert.ok(selected.every(Boolean));
        selection.setAVCellSelection(node, {anchor: points[0], focus: points.at(-1), cells: selected});
    };
    setSelection();
    const originData = Object.fromEntries(["source-0", "source-1"].map(rowID => [rowID,
        structuredClone(rows.find(row => row.id === rowID).cells.map(cell => cell.value))]));
    const originCellIDs = Object.values(originData).flatMap(values => values.map(value => value.id));
    const transactions = [];
    const updates = [];
    const fill = runInNewContext(compile(declaration.getText(source).replace(/^export /, "")) +
        "\ndragFillCellsValue;", {
        ...load("capabilities"), ...load("cellValue"), ...load("dragFillValue"), ...selection, ...host, dayjs,
        getAVData: () => state.data, canEditAVHost: () => state.editable,
        updateAttrViewCellInOtherElements: (_protyle, _avID, rowID, colID, value) => {
            updates.push({rowID, colID, value});
        },
        focusBlock() {},
        transaction: (_protyle, operations, undo) => transactions.push({operations, undo}),
    });
    return {columns, rows, view, state, originData, originCellIDs, transactions, updates, setSelection, node, editor, host,
        get selected() {return selected;},
        fill: () => fill(editor, node, originData, originCellIDs, {querySelector: () => null})};
};

const cellOperations = operations => operations.filter(operation => operation.action === "updateAttrViewCell");

for (const upward of [false, true]) {
    test(`model drag fill repeats a two-row, two-column pattern ${upward ? "upward" : "downward"} without mounted cells`, () => {
        const f = fixture({upward});
        const original = structuredClone(f.originData);
        f.fill();
        assert.equal(f.transactions.length, 1);
        const operations = cellOperations(f.transactions[0].operations);
        const undo = cellOperations(f.transactions[0].undo);
        assert.equal(operations.length, 6);
        assert.equal(undo.length, 6);
        for (let index = 0; index < 3; index++) {
            const target = f.rows.find(row => row.id === `target-${index}`);
            for (let colIndex = 0; colIndex < 2; colIndex++) {
                const operation = operations[index * 2 + colIndex];
                assert.equal(operation.action, "updateAttrViewCell");
                assert.equal(operation.avID, "database");
                assert.equal(operation.rowID, `target-${index}`);
                assert.equal(operation.keyID, `column-${colIndex}`);
                assert.equal(operation.id, `target-${index}-${colIndex}`);
                assert.equal(operation.data.blockID, operation.rowID);
                assert.equal(operation.data.keyID, operation.keyID);
                assert.equal(operation.data.id, operation.id);
                const type = colIndex === 0 ? "text" : "number";
                assert.equal(operation.data[type].content, original[`source-${index % 2}`][colIndex][type].content);
                assert.equal(target.cells[colIndex].value[type].content, operation.data[type].content);
                assert.equal(undo[index * 2 + colIndex].rowID, target.id);
            }
        }
        assert.deepEqual(f.originData, original);
        assert.equal(f.updates.length, 6);
    });
}

for (const type of ["select", "mSelect", "mAsset"]) {
    test(`empty ${type} fill clears stored values and retains undo payloads`, () => {
        const f = fixture({types: [type]});
        const property = type === "select" ? "mSelect" : type;
        for (const values of Object.values(f.originData)) {
            for (const value of values) {
                delete value[type];
            }
        }
        for (const row of f.rows.filter(row => row.id.startsWith("target"))) {
            row.cells[0].value[property] = [{content: row.id}];
        }
        f.fill();
        assert.equal(f.transactions.length, 1);
        const operations = cellOperations(f.transactions[0].operations);
        const undo = cellOperations(f.transactions[0].undo);
        assert.equal(operations.length, 3);
        operations.forEach((operation, index) => {
            assert.deepEqual(Array.from(operation.data[property]), []);
            assert.equal(undo[index].data[property][0].content, `target-${index}`);
            assert.deepEqual(Array.from(f.rows.find(row => row.id === operation.rowID).cells[0].value[property]), []);
        });
    });
}

test("drag fill uses current target cell identity and value for undo after a rerender", () => {
    const f = fixture();
    const target = f.rows.find(row => row.id === "target-0");
    target.cells[0] = {...target.cells[0], id: "replacement", value: {
        ...target.cells[0].value, id: "replacement", text: {content: "newer-current-value"},
    }};
    f.fill();
    assert.equal(f.transactions[0].operations[0].id, "replacement");
    assert.equal(f.transactions[0].undo[0].data.text.content, "newer-current-value");
});

test("source key identities keep columns aligned when their visible order changes", () => {
    const f = fixture({types: ["text", "text"]});
    f.columns.reverse();
    f.rows.forEach(row => row.cells.reverse());
    f.setSelection();
    f.fill();
    const operations = cellOperations(f.transactions[0].operations);
    assert.equal(operations[0].keyID, "column-1");
    assert.equal(operations[0].data.text.content, "source-0:1");
    assert.equal(operations[1].keyID, "column-0");
    assert.equal(operations[1].data.text.content, "source-0:0");
});

test("deleted rows and changed fields are skipped without shifting the remaining source pattern", () => {
    const f = fixture();
    f.view.rows = f.rows.filter(row => row.id !== "target-0");
    f.columns[1].type = "url";
    f.fill();
    assert.equal(cellOperations(f.transactions[0].operations).length, 2);
    assert.equal(f.transactions[0].operations[0].rowID, "target-1");
    assert.equal(f.transactions[0].operations[0].data.text.content, "source-1:0");
    assert.equal(f.transactions[0].operations[1].data.text.content, "source-0:0");
});

test("hidden and read-only fields do not receive fill operations or shift neighboring fields", () => {
    const f = fixture({types: ["lineNumber", "text", "text"]});
    f.columns[1].hidden = true;
    f.fill();
    assert.equal(cellOperations(f.transactions[0].operations).length, 3);
    assert.ok(cellOperations(f.transactions[0].operations).every(operation => operation.keyID === "column-2"));
    assert.equal(f.transactions[0].operations[0].data.text.content, "source-0:2");
});

test("empty value IDs do not exclude every target or overwrite the original source cells", () => {
    const f = fixture();
    f.rows.forEach(row => row.cells.forEach(cell => {
        cell.id = "";
        cell.value.id = "";
    }));
    f.originCellIDs.splice(0, f.originCellIDs.length, "");
    f.fill();
    assert.equal(cellOperations(f.transactions[0].operations).length, 6);
    assert.ok(cellOperations(f.transactions[0].operations).every(operation => operation.rowID.startsWith("target")));
});

test("block fill preserves detached target semantics and skips bound target rows", () => {
    const f = fixture({types: ["block"]});
    f.rows.find(row => row.id === "target-1").cells[0].value.isDetached = false;
    f.fill();
    const operations = cellOperations(f.transactions[0].operations);
    const undo = cellOperations(f.transactions[0].undo);
    assert.equal(operations.length, 2);
    assert.ok(operations.every(operation => operation.data.isDetached && !operation.data.block.id));
    assert.ok(operations.every(operation => operation.data.block.icon === "icon"));
    assert.equal(undo[0].data.block.id, "bound-source");
    assert.equal(f.originData["source-0"][0].block.id, "bound-source");
});

test("grouped fill resolves the selected occurrence rather than the first matching row", () => {
    const f = fixture({grouped: true});
    const duplicate = structuredClone(f.view);
    duplicate.id = "group-b";
    duplicate.rows.find(row => row.id === "target-0").cells[0].value.text.content = "other occurrence";
    f.state.data.view.groups.unshift(duplicate);
    f.fill();
    assert.equal(f.transactions[0].undo[0].data.text.content, "target-0:0");
});

test("removing the selected group cannot fill another occurrence with matching row IDs", () => {
    const f = fixture({grouped: true});
    f.state.data.view.groups = [{...f.view, id: "group-b"}];
    f.fill();
    assert.equal(f.transactions.length, 0);
});

test("missing data or a readonly owner does not fall back to stale mounted cells", () => {
    const missing = fixture();
    missing.state.data = undefined;
    missing.fill();
    assert.equal(missing.transactions.length, 0);
    const readonly = fixture();
    readonly.state.editable = false;
    readonly.fill();
    assert.equal(readonly.transactions.length, 0);
});

test("drag fill records its physical carrier and timestamp in the same undoable transaction", () => {
    const f = fixture({types: ["select"]});
    f.fill();
    assert.equal(f.transactions.length, 1);
    const {operations, undo} = f.transactions[0];
    assert.equal(operations.length, 4);
    assert.equal(undo.length, 4);
    assert.ok(cellOperations(operations).every(operation => operation.blockID === "carrier"));
    assert.ok(cellOperations(undo).every(operation => operation.blockID === "carrier"));
    assert.equal(operations.at(-1).action, "doUpdateUpdated");
    assert.equal(operations.at(-1).id, "carrier");
    assert.match(operations.at(-1).data, /^\d{14}$/);
    assert.equal(undo.at(-1).action, "doUpdateUpdated");
    assert.equal(undo.at(-1).id, "carrier");
    assert.equal(undo.at(-1).data, "20261101000000");
});

test("related database fills use the source carrier and retain the host transaction restrictions", () => {
    const f = fixture({related: true});
    f.fill();
    const {operations, undo} = f.transactions[0];
    for (const list of [operations, undo]) {
        assert.ok(cellOperations(list).every(operation => operation.blockID === "source-carrier"));
        const prepared = f.host.prepareAVHostTransaction(f.editor, list);
        assert.equal(prepared.length, 6);
        assert.ok(prepared.every(operation => operation.action === "updateAttrViewCell" &&
            operation.blockID === "source-carrier" && operation.relationContext.sourceItemID === "source-row"));
    }
});

test("a fill containing only its source cells does not create a timestamp-only undo entry", () => {
    const f = fixture();
    f.setSelection(f.selected.filter(cell => cell.rowID.startsWith("source")).map(cell => ({
        rowID: cell.rowID, colID: cell.colID, groupID: cell.groupID,
    })));
    f.fill();
    assert.equal(f.transactions.length, 0);
});
