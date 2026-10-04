const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const ts = require("typescript");

const source = ts.createSourceFile("anno.ts", readFileSync("src/asset/anno.ts", "utf8"), ts.ScriptTarget.ES2021, true);
const declaration = source.statements.find(statement => ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => item.name.getText(source) === "removeAnno"));
const code = ts.transpileModule(declaration.getText(source) + "\nremoveAnno;", {
    compilerOptions: {target: ts.ScriptTarget.ES2021},
}).outputText;

const setup = (file = "http://localhost/assets/document.pdf") => {
    const requests = [];
    const confirmations = [];
    const config = {annotation: {page: 1}, other: {page: 2}};
    const pdf = {appConfig: {file, config}};
    const element = {isConnected: true};
    let registered = pdf;
    let removed = 0;
    const removeAnno = runInNewContext(code, {
        URL,
        location: {origin: "http://localhost"},
        window: {siyuan: {languages: {deleteOpConfirm: "Delete", pdfAnnotationDeleteRefConfirm: "Referenced by ${x} blocks"}}},
        getRegisteredPdfInstance: () => registered,
        getConfig: () => config,
        getRectElementsByNodeId: (owner, id) => {
            assert.equal(owner, element);
            assert.equal(id, "annotation");
            return [{remove: () => { removed++; }}];
        },
        fetchPost: (url, data, callback) => { requests.push({url, data, callback}); },
        confirmDialog: (title, text, confirm, cancel, isDelete) => { confirmations.push({title, text, confirm, cancel, isDelete}); },
    });
    removeAnno(pdf, element, "annotation");
    return {requests, confirmations, config, pdf, element, removed: () => removed, replaceViewer: () => { registered = {}; }};
};

test("referenced PDF annotations remain intact until deletion is confirmed", () => {
    const state = setup("http://localhost/assets/document.pdf?box=20261003000000-abcdefg");
    const query = state.requests[0];
    assert.equal(query.url, "/api/block/getRefIDsByFileAnnotationID");
    assert.equal(query.data.id, "annotation");
    assert.equal(query.data.notebook, "20261003000000-abcdefg");
    query.callback({code: 0, data: {refDefs: [{refID: "first"}, {refID: "second"}]}});
    assert.equal(state.requests.length, 1);
    assert.equal(state.removed(), 0);
    assert.ok(state.config.annotation);
    const confirmation = state.confirmations[0];
    assert.equal(confirmation.text, "Referenced by 2 blocks");
    assert.equal(confirmation.isDelete, true);
    // 确认时读取最新配置，保留等待期间新增的标注。
    state.config.latest = {page: 3};
    confirmation.confirm();
    assert.equal(state.removed(), 1);
    assert.equal(state.config.annotation, undefined);
    const save = state.requests[1];
    assert.equal(save.url, "/api/asset/setFileAnnotation");
    assert.equal(save.data.path, "assets/document.pdf?box=20261003000000-abcdefg.sya");
    assert.deepEqual(JSON.parse(save.data.data), {other: {page: 2}, latest: {page: 3}});
});

test("unreferenced PDF annotations are deleted without a confirmation", () => {
    const state = setup();
    assert.equal(state.requests[0].data.notebook, "");
    state.requests[0].callback({code: 0, data: {refDefs: []}});
    assert.equal(state.confirmations.length, 0);
    assert.equal(state.removed(), 1);
    assert.equal(state.requests[1].data.path, "assets/document.pdf.sya");
});

test("a failed reference query preserves PDF annotations", () => {
    const state = setup();
    state.requests[0].callback({code: -1});
    assert.equal(state.requests.length, 1);
    assert.ok(state.config.annotation);
    assert.equal(state.removed(), 0);
});

test("closing or replacing the PDF viewer prevents delayed annotation deletion", () => {
    for (const invalidate of [state => { state.element.isConnected = false; }, state => { state.replaceViewer(); },
        state => { state.pdf.appConfig.file = "http://localhost/assets/other.pdf"; }]) {
        const pending = setup();
        invalidate(pending);
        pending.requests[0].callback({code: 0, data: {refDefs: []}});
        assert.equal(pending.removed(), 0);
        assert.equal(pending.requests.length, 1);
        const confirmed = setup();
        confirmed.requests[0].callback({code: 0, data: {refDefs: [{refID: "block"}]}});
        invalidate(confirmed);
        confirmed.confirmations[0].confirm();
        assert.equal(confirmed.removed(), 0);
        assert.ok(confirmed.config.annotation);
    }
});
