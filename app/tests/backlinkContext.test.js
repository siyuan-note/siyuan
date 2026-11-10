const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const {ModuleKind, ScriptTarget, transpileModule} = require("typescript");

const compile = file => transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const content = compile("src/layout/dock/BacklinkContent.ts");
const batching = compile("src/layout/dock/backlinkContextBatch.ts");
const settle = () => new Promise(resolve => setImmediate(resolve));

const setup = type => {
    let frameID = 0;
    const frames = new Map();
    const requests = [];
    const events = [];
    const window = {
        requestAnimationFrame: callback => { frames.set(++frameID, callback); return frameID; },
        cancelAnimationFrame: id => frames.delete(id),
    };
    const batch = {};
    runInNewContext(batching, {exports: batch, window});
    const exports = {};
    runInNewContext(content, {exports, window, document: {activeElement: {}}, require: name => {
        if (name === "./backlinkContextBatch") {
            return batch;
        }
        return {
            Model: class {}, hasAVEditorSession: () => false, isSupportCSSHL: () => true,
            isEncryptedBox: () => false, getBacklinkSourceFilterParam: () => undefined,
            fetchPost: (_url, param, callback) => new Promise(resolve => {
                requests.push({param, respond: data => { callback({code: 0, data}); resolve(); }});
            }),
            renderBacklink: (protyle, data) => {
                events.push(`render:${protyle.id}:${data[0]}`);
                return Promise.resolve();
            },
            searchMarkRender: () => {},
        };
    }});
    const panel = Object.create(exports.BacklinkContent.prototype);
    Object.assign(panel, {
        type, blockId: "target", viewStateGeneration: 1, contextRequestVersions: [0, 0],
        contextBatch: new batch.BacklinkContextBatch(), sourceFilter: {}, pendingRootIDs: new Set(),
        inputsElement: [{value: ""}, {value: ""}],
        renderedQueryKey: "query", listQueryKey: "query", readingAnchorScrollEpochs: [0, 0],
        itemRecords: [new Map(), new Map()],
        captureReadingAnchor(isMention) {
            const pane = this.getReadingAnchorIndex(isMention);
            events.push(`capture:${pane}`);
            return {pane};
        },
        restoreReadingAnchor: anchor => events.push(`restore:${anchor.pane}`),
        updateBottomBacklinkSpacing: () => {},
    });
    window.siyuan = {config: {editor: {}}};
    const add = (id, isMention = false) => {
        const classes = new Set();
        let focused = false;
        const element = {
            isConnected: true,
            classList: {contains: name => classes.has(name), remove: name => classes.delete(name)},
            contains: () => focused, setAttribute: () => {},
        };
        const record = {editor: {protyle: {id, element, options: {}}}, contextRevision: "old", requestGeneration: 0};
        const arrow = {setAttribute: () => {}, removeAttribute: () => {}, classList: {add: () => {}}};
        const header = {isConnected: true, getAttribute: name => name === "data-node-id" ? id : "",
            firstElementChild: {firstElementChild: arrow}};
        panel.itemRecords[isMention ? 1 : 0].set(id, record);
        return {record, classes, element, focus: () => { focused = true; }, load: () => panel.loadContext(header, isMention, true)};
    };
    return {panel, add, events, requests, frame: () => {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach(callback => callback());
    }};
};

for (const type of ["local", "bottom"]) {
    test(`${type} context responses share reading anchors and retain all content updates`, async () => {
        const {add, events, requests, frame} = setup(type);
        const records = Array.from({length: 16}, (_, i) => add(`doc-${i}`, i >= 8));
        records.forEach(record => record.load());
        requests.forEach((request, i) => request.respond({revision: `new-${i}`, backlinks: [i], backmentions: [i]}));
        assert.equal(events.length, 0);
        assert.equal(records[0].record.contextRevision, "old", "queued updates cannot advance the applied revision");
        frame();
        const captures = type === "bottom" ? 1 : 2;
        assert.equal(events.filter(event => event.startsWith("capture:")).length, captures);
        assert.ok(events.slice(0, captures).every(event => event.startsWith("capture:")));
        assert.equal(events.filter(event => event.startsWith("render:")).length, 16);
        await settle();
        frame();
        assert.equal(events.filter(event => event.startsWith("restore:")).length, captures);
        records.forEach(({record}, i) => {
            assert.equal(record.contextRevision, `new-${i}`);
            assert.equal(record.contextDirty, false);
        });
    });
}

test("unchanged contexts bypass rendering and reading anchor measurements", async () => {
    const {add, events, requests, frame} = setup("local");
    add("doc").load();
    requests[0].respond({unchanged: true, revision: "same"});
    frame();
    await settle();
    assert.deepEqual(events, []);
});

for (const change of ["focus", "collapse", "detach", "new request", "switch document", "destroy"]) {
    test(`a queued context is not replayed after ${change}`, async () => {
        const {panel, add, requests, events, frame} = setup("local");
        const item = add("doc");
        item.load();
        requests[0].respond({revision: "new", backlinks: [1]});
        if (change === "focus") { item.focus(); }
        if (change === "collapse") { item.classes.add("fn__none"); }
        if (change === "detach") { item.element.isConnected = false; }
        if (change === "new request") { item.record.requestGeneration++; }
        if (change === "switch document") { panel.blockId = "another"; }
        if (change === "destroy") { panel.destroyed = true; panel.contextBatch.clear(); }
        frame();
        await settle();
        assert.deepEqual(events, []);
        assert.equal(item.record.contextRevision, "old");
        assert.equal(item.record.contextDirty, true);
        if (change === "focus") {
            assert.equal(panel.dirty, true);
            assert.equal(panel.pendingRootIDs.has("doc"), true);
        }
    });
}

for (const change of ["scroll", "query", "generation"]) {
    test(`context anchor restoration respects a subsequent ${change} change`, async () => {
        const {panel, add, requests, events, frame} = setup("local");
        add("doc").load();
        requests[0].respond({revision: "new", backlinks: [1]});
        frame();
        await settle();
        if (change === "scroll") { panel.readingAnchorScrollEpochs[0]++; }
        if (change === "query") { panel.listQueryKey = "other"; }
        if (change === "generation") { panel.viewStateGeneration++; }
        frame();
        assert.equal(events.filter(event => event.startsWith("restore:")).length, 0);
    });
}
