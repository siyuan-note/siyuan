const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawn, spawnSync} = require("node:child_process");
const {setTimeout: delay} = require("node:timers/promises");
const {test} = require("node:test");
const {writeLinuxInputMethodSetting} = require("./linuxInputMethod");

const supported = process.platform === "linux" && process.env.WAYLAND_DISPLAY &&
    fs.existsSync(path.join(process.env.XDG_RUNTIME_DIR || "", process.env.WAYLAND_DISPLAY)) &&
    spawnSync("xwininfo", ["-version"]).status === 0;

for (const scenario of [
    {name: "enabled", enabled: true, x11: [true], launches: 2, override: null},
    {name: "disabled", enabled: false, x11: [false], launches: 1, override: null},
    {name: "explicit-x11", enabled: false, args: ["--ozone-platform=x11"], x11: [true], launches: 1, override: true},
    {name: "explicit-wayland", enabled: true, args: ["--ozone-platform=wayland"], x11: [false], launches: 1, override: false},
    {name: "disable-after-relaunch", enabled: true, disable: true, x11: [true, false], launches: 4, override: null},
]) {
    test(`native Linux input method startup: ${scenario.name}`, {skip: !supported, timeout: 30000}, async (t) => {
        const binary = process.env.SIYUAN_TEST_ELECTRON_BINARY || require("electron");
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-native-ime-"));
        const traceFile = path.join(directory, "trace.jsonl");
        writeLinuxInputMethodSetting(path.join(directory, "setting.json"), scenario.enabled);
        const child = spawn(binary, [path.join(__dirname, "fixtures/linuxInputMethodStartup.cjs"),
            "--no-sandbox", "--disable-gpu", ...scenario.args || []], {
            env: {...process.env, XDG_SESSION_TYPE: "wayland", SIYUAN_TEST_IME_DIRECTORY: directory,
                SIYUAN_TEST_IME_DISABLE: String(scenario.disable || false), SIYUAN_LINUX_INPUT_METHOD_RELAUNCH: ""},
            stdio: ["ignore", "ignore", "pipe"], windowsHide: true,
        });
        let stderr = "";
        child.stderr.on("data", chunk => { stderr += chunk.toString(); });
        let launchError;
        child.on("error", error => { launchError = error; });
        let trace = [];
        t.after(() => {
            for (const pid of new Set([child.pid, ...trace.map(row => row.pid)])) {
                if (pid) {
                    try { process.kill(pid, "SIGKILL"); } catch (error) {
                        if (error.code !== "ESRCH") {
                            throw error;
                        }
                    }
                }
            }
            fs.rmSync(directory, {recursive: true, force: true});
        });
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
            if (launchError) {
                throw launchError;
            }
            if (fs.existsSync(traceFile)) {
                const content = fs.readFileSync(traceFile, "utf8");
                trace = content.slice(0, content.lastIndexOf("\n")).split("\n").filter(Boolean).map(line => JSON.parse(line));
                if (trace.some(row => row.event === "complete" || row.event === "error")) {
                    break;
                }
            }
            await delay(50);
        }
        assert.ok(trace.some(row => row.event === "complete"), JSON.stringify(trace) + stderr);
        assert.equal(trace.filter(row => row.event === "launch").length, scenario.launches);
        const backends = trace.filter(row => row.event === "backend");
        assert.deepEqual(backends.map(row => row.x11), scenario.x11);
        assert.ok(backends.every(row => row.override === scenario.override));
    });
}
