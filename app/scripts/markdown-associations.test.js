const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {createRequire} = require("node:module");
const {test} = require("node:test");

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
        }
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
