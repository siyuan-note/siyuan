const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
const start = source.indexOf("const readAppCrashInfo =");
const end = source.indexOf("\n};", source.indexOf("const clearAppCrashInfo =")) + 4;

for (const archiveFails of [false, true]) {
    test(`恢复后清除启动标记，留档失败不影响恢复：${archiveFails}`, (t) => {
        const confDir = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-crash-test-"));
        t.after(() => fs.rmSync(confDir, {recursive: true, force: true}));
        const appCrashMarkerPath = path.join(confDir, "app.crash.json");
        const appCrashLogPath = path.join(confDir, "app.crash.log");
        const marker = JSON.stringify({reason: "crashed", workspaceDir: "workspace"});
        fs.writeFileSync(appCrashMarkerPath, marker);
        fs.writeFileSync(appCrashLogPath, "reason=crashed\n");
        if (archiveFails) {
            fs.writeFileSync(path.join(confDir, "crash-history"), "blocked");
        }
        const context = vm.createContext({fs, path, confDir, appCrashMarkerPath, appCrashLogPath,
            noSafeModeReasons: new Set(), writeLog: () => {}});
        vm.runInContext(source.slice(start, end), context);
        assert.equal(vm.runInContext("readAppCrashInfo().workspaceDir", context), "workspace");
        vm.runInContext("clearAppCrashInfo()", context);
        assert.equal(vm.runInContext("readAppCrashInfo()", context), undefined);
        assert.equal(fs.existsSync(appCrashMarkerPath), false);
        assert.equal(fs.existsSync(appCrashLogPath), false);
        if (!archiveFails) {
            assert.equal(fs.readFileSync(path.join(confDir, "crash-history", "app.crash.json"), "utf8"), marker);
            assert.equal(fs.readFileSync(path.join(confDir, "crash-history", "app.crash.log"), "utf8"), "reason=crashed\n");
        }
    });
}
