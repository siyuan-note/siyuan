const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {test} = require("node:test");
const {execFile} = require("node:child_process");
const {promisify} = require("node:util");
const {replaceFile, preserveOwnership} = require("./replaceFile");

const execute = promisify(execFile);
const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const setup = async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "siyuan-replace-"));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    return name => path.join(directory, name);
};

test("Windows replacement preserves explicit DACL, creation time and alternate data streams", {skip: process.platform !== "win32"}, async t => {
    const file = await setup(t);
    const source = file("new.md"), destination = file("original.md"), backup = file("original.backup");
    await fs.writeFile(source, "new content");
    await fs.writeFile(destination, "old content");
    await fs.writeFile(destination + ":siyuan-test", "stream content");
    const acl = async action => {
        const result = await execute(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
            path.join(__dirname, "replaceFile.test.ps1"), "-Target", destination, "-Action", action], {windowsHide: true});
        return result.stdout.trim();
    };
    const before = await acl("protect");
    const creation = (await fs.stat(destination)).birthtimeMs;
    await replaceFile(source, destination, backup);
    assert.equal(await fs.readFile(destination, "utf8"), "new content");
    assert.equal(await fs.readFile(backup, "utf8"), "old content");
    assert.equal(await fs.readFile(destination + ":siyuan-test", "utf8"), "stream content");
    assert.equal(await acl("read"), before);
    assert.equal((await fs.stat(destination)).birthtimeMs, creation);
    await assert.rejects(fs.stat(source), {code: "ENOENT"});
});

test("Windows execution failure leaves the original content and staging file intact", {skip: process.platform !== "win32"}, async t => {
    const file = await setup(t);
    await fs.writeFile(file("original.md"), "original");
    await fs.writeFile(file("staging.tmp"), "staging");
    await assert.rejects(replaceFile(file("absent.tmp"), file("original.md"), file("backup.tmp")));
    assert.equal(await fs.readFile(file("original.md"), "utf8"), "original");
    assert.equal(await fs.readFile(file("staging.tmp"), "utf8"), "staging");
});

test("Windows replacement uses fixed script and literal argv with no shell", async () => {
    const source = "C:\\notes\\$(whoami) [1].tmp";
    const destination = "C:\\notes\\literal; name.md";
    let called = false;
    await replaceFile(source, destination, "backup", {platform: "win32", run: async (_program, args, options) => {
        called = true;
        assert.equal(args[args.indexOf("-Source") + 1], source);
        assert.equal(args[args.indexOf("-Destination") + 1], destination);
        assert.equal(options.shell, false);
        assert.equal(options.windowsHide, true);
        assert.equal(args.includes("-Command"), false);
    }});
    assert.equal(called, true);
});

test("POSIX replacement preserves ownership before mode and rejects an ownership failure", async () => {
    const events = [];
    const file = {stat: async () => ({uid: 1n, gid: 2n}), chown: async (uid, gid) => events.push(["owner", uid, gid]),
        chmod: async mode => events.push(["mode", mode])};
    const original = {identity: "existing", uid: 3, gid: 4, mode: 0o640};
    await preserveOwnership(file, original, {platform: "linux"});
    assert.deepEqual(events, [["owner", 3, 4], ["mode", 0o640]]);
    await assert.rejects(preserveOwnership({...file, chown: async () => { throw new Error("denied"); },
        chmod: () => assert.fail("mode changed after ownership failure")}, original, {platform: "linux"}), /denied/);
});
