import {test} from "node:test";
import {collectWindowsTCPConfig} from "./kernelDiagnostics";
const assert = require("node:assert/strict");

test("platforms without netsh skip the probe", async () => {
    let called = 0;
    const lines = await collectWindowsTCPConfig({
        platform: "darwin",
        execFile: () => {
            called++;
        },
    });
    assert.deepEqual(lines, []);
    assert.equal(called, 0);
});

test("every probe records its output or failure", async () => {
    const lines = await collectWindowsTCPConfig({
        platform: "win32",
        execFile: (file, args, options, callback) => {
            assert.equal(file, "netsh.exe");
            assert.deepEqual(options, {timeout: 5000, windowsHide: true});
            if (args.includes("ipv6")) {
                callback(new Error("access denied"), "");
                return;
            }
            callback(null, "  output  \n");
        },
    });
    assert.equal(lines.length, 3);
    assert.equal(lines[0], "[tcp config] netsh int tcp show supplemental:\n  output");
    assert.equal(lines[2], "[tcp config] netsh int ipv6 show global failed: access denied");
});
