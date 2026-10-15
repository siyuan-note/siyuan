const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {test} = require("node:test");

test("test runner prepares Electron before workers and stops on installation failure", t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-test-runner-"));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const write = (name, content) => {
        const target = path.join(root, name);
        fs.mkdirSync(path.dirname(target), {recursive: true});
        fs.writeFileSync(target, content);
    };
    write("scripts/test.mjs", fs.readFileSync(path.join(__dirname, "test.mjs")));
    write("node_modules/tsx/package.json", JSON.stringify({name: "tsx", main: "index.js"}));
    write("node_modules/tsx/index.js", "");
    write("node_modules/electron/index.js", `
        const fs = require("node:fs");
        if (process.env.SIYUAN_TEST_INSTALL_FAILURE === "1") {
            throw new Error("Electron installation failed");
        }
        fs.appendFileSync("installations", "prepared\\n");
        module.exports = "electron";
    `);
    // 每类测试均检查父进程已完成准备，不能依靠某个测试抢先安装。
    for (const name of ["src/worker.test.ts", "tests/worker.test.js", "electron/worker.test.js", "scripts/worker.test.js"]) {
        write(name, `
            const fs = require("node:fs");
            require("node:assert/strict").equal(fs.readFileSync("installations", "utf8"), "prepared\\n");
            fs.appendFileSync("workers", "started\\n");
        `);
    }
    const env = {...process.env};
    delete env.NODE_TEST_CONTEXT;
    const run = failure => spawnSync(process.execPath, ["scripts/test.mjs"], {
        cwd: root, encoding: "utf8", timeout: 30000,
        env: {...env, SIYUAN_TEST_INSTALL_FAILURE: failure ? "1" : "0"},
    });
    const success = run(false);
    assert.equal(success.status, 0, success.stdout + success.stderr);
    assert.equal(fs.readFileSync(path.join(root, "installations"), "utf8"), "prepared\n");
    assert.equal(fs.readFileSync(path.join(root, "workers"), "utf8").trim().split("\n").length, 4);
    fs.unlinkSync(path.join(root, "workers"));
    const failure = run(true);
    assert.notEqual(failure.status, 0);
    assert.match(failure.stderr, /Electron installation failed/);
    assert.equal(fs.existsSync(path.join(root, "workers")), false);
});
