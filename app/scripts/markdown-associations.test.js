const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {createRequire} = require("node:module");
const {test} = require("node:test");
const sharp = require("sharp");

const project = path.resolve(__dirname, "..");
const installer = fs.readFileSync(path.join(project, "nsis/installer.nsh"), "utf8");
const macro = name => installer.match(new RegExp(`!macro ${name}\\r?\\n([\\s\\S]*?)!macroend`))[1];
const builderRequire = createRequire(require.resolve("electron-builder"));
const library = path.dirname(builderRequire.resolve("app-builder-lib"));
const {getConfig, validateConfiguration} = require(path.join(library, "util/config/config.js"));

test("Windows registers only its Markdown Open With candidate without changing defaults", () => {
    const install = macro("RegisterMarkdownOpenWith");
    const commands = install.split(/\r?\n/).map(line => line.trim()).filter(line => /^WriteReg/.test(line));
    assert.equal(commands.length, 5);
    for (const command of commands) {
        assert.match(command, /SHELL_CONTEXT "Software\\Classes\\(?:\$\{MARKDOWN_PROG_ID\}(?:\\[^"\r\n]*)?|\.(?:md|markdown)\\OpenWithProgids)"/);
    }
    assert.match(install, /WriteRegNone SHELL_CONTEXT "Software\\Classes\\\.md\\OpenWithProgids" "\$\{MARKDOWN_PROG_ID\}"/);
    assert.match(install, /WriteRegNone SHELL_CONTEXT "Software\\Classes\\\.markdown\\OpenWithProgids" "\$\{MARKDOWN_PROG_ID\}"/);
    assert.match(install, /'"\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}" --markdown "%1"'/);
    assert.match(install, /WriteRegStr SHELL_CONTEXT "Software\\Classes\\\$\{MARKDOWN_PROG_ID\}\\DefaultIcon" "" '"\$INSTDIR\\resources\\markdown\.ico",0'/);
    assert.match(install, /System::Call 'shell32::SHChangeNotify\(i 0x08000000, i 0, p 0, p 0\)'/);
    assert.doesNotMatch(install, /(?:WriteReg\w+.*UserChoice|APP_ASSOCIATE)/);
    assert.match(macro("customInstall"), /^\s*!insertmacro RegisterMarkdownOpenWith/);
});

