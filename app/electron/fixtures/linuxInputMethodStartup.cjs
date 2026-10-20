const fs = require("node:fs");
const {spawnSync} = require("node:child_process");
const {app, BrowserWindow} = require("electron");
const {
    readLinuxInputMethodSetting, writeLinuxInputMethodSetting, readLinuxInputMethodArguments,
    prepareLinuxInputMethodLaunch, linuxInputMethodRelaunchEnvironment,
} = require("../linuxInputMethod");

const directory = process.env.SIYUAN_TEST_IME_DIRECTORY;
const settingFile = directory + "/setting.json";
const traceFile = directory + "/trace.jsonl";
app.setPath("userData", directory + "/user-data");
const record = (data) => fs.appendFileSync(traceFile, JSON.stringify({pid: process.pid, ...data}) + "\n");
const originalArgs = readLinuxInputMethodArguments();
const launch = prepareLinuxInputMethodLaunch(originalArgs,
    readLinuxInputMethodSetting(settingFile), process.platform, process.env[linuxInputMethodRelaunchEnvironment]);
record({event: "launch", override: launch.override, relaunch: launch.relaunchArgs !== null,
    originalArgs, currentArgs: process.argv, hasToken: Boolean(process.env[linuxInputMethodRelaunchEnvironment]),
    nativeSwitch: app.commandLine.getSwitchValue("ozone-platform")});
if (launch.relaunchArgs) {
    if (launch.relaunchToken) {
        process.env[linuxInputMethodRelaunchEnvironment] = launch.relaunchToken;
    } else {
        delete process.env[linuxInputMethodRelaunchEnvironment];
    }
    app.relaunch({args: launch.relaunchArgs});
    app.exit(0);
} else {
    app.whenReady().then(() => {
        const window = new BrowserWindow({show: false});
        const handle = window.getNativeWindowHandle();
        const id = handle.length === 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
        const x11 = spawnSync("xwininfo", ["-id", id.toString()], {timeout: 2000}).status === 0;
        record({event: "backend", x11, override: launch.override});
        window.destroy();
        if (process.env.SIYUAN_TEST_IME_DISABLE === "true" && readLinuxInputMethodSetting(settingFile)) {
            writeLinuxInputMethodSetting(settingFile, false);
            app.relaunch();
        } else {
            record({event: "complete"});
        }
        app.exit(0);
    }).catch(error => {
        record({event: "error", message: error.message});
        app.exit(1);
    });
}
