const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(codes = [0, 0]) {
    const calls = [];
    let active = 0;
    let maximum = 0;
    const env = {SIYUAN_RELEASE_SIGN_PIN: "test-secret", PSModulePath: "foreign-modules"};
    const context = {
        exports: {}, __dirname, setTimeout, clearTimeout,
        process: {env, stdout: {write() {}}},
        require(name) {
            if (name === "node:path") { return path; }
            assert.equal(name, "node:child_process");
            return {spawn(executable, args, options) {
                assert.equal(executable, "powershell.exe");
                assert.ok(args.includes("-NonInteractive"));
                assert.equal(options.env.SIYUAN_RELEASE_SIGN_PIN, undefined);
                assert.equal(options.env.PSModulePath, undefined);
                assert.ok(!args.join(" ").includes("test-secret"));
                const child = new EventEmitter();
                child.stdout = new EventEmitter();
                child.stderr = new EventEmitter();
                child.stdin = new EventEmitter();
                child.stdin.end = value => {
                    calls.push(JSON.parse(value));
                    active += 1;
                    maximum = Math.max(maximum, active);
                    setImmediate(() => {
                        active -= 1;
                        child.stderr.emit("data", Buffer.from("test-secret"));
                        child.emit("close", codes.shift());
                    });
                };
                return child;
            }};
        },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "release-sign-windows.cjs"), "utf8"), context);
    assert.equal(env.SIYUAN_RELEASE_SIGN_PIN, undefined);
    return {sign: context.exports.default, calls, maximum: () => maximum};
}

const options = name => ({path: name, hash: "sha256", options: {signtoolOptions: {certificateSha1: "A".repeat(40)}}});

async function main() {
    const normal = load();
    await Promise.all([normal.sign(options("first.exe")), normal.sign(options("second.exe"))]);
    assert.equal(normal.maximum(), 1);
    assert.deepEqual(normal.calls.map(call => call.files[0]), ["first.exe", "second.exe"]);
    assert.equal(normal.calls[0].pin, "test-secret");
    const failed = load([1]);
    const errors = await Promise.allSettled([failed.sign(options("first.exe")), failed.sign(options("second.exe"))]);
    assert.equal(failed.calls.length, 1);
    assert.ok(errors.every(result => result.status === "rejected" && !result.reason.message.includes("test-secret")));
    const retry = load([20, 0]);
    await retry.sign(options("retry.exe"));
    assert.equal(retry.calls.length, 2);
    const exhausted = load([20, 20]);
    await assert.rejects(exhausted.sign(options("twice.exe")), /Hardware signing failed/);
    assert.equal(exhausted.calls.length, 2);
    const invalid = load();
    await assert.rejects(invalid.sign({...options("legacy.exe"), hash: "sha1"}), /configuration is invalid/);
    assert.equal(invalid.calls.length, 0);
    console.log("Windows signing hook tests passed");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
