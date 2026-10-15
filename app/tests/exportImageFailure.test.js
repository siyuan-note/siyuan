const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const ts = require("typescript");

const createExport = (copyOnly = false, failRendering = false) => {
    const requests = [];
    const controls = new Map();
    let connected = true;
    let loading = true;
    const control = selector => {
        if (!controls.has(selector)) {
            const events = new Map();
            controls.set(selector, {disabled: selector.includes('"copy"') || selector.includes('"export"'), checked: false, value: "", innerHTML: "",
                addEventListener: (name, callback) => events.set(name, callback), events,
                querySelectorAll: () => [], setAttribute() {}, removeAttribute() {},
                parentElement: {insertAdjacentHTML: () => { loading = true; }}});
        }
        return controls.get(selector);
    };
    const element = {setAttribute() {}, querySelector: selector => selector === ".fn__loading" ?
        (loading ? {remove: () => { loading = false; }} : null) : control(selector)};
    const deps = new Proxy({
        getHostCapabilities: () => ({documentImportExport: true}), Constants: {LOCAL_EXPORTIMG: "image"},
        Dialog: class {element = element; destroy() { connected = false; }},
        fetchPost: (url, data, callback) => {
            let resolve;
            const promise = new Promise(done => { resolve = done; });
            requests.push({url, data, callback, resolve});
            return promise;
        },
        sanitizeKernelHTML: value => value,
        renderExportJSEmbeds: async () => { if (failRendering) throw new Error("render failed"); },
        observeExportImageLayout: () => () => {},
    }, {get: (target, key) => key in target ? target[key] : () => {}});
    const exports = {};
    runInNewContext(ts.transpileModule(readFileSync("src/protyle/export/util.ts", "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
    }).outputText, {exports, require: () => deps, console: {error() {}},
        document: {body: {contains: () => connected}},
        window: {siyuan: {languages: {}, storage: {image: {}}, config: {export: {}, editor: {}, system: {}}}}});
    exports.exportImage("block", copyOnly);
    const respond = index => requests[index].callback({data: {content: "preview", attrs: {}, name: "doc"}});
    return {control, requests, respond, get loading() { return loading; }, get connected() { return connected; }};
};
const settle = () => new Promise(resolve => setImmediate(resolve));

test("failed image preview requests release the spinner and leave cancellation available in both dialog modes", async () => {
    for (const copyOnly of [false, true]) {
        const h = createExport(copyOnly);
        h.requests[0].resolve();
        await settle();
        assert.equal(h.loading, false);
        assert.equal(h.control('[data-type="cancel"]').disabled, false);
        assert.equal(h.control('[data-type="copy"]').disabled, true);
        assert.equal(h.control('[data-type="export"]').disabled, true);
        h.control('[data-type="cancel"]').events.get("click")();
        assert.equal(h.connected, false);
    }
});

test("preview render failures release cancellation without enabling invalid image output", async () => {
    const h = createExport(false, true);
    h.respond(0);
    h.requests[0].resolve();
    await settle();
    assert.equal(h.loading, false);
    assert.equal(h.control('[data-type="cancel"]').disabled, false);
    assert.equal(h.control('[data-type="export"]').disabled, true);
});

test("superseded preview completion preserves the latest loading state and successful previews enable output", async () => {
    const h = createExport();
    h.control("#keepFold").events.get("change")();
    h.respond(0);
    h.requests[0].resolve();
    await settle();
    assert.equal(h.loading, true);
    assert.equal(h.control('[data-type="export"]').disabled, true);
    h.respond(1);
    h.requests[1].resolve();
    await settle();
    assert.equal(h.loading, false);
    assert.equal(h.control('[data-type="export"]').disabled, false);
});