test("uninstall only removes this installation's candidate and leaves other apps and defaults intact", () => {
    const uninstall = macro("UnregisterMarkdownOpenWith");
    assert.match(uninstall, /ReadRegStr \$R9 SHELL_CONTEXT "Software\\Classes\\\$\{MARKDOWN_PROG_ID\}\\shell\\open\\command" ""/);
    assert.match(uninstall, /\$\{If\} \$R9 == '"\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}" --markdown "%1"'/);
    assert.equal((uninstall.match(/DeleteRegValue /g) || []).length, 2);
    for (const line of uninstall.split(/\r?\n/).filter(line => /DeleteReg(?:Key|Value)/.test(line))) {
        if (/DeleteRegValue/.test(line)) assert.match(line, /\\OpenWithProgids" "\$\{MARKDOWN_PROG_ID\}"$/);
        else if (/OpenWithProgids/.test(line)) assert.match(line, /DeleteRegKey \/ifempty /);
        else assert.match(line, /DeleteRegKey SHELL_CONTEXT "Software\\Classes\\\$\{MARKDOWN_PROG_ID\}"$/);
    }
    assert.match(macro("customUnInstall"), /\$\{IfNot\} \$\{isUpdated\}\s+!insertmacro UnregisterMarkdownOpenWith\s+\$\{EndIf\}/);
});

test("all six packaging configurations retain platform-appropriate non-default Markdown handlers", async () => {
    for (const name of ["electron-builder.yml", "electron-builder-arm64.yml", "electron-builder-darwin.yml",
        "electron-builder-darwin-arm64.yml", "electron-builder-linux.yml", "electron-builder-linux-arm64.yml"]) {
        const config = await getConfig(project, path.join(project, name), null);
        await validateConfiguration(config);
        assert.equal(config.fileAssociations?.length || 0, 0, `${name}: global associations would hijack Windows defaults`);
        assert.equal(config.win?.fileAssociations?.length || 0, 0);
        for (const platform of ["mac", "linux"]) {
            const entries = config[platform].fileAssociations;
            assert.equal(entries.length, 1, name);
            assert.deepEqual(entries[0].ext, ["md", "markdown"]);
            assert.equal(entries[0].role, "Editor");
            assert.equal(entries[0].rank, "Alternate");
            assert.equal(entries[0].mimeType, "text/markdown");
            assert.equal(entries[0].icon, platform === "mac" ? "src/assets/markdown.icns" : undefined);
        }
    }
});

const icnsFrames = file => {
    const icon = fs.readFileSync(path.join(project, "src/assets", file));
    assert.equal(icon.toString("ascii", 0, 4), "icns");
    assert.equal(icon.readUInt32BE(4), icon.length);
    const frames = new Map();
    let offset = 8;
    while (offset < icon.length) {
        assert.ok(offset + 8 <= icon.length, `${file}: complete chunk header`);
        const type = icon.toString("ascii", offset, offset + 4);
        const length = icon.readUInt32BE(offset + 4);
        assert.ok(length > 8 && offset + length <= icon.length, `${file}: valid ${type} chunk`);
        assert.ok(!frames.has(type), `${file}: unique ${type} chunk`);
        frames.set(type, icon.subarray(offset + 8, offset + length));
        offset += length;
    }
    assert.equal(offset, icon.length);
    return frames;
};

test("macOS Markdown icon covers standard and Retina sizes with the approved transparent design and application colors", async () => {
    const frames = icnsFrames("markdown.icns");
    const sizes = new Map([["icp4", 16], ["icp5", 32], ["icp6", 64], ["ic07", 128], ["ic08", 256],
        ["ic09", 512], ["ic10", 1024], ["ic11", 32], ["ic12", 64], ["ic13", 256], ["ic14", 512]]);
    assert.deepEqual([...frames.keys()], [...sizes.keys()]);
    const application = await sharp(icnsFrames("icon.icns").get("ic09")).ensureAlpha().raw().toBuffer();
    const colors = new Map();
    for (let offset = 0; offset < application.length; offset += 4) {
        if (application[offset + 3] !== 255) continue;
        const color = application.subarray(offset, offset + 3).toString("hex");
        colors.set(color, (colors.get(color) || 0) + 1);
    }
    const palette = [...colors].sort((left, right) => right[1] - left[1]).slice(0, 3).map(([color]) => color);
    assert.deepEqual(palette, ["ffffff", "da3838", "3b3f42"]);
    const windows = fs.readFileSync(path.join(project, "src/assets/markdown.ico"));
    const windowsFrames = new Map(Array.from({length: windows.readUInt16LE(4)}, (_, index) => {
        const entry = 6 + index * 16;
        const start = windows.readUInt32LE(entry + 12);
        return [windows[entry] || 256, windows.subarray(start, start + windows.readUInt32LE(entry + 8))];
    }));
    for (const [type, png] of frames) {
        const size = sizes.get(type);
        const {data, info} = await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject: true});
        assert.equal(info.width, size, type);
        assert.equal(info.height, size, type);
        assert.equal(info.channels, 4, type);
        const present = new Set();
        let transparent = false;
        let antialiased = false;
        for (let offset = 0; offset < data.length; offset += 4) {
            const alpha = data[offset + 3];
            transparent ||= alpha === 0;
            antialiased ||= alpha > 0 && alpha < 255;
            if (alpha === 255) present.add(data.subarray(offset, offset + 3).toString("hex"));
        }
        assert.ok(transparent && palette.every(color => present.has(color)), `${type}: transparent background and macOS colors`);
        if (size > 16) assert.ok(antialiased, `${type}: antialiased edges`);
        if (!windowsFrames.has(size)) continue;
        const approved = await sharp(windowsFrames.get(size)).ensureAlpha().raw().toBuffer();
        for (let offset = 0; offset < data.length; offset += 4) {
            assert.equal(data[offset + 3], approved[offset + 3], `${type}: approved alpha at ${offset / 4}`);
            for (let channel = 0; channel < 3; channel++) {
                // 半透明边缘在预乘和取消预乘时存在量化舍入。
                assert.ok(Math.abs(data[offset + channel] - approved[offset + channel]) * data[offset + 3] <= 3 * 255,
                    `${type}: only application color adaptation at ${offset / 4}`);
            }
        }
    }
});

