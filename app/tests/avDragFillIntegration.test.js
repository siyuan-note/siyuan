const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const ts = require("typescript");

const directory = path.join(__dirname, "../src/protyle/render/av");
const compile = source => ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;
const rangeSource = compile(readFileSync(path.join(directory, "rangeSelect.ts"), "utf8"));
const cellSource = ts.createSourceFile("cell.ts", readFileSync(path.join(directory, "cell.ts"), "utf8"),
    ts.ScriptTarget.ES2022, true);
const fillSource = cellSource.statements.find(statement => ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => item.name.getText(cellSource) === "dragFillCellsValue"));

const setup = (groupID = "") => {
    const columns = Array.from({length: 4}, (_, index) => ({id: `c${index}`, type: "number"}));
    const rows = Array.from({length: 8}, (_, index) => ({id: `r${index}`, cells: columns.map(column => ({
        id: `r${index}-${column.id}`, valueType: "number", value: {id: `r${index}-${column.id}`,
            blockID: `r${index}`, keyID: column.id, type: "number",
            number: {content: index * 10 + Number(column.id.slice(1)), isNotEmpty: true}},
    }))}));
    const view = {id: groupID || "view", columns, rows};
    const data = {id: "database", viewID: "view", viewType: "table", view: groupID ?
        {id: "view", groups: [view]} : view};
    const block = {dataset: {avId: "database", avType: "table"}, querySelectorAll: () => [], querySelector: () => null};
    const modules = {
        "./virtualScroll": {getAVData: () => data},
        "./row": {updateAVSelectionStatus() {}},
        "./columnWindow": {ensureAVColumnWindow() {}},
        "../../util/hasClosest": {hasClosestByClassName: (element, name) => element.closest("." + name)},
    };
    const load = name => {
        if (!modules[name]) {
            const exports = {};
            modules[name] = exports;
            runInNewContext(compile(readFileSync(path.join(directory, `${name}.ts`), "utf8")), {exports, require: load});
        }
        return modules[name];
    };
    const selection = load("./selectionState");
    const range = {};
    runInNewContext(rangeSource, {exports: range, require: load});
    const origin = [3, 4].flatMap(index => ["c1", "c2"].map(colID =>
        selection.resolveAVSelectedCell(data, {groupID, rowID: `r${index}`, colID})));
    const originData = Object.fromEntries([3, 4].map(index => [`r${index}`,
        origin.filter(cell => cell.rowID === `r${index}`).map(cell => structuredClone(cell.cell.value))]));
    const originIDs = origin.map(cell => cell.cell.id);
    const transactions = [];
    const fill = runInNewContext(compile(fillSource.getText(cellSource).replace(/^export /, "")) + "\ndragFillCellsValue;", {
        ...selection, ...load("./capabilities"), ...load("./cellValue"), ...load("./dragFillValue"),
        getAVData: () => data, canEditAVHost: () => true,
        updateAttrViewCellInOtherElements() {}, focusBlock() {},
        transaction: (_protyle, operations, undo) => transactions.push({operations, undo}),
    });
    const target = (index, colID = "c2", targetGroup = groupID) => {
        const body = {dataset: {groupId: targetGroup}};
        const row = {dataset: {id: `r${index}`}, closest: () => body};
        return {dataset: {colId: colID}, closest: () => row};
    };
    return {data, view, rows, columns, origin, originData, transactions,
        selected: () => selection.getAVSelectedCells(block),
        select: (index, colID, targetGroup) => range.selectAVDragFillRange(block, origin, target(index, colID, targetGroup)),
        fill: () => fill({}, block, originData, originIDs, {querySelector: () => null})};
};

for (const groupID of ["", "group-a"]) {
    for (const [targetIndex, expectedRows] of [[0, [0, 1, 2]], [7, [5, 6, 7]]]) {
        test(`range selection and drag fill compose across unmounted cells: ${groupID || "ungrouped"}, row ${targetIndex}`, () => {
            const f = setup(groupID);
            const original = structuredClone(f.originData);
            assert.equal(f.select(targetIndex), true);
            assert.equal(f.selected().length, 10);
            f.fill();
            assert.equal(f.transactions.length, 1);
            const {operations, undo} = f.transactions[0];
            assert.equal(operations.length, 6);
            expectedRows.forEach((rowIndex, patternIndex) => [1, 2].forEach((columnIndex, offset) => {
                const operation = operations[patternIndex * 2 + offset];
                assert.equal(operation.rowID, `r${rowIndex}`);
                assert.equal(operation.keyID, `c${columnIndex}`);
                assert.equal(operation.id, `r${rowIndex}-c${columnIndex}`);
                assert.equal(operation.data.number.content, (patternIndex % 2 + 3) * 10 + columnIndex);
                assert.equal(undo[patternIndex * 2 + offset].data.number.content, rowIndex * 10 + columnIndex);
                assert.equal(f.rows[rowIndex].cells[columnIndex].value.number.content, operation.data.number.content);
            }));
            assert.deepEqual(f.originData, original);
        });
    }
}

test("reversing a fill drag uses the latest complete rectangle and rejects another column or group", () => {
    const f = setup("group-a");
    assert.equal(f.select(7), true);
    assert.equal(f.select(7, "c3"), false);
    assert.equal(f.selected().length, 4);
    assert.equal(f.select(7, "c2", "other-group"), false);
    assert.equal(f.select(4), false);
    assert.equal(f.select(0), true);
    f.fill();
    assert.deepEqual(Array.from(f.transactions[0].operations, operation => operation.rowID),
        ["r0", "r0", "r1", "r1", "r2", "r2"]);
});

test("column reordering between source capture and fill keeps source key identities", () => {
    const f = setup();
    [f.columns[1], f.columns[2]] = [f.columns[2], f.columns[1]];
    f.rows.forEach(row => {[row.cells[1], row.cells[2]] = [row.cells[2], row.cells[1]];});
    assert.equal(f.select(7, "c1"), true);
    f.fill();
    assert.equal(f.transactions[0].operations[0].keyID, "c2");
    assert.equal(f.transactions[0].operations[0].data.number.content, 32);
    assert.equal(f.transactions[0].operations[1].keyID, "c1");
    assert.equal(f.transactions[0].operations[1].data.number.content, 31);
});

test("a missing source row prevents committing an obsolete preview", () => {
    const f = setup();
    assert.equal(f.select(7), true);
    f.view.rows = f.rows.filter(row => row.id !== "r3");
    const accepted = f.select(0);
    if (accepted) f.fill();
    assert.equal(accepted, false);
    assert.equal(f.transactions.length, 0);
});
