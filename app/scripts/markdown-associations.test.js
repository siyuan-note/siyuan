const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {createRequire} = require("node:module");
const {test} = require("node:test");

const project = path.resolve(__dirname, "..");
const installer = fs.readFileSync(path.join(project, "nsis/installer.nsh"), "utf8");
const macro = name => installer.match(new RegExp(`!macro ${name}\\r?\\n([\\s\\S]*?)!macroend`))[1];

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
    assert.doesNotMatch(install, /(?:WriteReg\w+.*UserChoice|APP_ASSOCIATE)/);
    assert.match(macro("customInstall"), /!insertmacro RegisterMarkdownOpenWith/);
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
    const builderRequire = createRequire(require.resolve("electron-builder"));
    const library = path.dirname(builderRequire.resolve("app-builder-lib"));
    const {getConfig, validateConfiguration} = require(path.join(library, "util/config/config.js"));
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