test("both macOS packages write and copy the Markdown document icon without replacing the app icon or handler rank", async () => {
    const {MacPackager} = builderRequire("app-builder-lib");
    const {createMacApp} = require(path.join(library, "electron/electronMac.js"));
    const {savePlistFile, parsePlistFile} = require(path.join(library, "util/plist.js"));
    const output = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-markdown-mac-"));
    try {
        for (const [name, arch] of [["electron-builder-darwin.yml", "x64"], ["electron-builder-darwin-arm64.yml", "arm64"]]) {
            const config = await getConfig(project, path.join(project, name), null);
            const packager = new MacPackager({
                config,
                projectDir: project,
                buildResourcesDir: path.join(project, "build"),
                metadata: JSON.parse(fs.readFileSync(path.join(project, "package.json"), "utf8")),
                framework: {distMacOsAppName: "Electron.app"},
            });
            const destination = path.join(output, arch);
            const contents = path.join(destination, "Electron.app/Contents");
            const helper = path.join(contents, "Frameworks/Electron Helper.app/Contents");
            fs.mkdirSync(path.join(contents, "Resources"), {recursive: true});
            for (const directory of [contents, helper]) {
                fs.mkdirSync(path.join(directory, "MacOS"), {recursive: true});
                fs.writeFileSync(path.join(directory, "MacOS", directory === contents ? "Electron" : "Electron Helper"), "");
                await savePlistFile(path.join(directory, "Info.plist"), {CFBundleExecutable: "Electron"});
            }
            await createMacApp(packager, destination, null, false);
            const builtContents = path.join(destination, "SiYuan.app/Contents");
            const plist = await parsePlistFile(path.join(builtContents, "Info.plist"));
            assert.deepEqual(plist.CFBundleDocumentTypes, [{
                CFBundleTypeExtensions: ["md", "markdown"],
                CFBundleTypeName: "SiYuan Markdown",
                CFBundleTypeRole: "Editor",
                LSHandlerRank: "Alternate",
                CFBundleTypeIconFile: "markdown.icns",
            }], name);
            assert.equal(plist.CFBundleIconFile, "icon.icns", name);
            assert.equal(config.mac.icon, "src/assets/icon.icns", name);
            assert.equal(config.mac.target[0].arch, arch, name);
            for (const icon of ["markdown.icns", "icon.icns"]) {
                assert.deepEqual(fs.readFileSync(path.join(builtContents, "Resources", icon)),
                    fs.readFileSync(path.join(project, "src/assets", icon)), `${name}: ${icon}`);
            }
        }
    } finally {
        fs.rmSync(output, {recursive: true, force: true});
    }
});

test("Markdown document icon has 32-bit entries for Explorer display sizes", () => {
    const icon = fs.readFileSync(path.join(project, "src/assets/markdown.ico"));
    assert.equal(icon.readUInt16LE(0), 0);
    assert.equal(icon.readUInt16LE(2), 1);
    const count = icon.readUInt16LE(4);
    const sizes = [];
    let end = 6 + count * 16;
    assert.ok(count > 0 && end < icon.length);
    for (let index = 0; index < count; index++) {
        const entry = 6 + index * 16;
        const width = icon[entry] || 256;
        assert.equal(icon[entry + 1] || 256, width);
        assert.ok(icon.readUInt16LE(entry + 4) <= 1);
        assert.equal(icon.readUInt16LE(entry + 6), 32);
        const length = icon.readUInt32LE(entry + 8);
        const offset = icon.readUInt32LE(entry + 12);
        assert.equal(offset, end);
        assert.ok(length > 0 && offset + length <= icon.length);
        end = offset + length;
        sizes.push(width);
    }
    assert.equal(end, icon.length);
    assert.deepEqual(sizes.sort((a, b) => a - b), [16, 20, 24, 32, 48, 64, 128, 256]);
    assert.notDeepEqual(icon, fs.readFileSync(path.join(project, "src/assets/icon.ico")));
});

