import {readAppCrashInfo, clearAppCrashInfo} from "./crashHistory";
import {paths, configureRuntime} from "./runtime";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

for (const archiveFails of [false, true]) {
    test(`恢复后清除启动标记，留档失败不影响恢复：${archiveFails}`, (t) => {
        const confDir = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-crash-test-"));
        t.after(() => fs.rmSync(confDir, {recursive: true, force: true}));
        const appCrashMarkerPath = path.join(confDir, "app.crash.json");
        const appCrashLogPath = path.join(confDir, "app.crash.log");
        const logs = [];
        configureRuntime({
            ...paths, confDir, appCrashMarkerPath, appCrashLogPath,
            writeLog: message => logs.push(message),
        });
        const marker = JSON.stringify({reason: "crashed", workspaceDir: "workspace"});
        fs.writeFileSync(appCrashMarkerPath, marker);
        fs.writeFileSync(appCrashLogPath, "reason=crashed\n");
        if (archiveFails) {
            fs.writeFileSync(path.join(confDir, "crash-history"), "blocked");
        }
        assert.equal(readAppCrashInfo().workspaceDir, "workspace");
        clearAppCrashInfo();
        assert.equal(readAppCrashInfo(), undefined);
        assert.equal(fs.existsSync(appCrashMarkerPath), false);
        assert.equal(fs.existsSync(appCrashLogPath), false);
        if (!archiveFails) {
            assert.equal(fs.readFileSync(path.join(confDir, "crash-history", "app.crash.json"), "utf8"), marker);
            assert.equal(fs.readFileSync(path.join(confDir, "crash-history", "app.crash.log"), "utf8"), "reason=crashed\n");
            assert.deepEqual(logs, []);
        } else {
            // 留档失败只记录日志，不影响标记的清除；标记与日志各失败一次。
            assert.equal(logs.length, 2);
            logs.forEach(message => assert.match(message, /^archive crash info failed: /));
            assert.equal(fs.existsSync(path.join(confDir, "crash-history", "app.crash.json")), false);
        }
    });
}
