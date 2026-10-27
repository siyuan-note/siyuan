const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const ts = require("typescript");

const source = ts.createSourceFile("anno.ts", readFileSync("src/asset/anno.ts", "utf8"), ts.ScriptTarget.ES2021, true);
const names = new Set(["annotationSaveQueues", "getAnnotationSaveQueue", "saveConfig", "getConfig", "setConfig"]);
const code = source.statements.filter(statement => ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => names.has(item.name.getText(source))))
    .map(statement => statement.getText(source)).join("\n");
const transpile = text => ts.transpileModule(text, {compilerOptions: {target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS}}).outputText;
const queueExports = {};
new Function("exports", transpile(readFileSync("src/asset/annotationSave.ts", "utf8")))(queueExports);

const setup = config => {
    const requests = [], reads = [], messages = [];
    const pdf = {appConfig: {file: "http://localhost/assets/document.pdf?box=20261003000000-abcdefg", config}};
    const api = runInNewContext(transpile(code + "\n({getConfig, setConfig});"), {
        AnnotationSaveQueue: queueExports.AnnotationSaveQueue,
        location: {origin: "http://localhost"},
        window: {siyuan: {languages: {pdfAnnotationSaveFailed: "Reopen the PDF"}}},
        showMessage: message => messages.push(message),
        fetchPost: (url, data, callback) => reads.push({url, data, callback}),
        fetchSyncPost: async (url, data) => { requests.push({url, data}); return {code: 0, msg: ""}; },
    });
    return {api, pdf, requests, reads, messages};
};

test("annotation saves keep the pre-edit baseline and notebook-qualified path", async () => {
    const state = setup({old: {content: "original"}});
    state.api.setConfig(state.pdf, "new", {content: "addition"});
    await new Promise(resolve => setImmediate(resolve));
    const request = state.requests[0];
    assert.equal(request.url, "/api/asset/setFileAnnotation");
    assert.equal(request.data.path, "assets/document.pdf?box=20261003000000-abcdefg.sya");
    assert.deepEqual(JSON.parse(request.data.baseData), {old: {content: "original"}});
    assert.deepEqual(JSON.parse(request.data.data), {old: {content: "original"}, new: {content: "addition"}});
});

test("loaded snapshots initialize the baseline, while stale or invalid reads cannot replace local state", async () => {
    const state = setup(undefined);
    state.api.getConfig(state.pdf);
    const read = state.reads[0];
    assert.equal(read.data.path, "assets/document.pdf?box=20261003000000-abcdefg.sya");
    read.callback({code: 0, data: {data: '{"old":{"content":"loaded"}}'}});
    state.api.setConfig(state.pdf, "new", {content: "new"});
    read.callback({code: 0, data: {data: "{}"}});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.pdf.appConfig.config.old.content, "loaded");
    assert.deepEqual(JSON.parse(state.requests[0].data.baseData), {old: {content: "loaded"}});
    for (const raw of ["broken", "null", "[]"]) {
        const invalid = setup(undefined);
        invalid.api.getConfig(invalid.pdf);
        invalid.reads[0].callback({code: 0, data: {data: raw}});
        assert.equal(invalid.pdf.appConfig.config, undefined);
        assert.equal(invalid.messages.length, 1);
        assert.equal(invalid.requests.length, 0);
    }
    const replaced = setup(undefined);
    replaced.api.getConfig(replaced.pdf);
    replaced.pdf.appConfig.file = "http://localhost/assets/other.pdf";
    replaced.reads[0].callback({code: 0, data: {data: "{}"}});
    assert.equal(replaced.pdf.appConfig.config, undefined);
});