test("Markdown icon frames use the application red and keep small MD labels legible", async () => {
    const frames = async file => {
        const icon = fs.readFileSync(path.join(project, "src/assets", file));
        return Promise.all(Array.from({length: icon.readUInt16LE(4)}, async (_, index) => {
            const entry = 6 + index * 16;
            const size = icon[entry] || 256;
            const offset = icon.readUInt32LE(entry + 12);
            const length = icon.readUInt32LE(entry + 8);
            const {data, info} = await sharp(icon.subarray(offset, offset + length)).ensureAlpha().raw()
                .toBuffer({resolveWithObject: true});
            assert.equal(info.width, size);
            assert.equal(info.height, size);
            assert.equal(info.channels, 4);
            return {size, data};
        }));
    };
    const redCounts = data => {
        const colors = new Map();
        for (let offset = 0; offset < data.length; offset += 4) {
            if (data[offset + 3] !== 255 || data[offset] <= data[offset + 1] * 2 ||
                data[offset] <= data[offset + 2] * 2) continue;
            const color = data.subarray(offset, offset + 3).toString("hex");
            colors.set(color, (colors.get(color) || 0) + 1);
        }
        return [...colors].sort((left, right) => right[1] - left[1]);
    };
    const [application] = await frames("icon.ico");
    const applicationRed = redCounts(application.data)[0][0];
    const labelRegions = new Map([
        [16, {left: 3, top: 7, right: 14, bottom: 14, width: 10, height: 6}],
        [20, {left: 5, top: 11, right: 17, bottom: 16, width: 10, height: 6}],
        [24, {left: 8, top: 14, right: 20, bottom: 19, width: 12, height: 6}],
        [32, {left: 13, top: 20, right: 28, bottom: 26, width: 14, height: 7}],
    ]);
    for (const {size, data} of await frames("markdown.ico")) {
        assert.equal(redCounts(data)[0][0], applicationRed, `${size}px: application red`);
        let transparent = false;
        let antialiased = false;
        let gray = false;
        let white = false;
        for (let offset = 0; offset < data.length; offset += 4) {
            const alpha = data[offset + 3];
            transparent ||= alpha === 0;
            antialiased ||= alpha > 0 && alpha < 255;
            gray ||= alpha === 255 && data.subarray(offset, offset + 3).equals(Buffer.from([59, 62, 67]));
            white ||= alpha === 255 && data.subarray(offset, offset + 3).equals(Buffer.from([255, 255, 255]));
        }
        assert.ok(transparent && gray && white, `${size}px: transparent background and contrasting label`);
        if (size > 16) assert.ok(antialiased, `${size}px: antialiased edges`);
        const region = labelRegions.get(size);
        if (!region) continue;
        const points = [];
        for (let y = region.top; y <= region.bottom; y++) {
            for (let x = region.left; x <= region.right; x++) {
                const offset = (y * size + x) * 4;
                if (data[offset + 3] > 220 && Math.max(...data.subarray(offset, offset + 3)) < 160) {
                    points.push([x, y]);
                }
            }
        }
        const width = Math.max(...points.map(point => point[0])) - Math.min(...points.map(point => point[0])) + 1;
        const height = Math.max(...points.map(point => point[1])) - Math.min(...points.map(point => point[1])) + 1;
        assert.ok(width >= region.width && height >= region.height, `${size}px: readable native-size MD glyphs`);
    }
});

test("both Windows installers copy the document icon to its registered path without replacing the app icon", async () => {
    const {getFileMatchers, copyFiles} = require(path.join(library, "fileMatcher.js"));
    const output = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-markdown-icon-"));
    try {
        for (const [name, arch] of [["electron-builder.yml", "x64"], ["electron-builder-arm64.yml", "arm64"]]) {
            const config = await getConfig(project, path.join(project, name), null);
            const resources = path.join(output, arch, "resources");
            const matchers = getFileMatchers(config, "extraResources", resources, {
                defaultSrc: project,
                globalOutDir: output,
                customBuildOptions: config.win,
                macroExpander: value => value.replaceAll("${arch}", arch),
            });
            const icons = matchers.filter(matcher => matcher.to === path.join(resources, "markdown.ico"));
            assert.equal(icons.length, 1, name);
            assert.equal(icons[0].from, path.join(project, "src/assets/markdown.ico"), name);
            assert.ok(fs.statSync(icons[0].from).isFile(), name);
            await copyFiles(icons, null, false);
            assert.deepEqual(fs.readFileSync(icons[0].to), fs.readFileSync(icons[0].from), name);
            assert.equal(config.win.icon, "src/assets/icon.ico", name);
            assert.equal(config.nsis.include, "nsis/installer.nsh", name);
            assert.ok(matchers.some(matcher => matcher.to === path.join(resources, "kernel")), name);
            assert.ok(!config.extraResources.some(resource => resource.to === "markdown.ico"), name);
        }
    } finally {
        fs.rmSync(output, {recursive: true, force: true});
    }
});
