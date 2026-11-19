const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {createRequire} = require("node:module");
const {execFileSync, spawnSync} = require("node:child_process");
const {extensionName, extensionEntitlements} = require("./quicklook");

const signDarwin = async (options, _packager, dependencies = {}) => {
    const run = dependencies.run || execFileSync;
    const display = dependencies.display || spawnSync;
    if (!options.identity) { throw new Error("Quick Look signing requires the application's identity"); }
    const osxRequire = createRequire(createRequire(require.resolve("electron-builder")).resolve("@electron/osx-sign"));
    const plist = osxRequire("plist");
    const sign = dependencies.sign || osxRequire("@electron/osx-sign").signAsync;
    const extension = path.join(options.app, "Contents/PlugIns", extensionName);
    const helper = path.join(options.app, "Contents/MacOS/SiYuanQuickLookFonts");
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-quicklook-sign-"));
    const signingArgs = ["--force", "--sign", options.identity, "--options", "runtime", "--timestamp"];
    if (options.keychain) { signingArgs.push("--keychain", options.keychain); }
    try {
        const probe = path.join(temporary, "probe");
        fs.copyFileSync(helper, probe);
        run("codesign", [...signingArgs, probe], {stdio: "inherit"});
        const result = display("codesign", ["--display", "--verbose=4", probe], {encoding: "utf8"});
        const team = result.status === 0 && /^TeamIdentifier=([A-Z0-9]{10})$/m.exec(result.stderr || "")?.[1];
        if (!team) { throw new Error("Cannot determine Quick Look signing TeamIdentifier"); }
        const group = `${team}.org.b3log.siyuan.quicklook`;
        const addGroup = (source, destination) => {
            const entitlements = plist.parse(fs.readFileSync(source, "utf8"));
            const groups = entitlements["com.apple.security.application-groups"] || [];
            if (!Array.isArray(groups) || !groups.every(value => typeof value === "string")) {
                throw new Error("Invalid application group entitlements");
            }
            entitlements["com.apple.security.application-groups"] = [...new Set([...groups, group])];
            fs.writeFileSync(destination, plist.build(entitlements));
            return destination;
        };
        const extensionPlist = addGroup(extensionEntitlements, path.join(temporary, "extension.plist"));
        const helperPlist = path.join(temporary, "helper.plist");
        fs.writeFileSync(helperPlist, plist.build({"com.apple.security.application-groups": [group]}));
        for (const bundle of [options.app, extension]) {
            run("plutil", ["-replace", "SiYuanQuickLookAppGroup", "-string", group, path.join(bundle, "Contents/Info.plist")], {stdio: "inherit"});
        }
        for (const [target, entitlements] of [[helper, helperPlist], [extension, extensionPlist]]) {
            run("codesign", [...signingArgs, "--entitlements", entitlements, target], {stdio: "inherit"});
            run("codesign", ["--verify", "--strict", "--verbose=2", target], {stdio: "inherit"});
        }
        const originalIgnore = options.ignore;
        const ignored = Array.isArray(originalIgnore) ? originalIgnore : originalIgnore ? [originalIgnore] : [];
        const originalFileOptions = options.optionsForFile;
        const mainOptions = originalFileOptions?.(options.app) || {};
        const source = mainOptions.entitlements || options.entitlements;
        if (typeof source !== "string") { throw new Error("Quick Look requires explicit main app entitlements"); }
        const mainPlist = addGroup(source, path.join(temporary, "main.plist"));
        const nativeFile = file => file === helper || file === extension || file.startsWith(extension + path.sep);
        await sign({...options, ignore: file => nativeFile(file) ||
            ignored.some(pattern => typeof pattern === "function" ? pattern(file) : Boolean(file.match(pattern))),
        optionsForFile: file => {
            if (file === helper) { return {entitlements: helperPlist, hardenedRuntime: true}; }
            if (file === extension || file.startsWith(extension + path.sep)) {
                return {entitlements: extensionPlist, hardenedRuntime: true};
            }
            return file === options.app ? {...mainOptions, entitlements: mainPlist} : originalFileOptions?.(file);
        }});
        run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", options.app], {stdio: "inherit"});
    } finally {
        fs.rmSync(temporary, {recursive: true, force: true});
    }
};
module.exports = signDarwin;
