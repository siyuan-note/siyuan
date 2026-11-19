const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {test} = require("node:test");

const installerPath = path.resolve(__dirname, "../nsis/installer.nsh");
const scriptPath = path.resolve(__dirname, "../nsis/path.ps1");
const installer = fs.readFileSync(installerPath, "utf8");
const script = fs.readFileSync(scriptPath, "utf8");
const macro = name => installer.match(new RegExp(`!macro ${name}(?: [^\\r\\n]+)?\\r?\\n([\\s\\S]*?)!macroend`))[1];
const windows = process.platform === "win32";
const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
const run = (executable, arguments_, options = {}) => {
    const result = spawnSync(executable, arguments_, {encoding: "utf8", timeout: 60000, ...options});
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
};

test("Windows installation and uninstallation share a bundled PATH script for both scopes", () => {
    assert.match(macro("customInstall"), /!insertmacro UpdateKernelPath Add/);
    assert.match(macro("customUnInstall"), /!insertmacro UpdateKernelPath Remove/);
    assert.doesNotMatch(installer, /\[Environment\]::(?:Get|Set)EnvironmentVariable/);
    assert.match(installer, /!define SIYUAN_PATH_SCRIPT "\$\{__FILEDIR__\}\\path\.ps1"/);
    const update = macro("UpdateKernelPath");
    assert.match(update, /File \/oname=\$PLUGINSDIR\\siyuan-path\.ps1 "\$\{SIYUAN_PATH_SCRIPT\}"/);
    assert.match(update, /\$\{If\} \$installMode == "all"[\s\S]*-Scope Machine[\s\S]*\$\{Else\}[\s\S]*-Scope User/);
    assert.equal((update.match(/-File "\$PLUGINSDIR\\siyuan-path\.ps1"/g) || []).length, 2);
    assert.match(update, /Pop \$R9\s+\$\{If\} \$R9 == 0\s+System::Call 'user32::SendMessageTimeoutW/);
    assert.match(script, /Registry\]::LocalMachine\.OpenSubKey\("SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment", \$true\)/);
    assert.match(script, /Registry\]::CurrentUser\.OpenSubKey\("Environment", \$true\)/);
    assert.equal(script.charCodeAt(0), 0xFEFF, "Windows PowerShell 5.1 needs a BOM to recognize UTF-8 comments");
});

test("PATH edits preserve raw registry data and types, and avoid writes when unchanged", {skip: !windows}, () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-path-registry-"));
    const directory = "C:\\思源 $cash 'quote`tick (test)\\resources\\kernel";
    const original = "%SystemRoot%\\System32;;%JAVA_HOME%\\bin;C:\\Tools;";
    const cases = [
        {name: "expand-add", original, kind: "ExpandString", operation: "Add", value: `${directory};${original}`, changed: true},
        {name: "string-add", original, kind: "String", operation: "Add", value: `${directory};${original}`, changed: true},
        {name: "missing-add", operation: "Add", value: directory, resultKind: "ExpandString", changed: true},
        {name: "missing-remove", operation: "Remove", value: null, changed: false, readOnly: true},
        {name: "empty-add", original: "", kind: "ExpandString", operation: "Add", value: `${directory};`, changed: true},
        {name: "empty-remove", original: "", kind: "ExpandString", operation: "Remove", value: "", changed: false, readOnly: true},
        {name: "existing-add", original: `${original};${directory}`, kind: "ExpandString", operation: "Add", changed: false, readOnly: true},
        {name: "normalized-add", original: `"${directory.toUpperCase()}\\";${original}`, kind: "String", operation: "Add", changed: false, readOnly: true},
        {name: "reference-add", original: `%SIYUAN_PATH_TEST_HOME%;${original}`, kind: "ExpandString", operation: "Add", changed: false, readOnly: true},
        {name: "literal-reference-add", original: "%SIYUAN_PATH_TEST_HOME%", kind: "String", operation: "Add", value: `${directory};%SIYUAN_PATH_TEST_HOME%`, changed: true},
        {name: "expand-remove", original: `${directory};${original}`, kind: "ExpandString", operation: "Remove", value: original, changed: true},
        {name: "string-remove", original: `${original};${directory}`, kind: "String", operation: "Remove", value: original, changed: true},
        {name: "reference-remove", original: `${original};"%SIYUAN_PATH_TEST_HOME%\\"`, kind: "ExpandString", operation: "Remove", value: original, changed: true},
        {name: "duplicates-remove", original: `${directory};;C:\\Tools;${directory.toUpperCase()}\\;`, kind: "String", operation: "Remove", value: ";C:\\Tools;", changed: true},
        {name: "only-remove", original: directory, kind: "ExpandString", operation: "Remove", value: null, resultKind: null, changed: true},
        {name: "single-survivor", original: `${directory};C:\\Tools`, kind: "String", operation: "Remove", value: "C:\\Tools", changed: true},
        {name: "empty-survivor", original: `${directory};`, kind: "String", operation: "Remove", value: "", changed: true},
        {name: "unrelated-remove", original, kind: "ExpandString", operation: "Remove", changed: false, readOnly: true},
        {name: "prefix-remove", original: `${directory}-other;${directory}2`, kind: "String", operation: "Remove", changed: false, readOnly: true},
        {name: "long-add", original: "C:\\Tools;".repeat(2000), kind: "ExpandString", operation: "Add", value: `${directory};${"C:\\Tools;".repeat(2000)}`, changed: true},
        {name: "expand-cycle", original, kind: "ExpandString", operations: ["Add", "Add", "Remove", "Remove"], changed: false,
            steps: [{changed: true, value: `${directory};${original}`}, {changed: false, value: `${directory};${original}`},
                {changed: true, value: original}, {changed: false, value: original}]},
        {name: "string-cycle", original, kind: "String", operations: ["Add", "Remove", "Add", "Remove"], changed: true,
            steps: [{changed: true, value: `${directory};${original}`}, {changed: true, value: original},
                {changed: true, value: `${directory};${original}`}, {changed: true, value: original}]},
        {name: "missing-cycle", operations: ["Add", "Add", "Remove", "Remove"], value: null, changed: false,
            steps: [{changed: true, value: directory}, {changed: false, value: directory},
                {changed: true, value: null}, {changed: false, value: null}]},
        {name: "unsupported-type", original: 42, kind: "DWord", operation: "Add", failure: /Unsupported PATH/, changed: null},
        {name: "write-denied", original, kind: "String", operation: "Add", readOnly: true, failure: /./, changed: null},
    ];
    try {
        const input = path.join(temporary, "cases.json");
        fs.writeFileSync(input, JSON.stringify(cases.map(item => ({...item, directory}))));
        const output = run(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
            path.join(__dirname, "fixtures/installer-path.ps1"), "-Source", scriptPath, "-Cases", input]);
        const results = JSON.parse(output);
        assert.equal(results.length, cases.length);
        for (const [index, result] of results.entries()) {
            const item = cases[index];
            assert.equal(result.name, item.name);
            assert.equal(result.changed, item.changed, item.name);
            if (item.failure) assert.match(result.failure, item.failure, item.name);
            else assert.equal(result.failure, null, `${item.name}: ${result.failure}`);
            const expected = Object.hasOwn(item, "value") ? item.value : item.original;
            assert.equal(result.value, expected, item.name);
            const kind = Object.hasOwn(item, "resultKind") ? item.resultKind : item.kind ?? null;
            assert.equal(result.kind, kind, item.name);
            if (item.steps) assert.deepEqual(result.steps, item.steps, item.name);
        }
    } finally {
        fs.rmSync(temporary, {recursive: true, force: true});
    }
});

