import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, isPropertyAssignment, ScriptTarget, transpileModule} from "typescript";

// 直接执行控制器中的保存入口，验证快照冲突不会进入文档事务。
const source = createSourceFile("index.ts", readFileSync("src/protyle/render/listMindmap/index.ts", "utf8"),
    ScriptTarget.ES2021, true);
const controller = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapController");
assert.ok(controller && isClassDeclaration(controller));
let callback = "";
const visit = (node: import("typescript").Node) => {
    if (isPropertyAssignment(node) && node.name.getText(source) === "onRelationChange") {
        callback = node.initializer.getText(source);
    }
    node.forEachChild(visit);
};
visit(controller);
assert.ok(callback);
const methods = controller.members.filter(item => item.name && ["metadata", "change"].includes(item.name.getText(source)));
const compiled = transpileModule(`class Controller {
    ${methods.map(item => item.getText(source)).join("\n")}
    onRelationChange = ${callback};
}
globalThis.Controller = Controller;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

test("manual route save and reset use one transaction and reject stale relation snapshots", async () => {
    let data = {version: 1, nodes: {}, relations: [{id: "r", from: "a", to: "b", label: "Keep", color: "red"}]};
    const original = JSON.stringify(data);
    const transactions: {before: string, after: string}[] = [];
    const messages: string[] = [];
    const list = {isConnected: true, get outerHTML() { return JSON.stringify(data); }};
    const context: any = {
        canEdit: () => true,
        getListMindmapSiblingIDs: () => new Map(),
        normalizeListMindmapSummaryMetadata: () => {},
        readListMindmap: () => ({root: {id: "a"}, metadata: JSON.parse(JSON.stringify(data)),
            nodes: new Map(["a", "b", "c"].map(id => [id, {}]))}),
        writeListMindmapMetadata: (_list: unknown, next: typeof data) => data = next,
        cleanListMindmapHTML: (html: string) => html,
        updateTransaction: (_owner: unknown, _list: unknown, before: string) => transactions.push({before, after: list.outerHTML}),
        showMessage: (message: string) => messages.push(message),
        window: {siyuan: {languages: {listMindmapStale: "stale"}}}, console,
    };
    runInNewContext(compiled, context);
    const target = new context.Controller();
    Object.assign(target, {list, owner: {}, view: {getSelectedId: () => "a"}, refresh: () => {}});
    const route = {version: 1, points: [{x: -40, y: 20, t: .5}]};
    const snapshot = JSON.stringify(data.relations[0]);
    target.onRelationChange("r", {route}, snapshot);
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].before, original);
    assert.deepEqual(JSON.parse(transactions[0].after).relations[0].route, route);
    const saved = JSON.stringify(data);
    target.onRelationChange("r", {route: undefined}, JSON.stringify(data.relations[0]));
    assert.equal(transactions.length, 2);
    assert.deepEqual(transactions[1], {before: saved, after: original});
    data = JSON.parse(saved);
    let finish: (value: boolean) => void;
    target.activeEditor = {finish: () => new Promise<boolean>(resolve => finish = resolve)};
    target.onRelationChange("r", {route: undefined}, JSON.stringify(data.relations[0]));
    data.relations[0].label = "Remote edit";
    finish(true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(transactions.length, 2);
    assert.equal(messages.pop(), "stale");
    assert.equal(data.relations[0].label, "Remote edit");
    assert.deepEqual(JSON.parse(JSON.stringify(data)).relations[0].route, route);
    target.activeEditor = undefined;
    data.relations = [];
    target.onRelationChange("r", {route}, snapshot);
    assert.equal(transactions.length, 2, "a deleted relation cannot be recreated by a stale drag");
    data = JSON.parse(saved);
    target.onRelationChange("r", {from: "c", route: undefined}, JSON.stringify(data.relations[0]));
    assert.equal(transactions.length, 3);
    assert.equal(transactions[2].before, saved, "undo retains the previous endpoints and manual path");
    assert.deepEqual(JSON.parse(transactions[2].after).relations[0], {id: "r", from: "c", to: "b", label: "Keep", color: "red"});
    data = JSON.parse(saved);
    for (const from of ["missing", "b"]) {
        target.onRelationChange("r", {from}, JSON.stringify(data.relations[0]));
        assert.equal(transactions.length, 3, "missing endpoints and self-connections never enter a transaction");
    }
    data.relations.push({...data.relations[0], id: "existing", from: "c"});
    target.onRelationChange("r", {from: "c"}, JSON.stringify(data.relations[0]));
    assert.equal(transactions.length, 3, "duplicate connections are checked against the current source data");
    for (const arrowDirection of ["forward", "reverse", "both", "none"]) {
        data = JSON.parse(saved);
        const before = JSON.stringify(data);
        target.onRelationChange("r", {arrowDirection});
        const transaction = transactions[transactions.length - 1];
        assert.equal(transaction.before, before, "undo retains the original relation and missing default field");
        assert.deepEqual(JSON.parse(transaction.after).relations[0], {
            ...JSON.parse(before).relations[0], arrowDirection,
        }, "direction changes preserve endpoints, manual route, text and styling");
        data = JSON.parse(transaction.before);
        assert.equal(JSON.stringify(data), before);
        data = JSON.parse(transaction.after);
        assert.equal(JSON.stringify(data), transaction.after, "redo restores the selected arrow mode");
        const count = transactions.length;
        target.onRelationChange("r", {arrowDirection});
        assert.equal(transactions.length, count, "choosing the current direction is a no-op");
    }
    data = JSON.parse(saved);
    const anchor = {side: "top", ratio: .27};
    const beforeAnchor = JSON.stringify(data);
    target.onRelationChange("r", {fromAnchor: anchor}, JSON.stringify(data.relations[0]));
    const anchored = transactions[transactions.length - 1];
    assert.equal(anchored.before, beforeAnchor);
    assert.deepEqual(JSON.parse(anchored.after).relations[0], {...JSON.parse(beforeAnchor).relations[0], fromAnchor: anchor});
    data = JSON.parse(anchored.before);
    assert.equal(JSON.stringify(data), beforeAnchor, "undo restores automatic attachment");
    data = JSON.parse(anchored.after);
    target.onRelationChange("r", {fromAnchor: undefined, toAnchor: undefined}, JSON.stringify(data.relations[0]));
    assert.equal(transactions[transactions.length - 1].after, beforeAnchor, "anchor reset preserves the manual path");
    data = JSON.parse(anchored.after);
    const anchorSnapshot = JSON.stringify(data.relations[0]);
    const count = transactions.length;
    data.relations[0].label = "New remote label";
    target.onRelationChange("r", {fromAnchor: {side: "left", ratio: .4}}, anchorSnapshot);
    assert.equal(transactions.length, count, "stale anchor drags cannot replace remote updates");
    assert.equal(messages.pop(), "stale");
    data = JSON.parse(anchored.after);
    target.onRelationChange("r", {from: "c", route: undefined, fromAnchor: undefined}, JSON.stringify(data.relations[0]));
    assert.deepEqual(JSON.parse(transactions[transactions.length - 1].after).relations[0],
        {id: "r", from: "c", to: "b", label: "Keep", color: "red"});
});
