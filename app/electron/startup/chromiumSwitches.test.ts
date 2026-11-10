import {test} from "node:test";
import {mockElectron, resetElectronStub} from "../fixtures/electronStub";
import type {App} from "electron";
const assert = require("node:assert/strict");

const modules = () => ({
    ...require("./chromiumSwitches"), ...require("./startupSwitches"),
});

const createCommandLine = (args = []) => {
    const values = new Map();
    const appendedSwitches = [];
    const commandLine = {
        appendedSwitches,
        appendSwitch: (name, value = "") => {
            appendedSwitches.push(name);
            values.set(name, value);
        },
        // 被测路径不使用位置参数，声明只为满足 CommandLine 的完整形状。
        appendArgument: (value: string) => { appendedSwitches.push(value); },
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

const startup = (t: any, args = [], {packaged = true, remote = false} = {}) => {
    const commandLine = createCommandLine(args);
    const argv = packaged ? ["SiYuan.exe", ...args] : ["electron.exe", "main.js", ...args];
    resetElectronStub();
    mockElectron(t, {app: {commandLine} as unknown as App});
    t.after(resetElectronStub);
    const {applyStartupSwitches, forwardCommandLineSwitches, rejectUnsafeRemoteSwitches} = modules();
    const context: {commandLine: typeof commandLine; remoteKernelArgError: {code?: string} | undefined;
        openAsHidden?: boolean} = {commandLine, remoteKernelArgError: undefined};
    if (remote) {
        context.remoteKernelArgError = rejectUnsafeRemoteSwitches(argv);
    }
    applyStartupSwitches(remote);
    // 参数转发在开关设置之后执行，与启动顺序一致。
    context.openAsHidden = forwardCommandLineSwitches({argv, packaged, remote});
    return {commandLine, context};
};

test("default startup retains HTTP/2 and certificate verification caching", (t) => {
    const {commandLine} = startup(t);
    assert.equal(commandLine.hasSwitch("disable-http2"), false);
    assert.equal(commandLine.getSwitchValue("disable-features"), "AutoupgradeMixedContent");
    assert.equal(commandLine.getSwitchValue("enable-features"),
        "PlatformHEVCDecoderSupport,OriginKeyedProcessesByDefault");
});

test("explicit compatibility flags survive packaged and development startup", (t) => {
    for (const packaged of [true, false]) {
        const {commandLine} = startup(t, ["--disable-http2", "--disable-features=CacheCertVerification"], {packaged});
        assert.equal(commandLine.hasSwitch("disable-http2"), true);
        assert.deepEqual(new Set(commandLine.getSwitchValue("disable-features").split(",")),
            new Set(["AutoupgradeMixedContent", "CacheCertVerification"]));
        assert.equal(commandLine.hasSwitch("ignore-certificate-errors"), false);
        assert.equal(commandLine.hasSwitch("allow-insecure-localhost"), false);
    }
});

test("feature lists merge multiple arguments and retain trial parameters without duplicates", (t) => {
    const {commandLine} = startup(t, [
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

test("switch values retain spaces and additional equals signs", (testContext) => {
    const t: any = testContext;
    const commandLine = createCommandLine();
    resetElectronStub();
    mockElectron(t, {app: {commandLine} as unknown as App});
    t.after(resetElectronStub);
    const {appendChromiumSwitch} = modules();
    appendChromiumSwitch("--proxy-server=https=127.0.0.1:8080;http=127.0.0.1:8081");
    appendChromiumSwitch("--log-file=C:/logs with spaces/network.log");
    appendChromiumSwitch("--empty-value=");
    appendChromiumSwitch("--disable-http2");
    assert.equal(commandLine.getSwitchValue("proxy-server"), "https=127.0.0.1:8080;http=127.0.0.1:8081");
    assert.equal(commandLine.getSwitchValue("log-file"), "C:/logs with spaces/network.log");
    assert.equal(commandLine.hasSwitch("empty-value"), true);
    assert.equal(commandLine.hasSwitch("disable-http2"), true);
    assert.equal(appendChromiumSwitch("--"), false);
    assert.equal(appendChromiumSwitch("C:/notes/file"), false);
});

test("application flags are not forwarded as Chromium switches", (t) => {
    const {commandLine, context} = startup(t, ["--workspace=C:/notes", "--port=6806", "--openAsHidden"]);
    assert.equal(commandLine.appendedSwitches.includes("workspace"), false);
    assert.equal(commandLine.appendedSwitches.includes("port"), false);
    assert.equal(commandLine.appendedSwitches.includes("openAsHidden"), false);
    assert.equal(context.openAsHidden, true);
});

test("remote startup keeps unsafe switches blocked before feature lists are merged", (t) => {
    for (const unsafe of ["--ignore-certificate-errors", "--disable-web-security",
        "--disable-features=IsolateOrigins,CacheCertVerification",
        "--disable-features=IsolateOrigins<ExampleTrial,CacheCertVerification"]) {
        const {commandLine, context} = startup(t, [unsafe, "--disable-http2"], {remote: true});
        assert.equal(context.remoteKernelArgError.code, "ERR_REMOTE_UNSAFE_CHROMIUM_SWITCH");
        assert.equal(commandLine.hasSwitch("ignore-certificate-errors"), false);
        assert.equal(commandLine.hasSwitch("disable-web-security"), false);
        assert.equal(commandLine.getSwitchValue("disable-features"), "AutoupgradeMixedContent");
    }
    const {commandLine, context} = startup(t, ["--disable-http2", "--disable-features=CacheCertVerification"], {remote: true});
    assert.equal(context.remoteKernelArgError, undefined);
    assert.equal(commandLine.hasSwitch("ignore-certificate-errors"), false);
    assert.equal(commandLine.hasSwitch("no-proxy-server"), false);
});