const compiler = windows ? [
    path.join(process.env.LOCALAPPDATA || "", "electron-builder/Cache/nsis/nsis-3.0.4.1/makensis.exe"),
    path.join(process.env.ProgramFiles || "", "NSIS/makensis.exe"),
].find(file => fs.existsSync(file)) : undefined;

test("NSIS embeds the PATH helper in installers and uninstallers and passes directory arguments literally", {
    skip: !compiler && "NSIS compiler is unavailable",
}, () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-path-nsis-"));
    const escape = value => value.replaceAll("$", "$$").replaceAll('"', '$\\"');
    const directory = "C:\\思源 $cash 'quote`tick (test) & tool";
    try {
        const helper = path.join(temporary, "record.ps1");
        fs.writeFileSync(helper, [
            "param([string]$Operation, [string]$Scope, [string]$KernelDirectory)",
            "$record = @{operation=$Operation; scope=$Scope; directory=$KernelDirectory} | ConvertTo-Json -Compress",
            "[IO.File]::AppendAllText($env:SIYUAN_PATH_TEST_OUTPUT, $record + [Environment]::NewLine, [Text.Encoding]::UTF8)",
        ].join("\n"));
        const source = path.join(temporary, "probe.nsi");
        fs.writeFileSync(source, [
            "Unicode true", "SilentInstall silent", "SilentUnInstall silent", "RequestExecutionLevel user",
            `OutFile "${escape(path.join(temporary, "install.exe"))}"`,
            '!include "LogicLib.nsh"', "Var installMode",
            `!define SIYUAN_PATH_SCRIPT "${escape(helper)}"`,
            "!macro UpdateKernelPath Operation", macro("UpdateKernelPath"), "!macroend",
            "Section", `StrCpy $INSTDIR "${escape(directory)}"`,
            'StrCpy $installMode "all"', "!insertmacro UpdateKernelPath Add",
            'StrCpy $installMode "current"', "!insertmacro UpdateKernelPath Add",
            'WriteUninstaller "$EXEDIR\\uninstall.exe"', "SectionEnd",
            'Section "Uninstall"', `StrCpy $INSTDIR "${escape(directory)}"`,
            'StrCpy $installMode "all"', "!insertmacro UpdateKernelPath Remove",
            'StrCpy $installMode "current"', "!insertmacro UpdateKernelPath Remove", "SectionEnd",
        ].join("\n"));
        run(compiler, ["/INPUTCHARSET", "UTF8", "/V2", source]);
        const output = path.join(temporary, "records.jsonl");
        const env = {...process.env, SIYUAN_PATH_TEST_OUTPUT: output};
        run(path.join(temporary, "install.exe"), ["/S"], {env});
        run(path.join(temporary, "uninstall.exe"), ["/S", `_?=${temporary}`], {env});
        const records = fs.readFileSync(output, "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/).map(line => JSON.parse(line));
        assert.deepEqual(records, [
            {operation: "Add", scope: "Machine", directory: `${directory}\\resources\\kernel`},
            {operation: "Add", scope: "User", directory: `${directory}\\resources\\kernel`},
            {operation: "Remove", scope: "Machine", directory: `${directory}\\resources\\kernel`},
            {operation: "Remove", scope: "User", directory: `${directory}\\resources\\kernel`},
        ]);
    } finally {
        fs.rmSync(temporary, {recursive: true, force: true});
    }
});
