const path = require("node:path");
const {createRequire} = require("node:module");
const {execFileSync} = require("node:child_process");
const {extensionName, extensionEntitlements} = require("./quicklook");

const signDarwin = async (options, _packager, dependencies = {}) => {
    const run = dependencies.run || execFileSync;
    const extension = path.join(options.app, "Contents/PlugIns", extensionName);
    if (!options.identity) { throw new Error("Quick Look signing requires the application's identity"); }
    const args = ["--force", "--sign", options.identity, "--options", "runtime", "--entitlements", extensionEntitlements, "--timestamp"];
    if (options.keychain) { args.push("--keychain", options.keychain); }
    run("codesign", [...args, extension], {stdio: "inherit"});
    run("codesign", ["--verify", "--strict", "--verbose=2", extension], {stdio: "inherit"});
    const sign = dependencies.sign || createRequire(require.resolve("electron-builder"))("@electron/osx-sign").signAsync;
    const originalIgnore = options.ignore;
    const originalFileOptions = options.optionsForFile;
    // electron-builder 26 默认忽略 PlugIns；显式保持扩展的独立签名，并防止后续配置重签时继承 Electron 权限。
    await sign({...options, ignore: file => file === extension || file.startsWith(extension + path.sep) ||
        (typeof originalIgnore === "function" ? originalIgnore(file) : false),
    optionsForFile: file => file === extension || file.startsWith(extension + path.sep) ?
        {entitlements: extensionEntitlements, hardenedRuntime: true} : originalFileOptions?.(file)});
    run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", options.app], {stdio: "inherit"});
};
module.exports = signDarwin;
