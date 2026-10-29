const {test} = require("node:test");
const assert = require("node:assert/strict");
const {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function fixture(t) {
    const root = mkdtempSync(path.join(os.tmpdir(), "siyuan-harmony-test-"));
    t.after(() => {
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        rmSync(root, {recursive: true, force: true});
    });
    const write = (name, content = "fixture") => {
        const file = path.join(root, name);
        mkdirSync(path.dirname(file), {recursive: true});
        writeFileSync(file, content);
        return file;
    };
    const native = path.join(root, "native project");
    write("native project/AppScope/app.json5");
    const hap = "native project/entry/build/debug/outputs/default/entry-default-signed.hap";
    const args = [`--harmony-dir=${native}`, "--hdc=test-hdc"];
    return {root, write, native, hap, args};
}

test("Harmony arguments reject unknown/empty values and preserve paths containing spaces", async () => {
    const {parseArgs} = await import("../../scripts/harmony-dev-run.mjs");
    assert.throws(() => parseArgs(["--skip-gradle"], {}), /Unknown/);
    assert.throws(() => parseArgs(["--device="], {}), /empty/);
    const options = parseArgs(["--device=127.0.0.1:1234", "--skip-hvigor"], {SIYUAN_HARMONY_DIR: "native project"});
    assert.equal(options.harmonyDir, path.resolve("native project"));
    assert.equal(options.device, "127.0.0.1:1234");
    assert.equal(options.skipHvigor, true);
});

test("Harmony requires an explicit choice for multiple devices and rejects missing targets", async () => {
    const {selectDevice} = await import("../../scripts/harmony-dev-run.mjs");
    assert.equal(selectDevice("device-a\r\n"), "device-a");
    assert.equal(selectDevice("a\nb\n", "b"), "b");
    assert.throws(() => selectDevice("[Empty]\n"), /found none/);
    assert.throws(() => selectDevice("a\nb\n"), /--device/);
    assert.throws(() => selectDevice("a\n", "b"), /not found/);
});

test("Harmony Windows build environment retains system paths and merges differently cased path keys", async () => {
    const {createBuildEnvironment} = await import("../../scripts/harmony-dev-run.mjs");
    const inherited = {Path: "C:\\Windows\\System32", PATH: "C:\\custom-tools", ComSpec: "C:\\Windows\\System32\\cmd.exe"};
    const result = createBuildEnvironment("D:\\DevEco", "D:\\DevEco\\tools\\node\\node.exe", inherited, "win32");
    assert.equal(result.PATH, "D:\\DevEco\\tools\\node;C:\\Windows\\System32;C:\\custom-tools");
    assert.deepEqual(Object.keys(result).filter(key => key.toLowerCase() === "path"), ["PATH"]);
    assert.equal(result.ComSpec, inherited.ComSpec);
    assert.equal(result.JAVA_HOME, "D:\\DevEco\\jbr");
    assert.equal(result.DEVECO_SDK_HOME, "D:\\DevEco\\sdk");
    assert.equal(inherited.Path, "C:\\Windows\\System32");
    assert.equal(inherited.PATH, "C:\\custom-tools");
    for (const key of ["PATH", "Path", "path"]) {
        const env = createBuildEnvironment("D:\\DevEco", "D:\\DevEco\\tools\\node\\node.exe", {[key]: "C:\\Windows\\System32"}, "win32");
        assert.equal(env.PATH, "D:\\DevEco\\tools\\node;C:\\Windows\\System32");
    }
});

test("Harmony Linux build environment respects case-sensitive environment keys", async () => {
    const {createBuildEnvironment} = await import("../../scripts/harmony-dev-run.mjs");
    const result = createBuildEnvironment("/opt/deveco", "/opt/deveco/tools/node/bin/node", {PATH: "/usr/bin:/bin", Path: "custom"}, "linux");
    assert.equal(result.PATH, "/opt/deveco/tools/node/bin:/usr/bin:/bin");
    assert.equal(result.Path, "custom");
    assert.equal(result.JAVA_HOME, "/opt/deveco/jbr");
});

test("Harmony child Node can launch cmd.exe with inherited Windows system paths", {skip: process.platform !== "win32"}, async () => {
    const {createBuildEnvironment} = await import("../../scripts/harmony-dev-run.mjs");
    const {spawnSync} = require("node:child_process");
    const inherited = {...process.env};
    for (const key of Object.keys(inherited)) {
        if (key.toLowerCase() === "path") delete inherited[key];
    }
    inherited.Path = path.join(process.env.SystemRoot, "System32");
    const probe = env => {
        const result = spawnSync(process.execPath, ["-e", `
            const result = require("node:child_process").spawnSync("cmd.exe", ["/d", "/s", "/c", "exit 0"]);
            process.stdout.write(JSON.stringify({status: result.status, error: result.error?.code}));
        `], {env, encoding: "utf8"});
        assert.equal(result.status, 0, result.stderr);
        return JSON.parse(result.stdout);
    };
    assert.equal(probe({...inherited, PATH: path.dirname(process.execPath)}).error, "ENOENT");
    assert.deepEqual(probe(createBuildEnvironment("D:\\DevEco", process.execPath, inherited)), {status: 0});
});

test("Harmony kernel validation rejects emulator and invalid libraries", async t => {
    const {checkKernel} = await import("../../scripts/harmony-dev-run.mjs");
    const {write} = fixture(t);
    const header = Buffer.alloc(64);
    Buffer.from("7f454c460201", "hex").copy(header);
    header.writeUInt16LE(183, 18);
    assert.doesNotThrow(() => checkKernel(write("arm.so", header)));
    header.writeUInt16LE(62, 18);
    assert.throws(() => checkKernel(write("x86.so", header)), /ARM64/);
    assert.throws(() => checkKernel(write("bad.so")), /ARM64/);
});

test("Harmony reinstall skips all build tools and targets the debug bundle", async t => {
    const {main} = await import("../../scripts/harmony-dev-run.mjs");
    const {root, write, hap, args} = fixture(t);
    write(hap);
    const calls = [];
    main([...args, "--skip-hvigor"], (command, argv) => {
        calls.push([command, argv]);
        return {status: 0, stdout: calls.length === 1 ? "phone\n" : calls.length === 2 ?
            "install bundle successfully.\n" : "start ability successfully.\n"};
    }, root);
    assert.equal(calls.length, 3);
    assert.equal(calls[1][0], "test-hdc");
    assert.deepEqual(calls[1][1], ["-t", "phone", "install", "-r", path.join(root, hap)]);
    assert.ok(calls[2][1].includes("org.b3log.siyuan.ho.debug"));
    assert.ok(calls[2][1].includes("EntryAbility"));
});

test("Harmony stops on missing signed HAP, tool errors and zero-exit installation failures", async t => {
    const {main} = await import("../../scripts/harmony-dev-run.mjs");
    const {root, write, hap, args} = fixture(t);
    const runArgs = [...args, "--skip-hvigor"];
    assert.throws(() => main(runArgs, () => ({status: 0, stdout: "phone\n"}), root), /Missing or empty/);
    write(hap);
    assert.throws(() => main(runArgs, () => ({status: null, error: new Error("ENOENT")}), root), /ENOENT/);
    let calls = 0;
    assert.throws(() => main(runArgs, () => ({status: 0, stdout: ++calls === 1 ? "phone\n" :
        "[Fail] signature mismatch\n"}), root), /did not confirm installation/);
    assert.equal(calls, 2);
    calls = 0;
    assert.throws(() => main(runArgs, () => ({status: 0, stdout: ++calls === 1 ? "phone\n" : calls === 2 ?
        "install bundle successfully.\n" : "error: failed to start ability\n"}), root), /ability startup/);
});

test("Harmony workspace translation preserves local modules, replacements and toolchain directives", async () => {
    const {translateWorkspace} = await import("../../scripts/harmony-dev-run.mjs");
    const directory = path.resolve("workspace");
    const result = translateWorkspace({Go: "1.26.10", Toolchain: "go1.26.10", Godebug: [{Key: "default", Value: "go1.26"}],
        Use: [{DiskPath: "./kernel"}, {DiskPath: path.resolve("local lute")}], Replace: [
            {Old: {Path: "example.org/a", Version: "v1.0.0"}, New: {Path: "../local-a"}},
            {Old: {Path: "example.org/b"}, New: {Path: "example.org/c", Version: "v1.2.0"}},
        ]}, directory, value => "/linux/" + path.basename(value));
    assert.equal(result, "go 1.26.10\ntoolchain go1.26.10\ngodebug default=go1.26\n" +
        "use \"/linux/kernel\"\nuse \"/linux/local lute\"\n" +
        "replace example.org/a v1.0.0 => \"/linux/local-a\"\nreplace example.org/b => example.org/c v1.2.0\n");
});

for (const {reuse, workspace, failKernel} of [{reuse: true, workspace: false}, {reuse: false, workspace: false},
    {reuse: false, workspace: true}, {reuse: false, workspace: true, failKernel: true}]) {
test(`Harmony build handles resources and workspace (reuse=${reuse}, workspace=${workspace}, failure=${!!failKernel})`, async t => {
    const {main} = await import("../../scripts/harmony-dev-run.mjs");
    const {root, native, write, hap, args} = fixture(t);
    const deveco = path.join(root, "DevEco Studio");
    for (const name of [process.platform === "win32" ? "node.exe" : "bin/node"]) write(`DevEco Studio/tools/node/${name}`);
    write("DevEco Studio/tools/hvigor/bin/hvigorw.js");
    write("DevEco Studio/tools/ohpm/bin/pm-cli.js");
    write("app/stage/build/mobile/index.html");
    write("app/stage/build/desktop/index.html");
    write("app/stage/build/export/protyle-method.js");
    write("app/stage/build/export/base.css");
    write("app/stage/ocr/models/tiny/det/inference.onnx");
    write("app/stage/ocr/models/tiny/rec/inference.onnx");
    write("app/stage/ocr/runtime/desktop/lib.so");
    write("native project/entry/src/main/resources/rawfile/app.zip");
    write("native project/entry/libs/arm64-v8a/libonnxruntime.so");
    write("native project/entry/src/main/cpp/include/libkernel.h");
    const header = Buffer.alloc(64);
    Buffer.from("7f454c460201", "hex").copy(header);
    header.writeUInt16LE(183, 18);
    write("kernel/harmony/libkernel.so", header);
    write("kernel/harmony/libkernel.h", "kernel header");
    write(hap, "stale HAP");
    const originalWork = write("go.work", "original workspace");
    write("go.work.sum", "original checksums");
    const translated = new Map();
    let temporaryWork;
    let list;
    const calls = [];
    const build = () => main([...args, `--deveco=${deveco}`, ...(reuse ? ["--skip-ui", "--skip-kernel"] : [])], (command, argv, settings) => {
        calls.push([command, argv]);
        assert.ok(!settings.shell);
        if (argv[0] === "list") return {status: 0, stdout: "phone\n"};
        if (command === "go") {
            return {status: 0, stdout: argv[0] === "env" ? (workspace ? originalWork : "off") :
                JSON.stringify({Go: "1.26.10", Use: [{DiskPath: "./kernel"}, {DiskPath: path.join(root, "local-lute")} ]})};
        }
        if (argv.includes("wslpath")) {
            assert.deepEqual(settings.stdio, ["inherit", "pipe", "inherit"]);
            const value = "/linux/" + path.basename(argv.at(-1));
            translated.set(value, argv.at(-1));
            return {status: 0, stdout: value + "\n"};
        }
        if (command === "wsl.exe" && argv.includes("--cd")) {
            assert.equal(argv[argv.indexOf("--cd") + 1], "/linux/harmony");
            assert.ok(argv.includes("pipefail"));
            assert.match(argv.at(-1), /harmony-kernel-build.sh/);
            const gowork = argv.find(value => value.startsWith("GOWORK="));
            if (workspace) {
                temporaryWork = translated.get(gowork.slice("GOWORK=".length));
                assert.match(readFileSync(temporaryWork, "utf8"), /use "\/linux\/local-lute"/);
                assert.equal(readFileSync(temporaryWork + ".sum", "utf8"), "original checksums");
            } else {
                assert.equal(gowork, "GOWORK=off");
            }
            if (failKernel) return {status: 1};
        }
        if (command === "tar") {
            list = argv[argv.indexOf("-T") + 1];
            const files = readFileSync(list, "utf8");
            assert.match(files, /stage\/build\/desktop\/index.html/);
            assert.match(files, /stage\/build\/export\/base.css/);
            assert.doesNotMatch(files, /ocr\/runtime/);
            writeFileSync(argv[argv.indexOf("-cf") + 1], "zip");
        }
        if (argv.includes("assembleHap")) {
            assert.equal(existsSync(path.join(root, hap)), false);
            assert.equal(settings.cwd, native);
            assert.ok(argv.includes("product=debug"));
            assert.ok(argv.includes("buildMode=debug"));
            assert.ok(argv.includes("module=entry@default"));
            assert.ok(settings.env.PATH.endsWith(process.env.PATH || process.env.Path || ""));
            if (process.platform === "win32") {
                assert.deepEqual(Object.keys(settings.env).filter(key => key.toLowerCase() === "path"), ["PATH"]);
            }
            write(hap);
        }
        return {status: 0, stdout: argv.includes("install") && command === "test-hdc" ?
            "install bundle successfully.\n" : argv.includes("start") ? "start ability successfully.\n" : ""};
    }, root);
    if (failKernel) {
        assert.throws(build, /wsl.exe failed/);
        assert.equal(existsSync(temporaryWork), false);
        assert.equal(readFileSync(originalWork, "utf8"), "original workspace");
        assert.ok(!calls.some(([, argv]) => argv.includes("assembleHap")));
        return;
    }
    build();
    assert.equal(existsSync(list), false);
    assert.deepEqual(readFileSync(path.join(native, "entry/libs/arm64-v8a/libkernel.so")), header);
    assert.equal(readFileSync(path.join(native, "entry/src/main/cpp/include/libkernel.h"), "utf8"), "kernel header");
    assert.ok(calls.some(([, argv]) => argv.includes("clean")));
    assert.ok(calls.some(([, argv]) => argv[0].endsWith("pm-cli.js")));
    assert.equal(readFileSync(originalWork, "utf8"), "original workspace");
    if (temporaryWork) assert.equal(existsSync(temporaryWork), false);
    assert.equal(calls.some(([command, argv]) => command === "pnpm" || argv.includes("pnpm run build:mobile")), !reuse);
    assert.equal(calls.some(([command]) => command === "wsl.exe" || command === "bash"), !reuse);
});
}
