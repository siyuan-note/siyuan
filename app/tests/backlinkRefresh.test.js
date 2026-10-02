const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const {ModuleKind, ScriptTarget, transpileModule} = require("typescript");

const compiled = transpileModule(readFileSync("src/layout/dock/BacklinkContent.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const setup = (type = "local") => {
    const exports = {};
    let clock = 0;
    let timerID = 0;
    let focused = false;
    let visible = true;
    const timers = new Map();
    runInNewContext(compiled, {
        exports,
        require: () => ({Model: class {}, hasAVEditorSession: () => false,
            shouldDeferBottomBacklinkRefresh: (focus, ignore) => focus && !ignore}),
        document: {activeElement: {}},
        window: {
            setTimeout: (callback, delay) => {
                timers.set(++timerID, {callback, due: clock + delay});
                return timerID;
            },
            clearTimeout: id => timers.delete(id),
        },
    });
    const panel = Object.create(exports.BacklinkContent.prototype);
    const requests = [];
    Object.assign(panel, {
        type, blockId: "target", dirty: false, destroyed: false, requesting: false,
        pendingFull: false, pendingRootIDs: new Set(), itemRecords: [new Map(), new Map()], indexChangeVersion: 0,
        element: {contains: () => focused, isConnected: true, getClientRects: () => visible ? [{}] : []},
        ownerProtyle: {element: {getClientRects: () => visible ? [{}] : []}}, empty: true,
        searchBacklinks() { this.requesting = true; requests.push(this.indexChangeVersion); },
    });
    const advance = ms => {
        clock += ms;
        for (const [id, timer] of timers) {
            if (timer.due <= clock) {
                timers.delete(id);
                timer.callback();
            }
        }
    };
    const change = rootID => {
        panel.markIndexDirty({backlinkChanged: true, rootIDs: [rootID]});
        panel.refreshAfterIndex();
    };
    return {panel, requests, timers, advance, change,
        focus: value => { focused = value; }, show: value => { visible = value; }};
};

for (const type of ["local", "bottom"]) {
    test(`${type} backlink refresh coalesces edits and retains every changed document`, () => {
        const {panel, requests, advance, change} = setup(type);
        change("one");
        advance(700);
        change("two");
        panel.refreshIfVisible();
        advance(700);
        assert.equal(requests.length, 0);
        advance(300);
        assert.deepEqual(requests, [2]);
        assert.deepEqual([...panel.pendingRootIDs], ["one", "two"]);
    });

    test(`${type} backlink refresh never queues searches behind a slow request`, () => {
        const {panel, requests, advance, change} = setup(type);
        change("one");
        advance(1000);
        for (let i = 0; i < 5; i++) {
            change("two");
            advance(1000);
            panel.refreshIfVisible();
        }
        assert.equal(requests.length, 1);
        assert.ok(!panel.searchQueued);
        assert.equal(panel.dirty, true);
        panel.requesting = false;
        panel.refreshAfterIndex();
        assert.equal(requests.length, 1);
        advance(1000);
        assert.equal(requests.length, 2);
    });

    test(`${type} backlink refresh rechecks visibility and focus after the delay`, () => {
        const {panel, requests, advance, change, focus, show} = setup(type);
        change("one");
        focus(true);
        advance(1000);
        assert.equal(requests.length, 0);
        focus(false);
        show(false);
        panel.refreshAfterIndex();
        advance(1000);
        assert.equal(requests.length, 0);
        show(true);
        panel.refreshAfterIndex();
        advance(1000);
        assert.equal(requests.length, 1);
    });
}

test("cancelled and destroyed panels cannot issue a delayed refresh", () => {
    const {panel, requests, timers, advance, change} = setup();
    change("one");
    panel.clearIndexRefresh();
    assert.equal(timers.size, 0);
    advance(1000);
    assert.equal(requests.length, 0);
    change("two");
    panel.destroyed = true;
    advance(1000);
    assert.equal(requests.length, 0);
});
