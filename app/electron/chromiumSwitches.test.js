const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const vm = require("node:vm");
const {appendChromiumSwitch} = require("./chromiumSwitches");
const {getUnsafeRemoteChromiumSwitchName, unsafeRemoteChromiumSwitchNames} = require("./remoteKernel");

const createCommandLine = (args = []) => {
    const values = new Map();
    const appendedSwitches = [];
    const commandLine = {
        appendedSwitches,
        appendSwitch: (name, value = "") => {
            appendedSwitches.push(name);
            values.set(name, value);
        },
        getSwitchValue: name => values.get(name) || "",
        hasSwitch: name => values.has(name),
        removeSwitch: name => values.delete(name),
    };
    for (const arg of args) {
        if (!arg.startsWith("--")) continue;
        const separator = arg.indexOf("=");
        commandLine.appendSwitch(arg.slice(2, separator < 0 ? undefined : separator),
            separator < 0 ? "" : arg.slice(separator + 1));
    }
    appendedSwitches.length = 0;
    return commandLine;
};

const source = readFileSync(path.join(__dirname, "main.js"), "utf8");
const start = source.indexOf('app.commandLine.appendSwitch("auto-detect"');
const end = source.indexOf("// 桌面端辅助功能配置", start);
const securityStart = source.indexOf("if (remoteKernelTarget) {");
const securityEnd = source.indexOf("const initialSiYuanOpenURL", securityStart);
assert.ok(start >= 0 && end > start && securityStart >= 0 && securityEnd > securityStart);

const startup = (args = [], {packaged = true, remote = false} = {}) => {
    const commandLine = createCommandLine(args);
    const context = vm.createContext({
        app: {commandLine, isPackaged: packaged},
        process: {argv: packaged ? ["SiYuan.exe", ...args] : ["electron.exe", "main.js", ...args]},
        linuxInputMethodLaunchArguments: packaged ? ["SiYuan.exe", ...args] : ["electron.exe", "main.js", ...args],
        appendChromiumSwitch,
        remoteKernelTarget: remote ? {mode: "remote"} : undefined,
        remoteKernelArgError: undefined,
        getUnsafeRemoteChromiumSwitchName,
        unsafeRemoteChromiumSwitchNames,
        openAsHidden: false,
        writeLog: () => {},
    });
    vm.runInContext(source.slice(securityStart, securityEnd), context);
    vm.runInContext(source.slice(start, end), context);
    return {commandLine, context};
};

test("default startup retains HTTP/2 and certificate verification caching", () => {
    const {commandLine} = startup();
    assert.equal(commandLine.hasSwitch("disable-http2"), false);
    assert.equal(commandLine.getSwitchValue("disable-features"), "AutoupgradeMixedContent");
    assert.equal(commandLine.getSwitchValue("enable-features"),
        "PlatformHEVCDecoderSupport,OriginKeyedProcessesByDefault");
});

test("explicit compatibility flags survive packaged and development startup", () => {
    for (const packaged of [true, false]) {
        const {commandLine} = startup(["--disable-http2", "--disable-features=CacheCertVerification"], {packaged});
        assert.equal(commandLine.hasSwitch("disable-http2"), true);
        assert.deepEqual(new Set(commandLine.getSwitchValue("disable-features").split(",")),
            new Set(["AutoupgradeMixedContent", "CacheCertVerification"]));
        assert.equal(commandLine.hasSwitch("ignore-certificate-errors"), false);
        assert.equal(commandLine.hasSwitch("allow-insecure-localhost"), false);
    }
});

test("feature lists merge multiple arguments and retain trial parameters without duplicates", () => {
    const {commandLine} = startup([
        "--disable-features=CacheCertVerification, AutoupgradeMixedContent,",
        "--disable-features=CalculateNativeWinOcclusion,CacheCertVerification",
        "--enable-features=ExampleFeature<ExampleTrial:param/value,OriginKeyedProcessesByDefault",
        "--enable-features=AnotherFeature",
    ]);
    const disabled = commandLine.getSwitchValue("disable-features").split(",");
    assert.equal(disabled.length, 3);
    assert.deepEqual(new Set(disabled),
        new Set(["AutoupgradeMixedContent", "CacheCertVerification", "CalculateNativeWinOcclusion"]));
    const enabled = commandLine.getSwitchValue("enable-features").split(",");
    assert.equal(enabled.length, 4);
    assert.ok(enabled.includes("ExampleFeature<ExampleTrial:param/value"));
    assert.ok(enabled.includes("PlatformHEVCDecoderSupport"));
});

test("switch values retain spaces and additional equals signs", () => {
    const commandLine = createCommandLine();
    appendChromiumSwitch(commandLine, "--proxy-server=https=127.0.0.1:8080;http=127.0.0.1:8081");
    appendChromiumSwitch(commandLine, "--log-file=C:/logs with spaces/network.log");
    appendChromiumSwitch(commandLine, "--empty-value=");
    appendChromiumSwitch(commandLine, "--disable-http2");
    assert.equal(commandLine.getSwitchValue("proxy-server"), "https=127.0.0.1:8080;http=127.0.0.1:8081");
    assert.equal(commandLine.getSwitchValue("log-file"), "C:/logs with spaces/network.log");
    assert.equal(commandLine.hasSwitch("empty-value"), true);
    assert.equal(commandLine.hasSwitch("disable-http2"), true);
    assert.equal(appendChromiumSwitch(commandLine, "--"), false);
    assert.equal(appendChromiumSwitch(commandLine, "C:/notes/file"), false);
});

test("application flags are not forwarded as Chromium switches", () => {
    const {commandLine, context} = startup(["--workspace=C:/notes", "--port=6806", "--openAsHidden"]);
    assert.equal(commandLine.appendedSwitches.includes("workspace"), false);
    assert.equal(commandLine.appendedSwitches.includes("port"), false);
    assert.equal(commandLine.appendedSwitches.includes("openAsHidden"), false);
    assert.equal(context.openAsHidden, true);
});

test("remote startup keeps unsafe switches blocked before feature lists are merged", () => {
    for (const unsafe of ["--ignore-certificate-errors", "--disable-web-security",
        "--disable-features=IsolateOrigins,CacheCertVerification",
        "--disable-features=IsolateOrigins<ExampleTrial,CacheCertVerification"]) {
        const {commandLine, context} = startup([unsafe, "--disable-http2"], {remote: true});
        assert.equal(context.remoteKernelArgError.code, "ERR_REMOTE_UNSAFE_CHROMIUM_SWITCH");
        assert.equal(commandLine.hasSwitch("ignore-certificate-errors"), false);
        assert.equal(commandLine.hasSwitch("disable-web-security"), false);
        assert.equal(commandLine.getSwitchValue("disable-features"), "AutoupgradeMixedContent");
    }
    const {commandLine, context} = startup(["--disable-http2", "--disable-features=CacheCertVerification"], {remote: true});
    assert.equal(context.remoteKernelArgError, undefined);
    assert.equal(commandLine.hasSwitch("ignore-certificate-errors"), false);
    assert.equal(commandLine.hasSwitch("no-proxy-server"), false);
});
