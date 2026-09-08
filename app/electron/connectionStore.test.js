const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {connectionArgs, remotePartition, readConnections, writeConnections, closeConnectionWindows} = require("./connectionStore");

test("connection restart waits for every detached window to finish closing", async () => {
    const {EventEmitter} = require("node:events");
    const windows = [new EventEmitter(), new EventEmitter()];
    let completed = false;
    windows.forEach(window => {
        window.isDestroyed = () => false;
        window.close = () => { window.requested = true; };
    });
    const closing = closeConnectionWindows(windows).then(() => { completed = true; });
    assert.ok(windows.every(window => window.requested));
    windows[0].emit("closed");
    await Promise.resolve();
    assert.equal(completed, false);
    windows[1].emit("closed");
    await closing;
    assert.equal(completed, true);
});

test("switching removes stale connection flags and keeps unrelated launch settings", () => {
    const args = ["main.js", "--workspace=D:/notes", "--port=6806", "--safe-mode=1", "--openAsHidden",
        "--remote=https://a.example", "--trust-remote-extensions", "--ignore-certificate-errors",
        "--disable-web-security", "--no-proxy-server", "--lang=en", "siyuan://blocks/test", "--foo=bar"];
    assert.deepEqual(connectionArgs(args, {mode: "remote", origin: "https://B.example:443/", lang: "ja"},
        "https://a.example"), ["main.js", "--foo=bar", "--remote=https://b.example", "--lang=ja"]);
    assert.equal(connectionArgs(args, {mode: "local"}).some(arg => arg.startsWith("--remote")), false);
    assert.equal(connectionArgs(args, {mode: "remote", origin: "https://a.example"}, "https://a.example")
        .includes("--trust-remote-extensions"), true);
    assert.throws(() => connectionArgs(args, {mode: "remote", origin: "http://example.com"}));
    assert.throws(() => connectionArgs(args, {mode: "local", path: "relative"}));
    const localPath = path.join(os.tmpdir(), "notes with spaces");
    assert.ok(connectionArgs(args, {mode: "local", path: localPath}).includes("--workspace=" + localPath));
});

test("remote sessions isolate normalized origins including ports", () => {
    assert.equal(remotePartition("https://EXAMPLE.com:443/"), remotePartition("https://example.com"));
    assert.notEqual(remotePartition("https://example.com:8443"), remotePartition("https://example.com"));
    assert.notEqual(remotePartition("https://b.example.com"), remotePartition("https://example.com"));
    assert.match(remotePartition("https://example.com"), /^persist:siyuan-remote-[a-f0-9]{64}$/);
});

test("connection history preserves corrupt or unsupported files and writes atomically", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-connections-test-"));
    const file = path.join(directory, "connections.json");
    try {
        assert.deepEqual(readConnections(file), {version: 1, origins: [], migrated: []});
        writeConnections(file, {version: 1, origins: ["https://EXAMPLE.com:443/", "https://example.com"], migrated: []});
        assert.deepEqual(readConnections(file).origins, ["https://example.com"]);
        assert.deepEqual(fs.readdirSync(directory), ["connections.json"]);
        for (const contents of ["corrupt", '{"version":2,"origins":[]}',
            '{"version":1,"origins":["http://example.com"]}']) {
            fs.writeFileSync(file, contents);
            assert.throws(() => readConnections(file));
            assert.equal(fs.readFileSync(file, "utf8"), contents);
        }
    } finally {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        fs.rmSync(directory, {recursive: true, force: true});
    }
});
