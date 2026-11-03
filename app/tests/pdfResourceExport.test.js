const assert = require("node:assert/strict");
const {readFileSync, writeFileSync, mkdtempSync, readdirSync, mkdirSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const {savePDF} = require("../src/protyle/export/savePDF.ts");

const source = readFileSync(path.join(__dirname, "../src/boot/onGetConfig.ts"), "utf8");
const start = source.indexOf("    ipcRenderer.on(Constants.SIYUAN_EXPORT_PDF,");
const end = source.indexOf("    if (isWindow())", start);
assert.ok(start > 0 && end > start);
const compiled = ts.transpileModule(source.slice(start, end), {
    compilerOptions: {target: ts.ScriptTarget.ES2021},
}).outputText;

for (const removeAssets of [false, true]) {
    test(`PDF export delegates linked resources without copying HTML or removing directories (embed=${removeAssets})`, async () => {
        for (const code of [0, -1]) {
            const events = [];
            const directory = mkdtempSync(path.join(os.tmpdir(), "siyuan-pdf-save-"));
            const filePath = path.join(directory, "custom-name.pdf");
            writeFileSync(filePath, "ORIGINAL");
            mkdirSync(path.join(directory, "assets"));
            writeFileSync(path.join(directory, "assets", "existing.txt"), "ASSET");
            let handler;
            global.window = {siyuan: {storage: {}, config: {export: {pdfFooter: ""}}, languages: {}}};
            try {
                const register = new Function("ipcRenderer", "Constants", "getHostCapabilities", "setLastExportPath",
                    "showMessage", "setStorageVal", "fetchSyncPost", "path", "savePDF", "afterExport", compiled);
                register({on: (_name, callback) => handler = callback,
                    invoke: async () => Buffer.from("PDF"), send: (...args) => events.push(["ipc", ...args])},
                {SIYUAN_EXPORT_PDF: "pdf", SIYUAN_GET: "get", SIYUAN_CMD: "cmd", LOCAL_EXPORTPDF: "pdf"},
                () => ({importExport: true}), savedPath => assert.equal(savedPath, directory),
                (message, _duration, type) => { events.push(["message", message, type]); return "export-msg"; },
                () => {}, async (url, request) => {
                    events.push(["request", url, request]);
                    assert.equal(url, "/api/export/processPDF");
                    assert.equal(path.dirname(request.path), directory);
                    assert.notEqual(request.path, filePath);
                    assert.equal(readFileSync(filePath, "utf8"), "ORIGINAL");
                    assert.equal(readFileSync(request.path, "utf8"), "PDF");
                    assert.equal(request.exportAssets, true);
                    assert.equal(request.removeAssets, removeAssets);
                    writeFileSync(request.path, "PROCESSED");
                    return {code, msg: "Resource failure"};
                }, path, savePDF, savedFile => {assert.equal(savedFile, filePath); events.push(["success"]);});
                await handler(undefined, {filePath, rootId: "root",
                    pdfOptions: {margins: {}}, removeAssets, titleImage: false, headingPageBreakLevels: []});
                assert.equal(events.filter(event => event[0] === "success").length, code === 0 ? 1 : 0);
                assert.equal(readFileSync(filePath, "utf8"), code === 0 ? "PROCESSED" : "ORIGINAL");
                assert.deepEqual(readdirSync(directory).sort(), ["assets", "custom-name.pdf"]);
                assert.equal(readFileSync(path.join(directory, "assets", "existing.txt"), "utf8"), "ASSET");
                if (code !== 0) assert.ok(events.some(event => event[0] === "message" && event[1] === "Resource failure"));
            } finally {
                delete global.window;
                rmSync(directory, {recursive: true, force: true});
            }
        }
    });
}
