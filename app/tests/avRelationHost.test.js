const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const ts = require("typescript");

const fixture = () => {
    const source = readFileSync(path.join(__dirname, "../src/protyle/render/av/host.ts"), "utf8");
    const output = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022}}).outputText;
    const exports = {};
    const window = {siyuan: {config: {readonly: false}, isPublish: false}};
    const physical = {dataset: {nodeId: "real-block"}};
    new Function("require", "exports", "window", output)(name => {
        assert.equal(name, "../../util/hasClosest");
        return {hasClosestBlock: () => physical};
    }, exports, window);
    const element = {isConnected: true, dataset: {avHost: "related-1", avId: "target"}};
    const context = {sourceAvID: "source", sourceItemID: "entry", relationKeyID: "field"};
    const host = {relationContext: context, sourceBlockID: "carrier", viewID: "view", temporaryFilters: [],
        active: true, available: true, readonly: () => false, rendered: () => {}, failed: () => {}};
    exports.setAVRelationHost(element, host);
    const protyle = {id: "editor", disabled: false, options: {}};
    const proxy = exports.createAVHostProtyle(protyle, element);
    return {api: exports, window, physical, element, context, host, protyle, proxy};
};

test("relation hosts preserve real block identity without inventing a carrier", () => {
    const f = fixture();
    const child = {closest: selector => { assert.equal(selector, "[data-av-host]"); return f.element; }};
    assert.equal(f.api.getAVHost(child), f.element);
    assert.equal(f.api.getAVHost({nodeType: 3, parentElement: child}), f.element);
    assert.equal(f.api.getAVHostIdentity(f.element), "related-1");
    assert.equal(f.api.getAVHostBlockID(f.element), "carrier");
    f.host.sourceBlockID = "";
    assert.equal(f.api.getAVHostBlockID(f.element), "");
    assert.equal(f.element.dataset.nodeId, undefined);
    f.api.deleteAVRelationHost(f.element);
    assert.equal(f.api.getAVHost(child), f.physical);
    assert.equal(f.api.getAVHostIdentity(f.physical), "real-block");
    assert.equal(f.api.getAVHostBlockID(f.physical), "real-block");
});

test("scoped edits clone context, retain cell data and drop physical updated markers", () => {
    const f = fixture();
    const operations = [{action: "updateAttrViewCell", avID: "target", rowID: "member", keyID: "text",
        blockID: "wrong-carrier", data: {text: {content: "updated"}}}, {action: "doUpdateUpdated", id: "physical"}];
    const before = structuredClone(operations);
    const result = f.api.prepareAVHostTransaction(f.proxy, operations);
    assert.equal(result.length, 1);
    assert.equal(result[0].blockID, "carrier");
    assert.deepEqual(result[0].relationContext, f.context);
    assert.notEqual(result[0].relationContext, f.context);
    assert.deepEqual(operations, before);
    result[0].relationContext.sourceItemID = "other";
    assert.equal(f.context.sourceItemID, "entry");
    f.host.sourceBlockID = "";
    const batch = f.api.prepareAVHostTransaction(f.proxy,
        [{action: "updateAttrViewCells", avID: "target", cellUpdates: [{rowID: "member"}]}]);
    assert.equal(batch[0].blockID, "");
    assert.equal(batch[0].cellUpdates[0].rowID, "member");
});

test("virtual hosts reject structural mutations and cross-target mixed transactions", () => {
    const f = fixture();
    for (const action of ["delete", "insert", "setAttrViewName", "setAttrViewFilters", "setAttrViewColWidth", "removeAttrViewBlock"]) {
        assert.equal(f.api.prepareAVHostTransaction(f.proxy, [{action, avID: "target"}]), undefined, action);
    }
    assert.equal(f.api.prepareAVHostTransaction(f.proxy,
        [{action: "updateAttrViewCell", avID: "target"}, {action: "updateAttrViewCell", avID: "other"}]), undefined);
});

test("readonly, inactive, unavailable and disconnected hosts stop pending edits", () => {
    for (const invalidate of [
        f => { f.protyle.disabled = true; }, f => { f.window.siyuan.config.readonly = true; },
        f => { f.window.siyuan.isPublish = true; }, f => { f.protyle.options.history = {created: "history"}; },
        f => { f.protyle.options.history = {snapshot: "snapshot"}; }, f => { f.element.isConnected = false; },
        f => { f.host.active = false; }, f => { f.host.available = false; },
        f => { f.host.readonly = () => true; }, f => { f.api.deleteAVRelationHost(f.element); },
    ]) {
        const f = fixture();
        assert.equal(f.proxy.disabled, false);
        invalidate(f);
        assert.equal(f.proxy.disabled, true);
        assert.equal(f.api.prepareAVHostTransaction(f.proxy, [{action: "updateAttrViewCell", avID: "target"}]), undefined);
    }
});

test("ordinary editor transactions retain identity and optional undo behavior", () => {
    const f = fixture();
    const operations = [{action: "delete", id: "real-block"}];
    assert.equal(f.api.prepareAVHostTransaction(f.protyle, operations), operations);
    assert.equal(f.api.prepareAVHostTransaction(f.protyle, undefined), undefined);
    assert.equal(f.api.prepareAVHostTransaction(undefined, operations), operations);
    assert.equal(f.proxy.id, f.protyle.id);
});

test("refresh subscriptions are isolated by editor and released independently", () => {
    const f = fixture();
    const first = [], second = [], other = [];
    const unsubscribe = f.api.registerAVHostRefresh("editor", id => first.push(id));
    const unsubscribeSecond = f.api.registerAVHostRefresh("editor", id => second.push(id));
    f.api.registerAVHostRefresh("other", id => other.push(id));
    f.api.notifyAVHostRefresh("editor", "source");
    unsubscribe();
    f.api.notifyAVHostRefresh("editor", "target");
    assert.deepEqual(first, ["source"]);
    assert.deepEqual(second, ["source", "target"]);
    assert.deepEqual(other, []);
    unsubscribeSecond();
    f.api.notifyAVHostRefresh("editor", "removed");
    assert.deepEqual(second, ["source", "target"]);
    f.api.notifyAVHostRefresh("other", "independent");
    assert.deepEqual(other, ["independent"]);
});
