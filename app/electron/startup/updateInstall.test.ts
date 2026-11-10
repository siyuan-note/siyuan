import {test} from "node:test";
import {createUpdateInstall} from "./updateInstall";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("desktop installation accepts shared and legacy packages and rejects other directories", (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-install-"));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const confDir = path.join(directory, "conf");
    const workspaceDir = path.join(directory, "workspace");
    const logs = [];
    const {validateUpdateInstallPackage: validate} = createUpdateInstall({
        confDir, platform: "win32", writeLog: message => logs.push(message),
    });
    const request = {workspaceDir};
    for (const [subdirectory, accepted] of [
        [path.join(confDir, "install"), true],
        [path.join(workspaceDir, "temp", "install"), true],
        [path.join(confDir, "install", "nested"), false],
        [path.join(directory, "unrelated"), false],
    ]) {
        fs.mkdirSync(subdirectory, {recursive: true});
        const file = path.join(subdirectory, "siyuan-99.0.0-win.exe");
        fs.writeFileSync(file, "package");
        assert.equal(validate(request, file), accepted ? fs.realpathSync(file) : undefined);
    }
    const invalid = path.join(confDir, "install", "notes.exe");
    fs.writeFileSync(invalid, "unrelated");
    assert.equal(validate(request, invalid), undefined);
    fs.mkdirSync(path.join(confDir, "install", "siyuan-99.0.1-win.exe"));
    assert.equal(validate(request, path.join(confDir, "install", "siyuan-99.0.1-win.exe")), undefined);
    fs.rmSync(path.join(workspaceDir, "temp", "install"), {recursive: true});
    assert.equal(validate(request, path.join(confDir, "install", "siyuan-99.0.0-win.exe")),
        fs.realpathSync(path.join(confDir, "install", "siyuan-99.0.0-win.exe")));
    // 被拒绝的请求都必须留下拒绝原因，便于排查更新安装失败。
    assert.ok(logs.some(message => /^rejected update install package outside the install directories/.test(message)));
    assert.ok(logs.some(message => /^rejected invalid update install package/.test(message)));
});
