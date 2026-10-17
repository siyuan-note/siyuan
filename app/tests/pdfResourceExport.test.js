const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

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
            let handler;
            global.window = {siyuan: {storage: {}, config: {export: {pdfFooter: ""}}, languages: {}}};
            try {
                const register = new Function("ipcRenderer", "Constants", "getHostCapabilities", "setLastExportPath",
                    "showMessage", "setStorageVal", "fetchSyncPost", "path", "replaceLocalPath", "fs", "afterExport", compiled);
                register({on: (_name, callback) => handler = callback,
                    invoke: async () => Buffer.from("PDF"), send: (...args) => events.push(["ipc", ...args])},
                {SIYUAN_EXPORT_PDF: "pdf", SIYUAN_GET: "get", SIYUAN_CMD: "cmd", LOCAL_EXPORTPDF: "pdf"},
                () => ({importExport: true}), () => {},
                (message, _duration, type) => { events.push(["message", message, type]); return "export-msg"; },
                () => {}, async (url, request) => {
                    events.push(["request", url, request]);
                    if (url === "/api/file/getUniqueFilename") return {code: 0, data: {path: request.path}};
                    assert.equal(url, "/api/export/processPDF");
                    assert.equal(request.exportAssets, true);
                    assert.equal(request.removeAssets, removeAssets);
                    return {code, msg: "Resource failure"};
                }, path, value => value,
                new Proxy({writeFileSync: (_file, data) => assert.equal(data.toString(), "PDF")}, {
                    get: (target, key) => {
                        assert.equal(key, "writeFileSync", "PDF export must not scan or delete destination assets");
                        return target[key];
                    },
                }), () => events.push(["success"]));
                await handler(undefined, {filePaths: [path.resolve("pdf-output")], rootTitle: "note", rootId: "root",
                    pdfOptions: {margins: {}}, removeAssets, titleImage: false, headingPageBreakLevels: []});
                assert.equal(events.filter(event => event[0] === "success").length, code === 0 ? 1 : 0);
                if (code !== 0) assert.ok(events.some(event => event[0] === "message" && event[1] === "Resource failure"));
            } finally {
                delete global.window;
            }
        }
    });
}
