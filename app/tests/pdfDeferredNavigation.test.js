const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const ts = require("typescript");

const source = readFileSync(path.join(__dirname, "../src/asset/pdf/pdf_viewer.js"), "utf8");
const parsed = ts.createSourceFile("pdf_viewer.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const viewer = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "PDFViewer");
assert.ok(viewer);
const member = name => {
    const node = viewer.members.find(item => name === "constructor" ? ts.isConstructorDeclaration(item) :
        item.name?.getText(parsed) === name);
    assert.ok(node, `Missing production member ${name}`);
    return node.getText(parsed);
};
const methods = ["#resizeObserverCallback", "#schedulePendingScroll", "#cancelPendingScroll",
    "#updateContainerHeightCss"].map(member).join("\n");

const fixture = () => {
    const frames = new Map();
    let sequence = 0;
    const Harness = new Function("requestAnimationFrame", "cancelAnimationFrame", "docStyle", `
        return class {
            #pendingScroll = null;
            #pendingScrollFrame = null;
            #abortSignal = {aborted: false};
            #containerTopLeft = null;
            #previousContainerHeight = 0;
            container = {isConnected: true, clientWidth: 780, clientHeight: 518};
            pdfDocument = {};
            calls = [];
            ${methods}
            #scrollIntoView(pageView, pageSpot) { this.calls.push({pageView, pageSpot}); }
            scrollPageIntoView(destination) { this.calls.push(destination); }
            update() { this.calls.push("update"); }
            queue(destination) { this.#pendingScroll = destination; }
            pending() { return this.#pendingScroll; }
            notify() { this.#resizeObserverCallback([{target: this.container,
                borderBoxSize: [{blockSize: this.container.clientHeight}]}]); }
            reset() { this.#cancelPendingScroll(); this.pdfDocument = {}; }
            abort() { this.#abortSignal.aborted = true; this.#cancelPendingScroll(); }
        };
    `)(callback => { const id = ++sequence; frames.set(id, callback); return id; },
        id => frames.delete(id), {setProperty() {}});
    return {viewer: new Harness(), frames, flush() {
        const queued = [...frames.values()];
        frames.clear();
        queued.forEach(callback => callback());
    }};
};

test("PDF resize delivery defers navigation and coalesces the latest destination", () => {
    const {viewer, frames, flush} = fixture();
    viewer.queue({pageNumber: 1});
    viewer.notify();
    assert.deepEqual(viewer.calls, [], "ResizeObserver must not navigate or update synchronously");
    viewer.queue({pageNumber: 2});
    viewer.notify();
    assert.equal(frames.size, 1);
    flush();
    assert.deepEqual(viewer.calls, [{pageNumber: 2}, "update"]);
    assert.equal(viewer.pending(), null);
});

test("PDF deferred page-view navigation preserves its exact page spot", () => {
    const {viewer, flush} = fixture();
    const destination = {pageView: {id: 2}, pageSpot: {left: 13, top: 29}};
    viewer.queue(destination);
    viewer.notify();
    flush();
    assert.deepEqual(viewer.calls, [destination, "update"]);
});

for (const field of ["clientWidth", "clientHeight", "isConnected"]) {
    test(`PDF navigation keeps its target when ${field} becomes unavailable before the frame`, () => {
        const {viewer, frames, flush} = fixture();
        const destination = {pageNumber: 2};
        viewer.queue(destination);
        viewer.notify();
        const previous = viewer.container[field];
        viewer.container[field] = 0;
        flush();
        assert.deepEqual(viewer.calls, []);
        assert.equal(viewer.pending(), destination);
        viewer.notify();
        assert.equal(frames.size, 0);
        viewer.container[field] = previous;
        viewer.notify();
        flush();
        assert.deepEqual(viewer.calls, [destination, "update"]);
    });
}

for (const action of ["reset", "abort"]) {
    test(`PDF ${action} cancels queued navigation and rejects a stale frame`, () => {
        const {viewer, frames} = fixture();
        viewer.queue({pageNumber: 1});
        viewer.notify();
        const staleFrame = [...frames.values()][0];
        viewer[action]();
        assert.equal(frames.size, 0);
        assert.equal(viewer.pending(), null);
        staleFrame();
        assert.deepEqual(viewer.calls, []);
    });
}

test("PDF document removal before the queued frame does not navigate", () => {
    const {viewer, flush} = fixture();
    viewer.queue({pageNumber: 2});
    viewer.notify();
    viewer.pdfDocument = null;
    flush();
    assert.deepEqual(viewer.calls, []);
});

test("PDF reset and abort production paths cancel deferred navigation", () => {
    assert.match(member("_resetView"), /this\.#cancelPendingScroll\(\)/);
    assert.match(member("constructor"), /"abort",\s*\(\) => \{\s*this\.#cancelPendingScroll\(\)/);
});
