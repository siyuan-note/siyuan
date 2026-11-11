const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const cases = async (sources, appPath, languages) => {
    const check = require("node:assert/strict");
    const dayjs = require(appPath + "/node_modules/dayjs");
    const modules = {};
    const load = name => {
        if (modules[name]) return modules[name];
        const exports = {};
        modules[name] = exports;
        new Function("require", "exports", sources[name])(id => load(id.replace("./", "")), exports);
        return exports;
    };
    const {bindInlineDatePicker, getInlineDateValue} = load("inline");
    const dialogs = [];
    const writes = [];
    let mobile = false;
    window.siyuan = {languages};
    class MobileDialog {
        constructor(options) {
            this.options = options;
            this.element = document.createElement("div");
            this.element.className = "b3-dialog";
            this.element.innerHTML = options.content;
            document.body.append(this.element);
            dialogs.push(this);
        }
        destroy() { this.options.destroyCallback?.(); this.element.remove(); }
        async runPending(action) { if (await action()) this.destroy(); }
    }
    const dependencies = {
        bindInlineDatePicker, getInlineDateValue, dayjs, MobileDialog,
        Constants: {CUSTOM_REMINDER_WECHAT: "reminder", DIALOG_WECHATREMINDER: "wechat"},
        isMobile: () => mobile, getEditorRange: () => ({}), focusByRange() {},
        isEncryptedBox: () => false, showMessage() {},
        fetchPost: (url, data, callback) => {
            if (url.endsWith("getDocInfo")) callback({data: {ial: {}}});
            else { writes.push({url, data}); callback(); }
        },
        fetchSyncPost: async (url, data) => { writes.push({url, data}); return {code: 0}; },
    };
    const methods = new Function(...Object.keys(dependencies), sources.reminder + "\nreturn {openWechatNotify, openFileWechatNotify};")(...Object.values(dependencies));
    for (mobile of [false, true]) {
        for (const file of [false, true]) {
            const node = document.createElement("div");
            node.dataset.nodeId = "block";
            const open = () => {
                if (file) methods.openFileWechatNotify("document", "notebook");
                else methods.openWechatNotify(node);
                return dialogs.at(-1);
            };
            let dialog = open();
            let input = dialog.element.querySelector(".date-picker-input");
            let calendar = dialog.element.querySelector('[data-role="reminder-date-calendar"]');
            let buttons = dialog.element.querySelectorAll(".b3-dialog__action .b3-button");
            check.equal(input.type, "text", "the reminder does not invoke a native mobile picker");
            check.equal(calendar.children.length, 0, "the reminder calendar stays collapsed until date focus");
            check.equal(input.placeholder, "YYYY-MM-DD HH:mm");
            input.focus();
            check.equal(calendar.querySelectorAll(".date-picker").length, 1);
            check.equal(buttons.length, 3, "calendar buttons are not host save/cancel controls");
            input.value = "2099-12-01T12:34";
            input.dispatchEvent(new Event("change", {bubbles: true}));
            calendar.querySelector('[data-date="2099-12-15"]').click();
            check.equal(input.value, "2099-12-15 12:34");
            check.equal(writes.length, 0, "choosing a day sends no reminder");
            check.equal(document.querySelectorAll(".b3-dialog").length, 1);
            input.value = "2099-02-30T12:34";
            input.dispatchEvent(new Event("input", {bubbles: true}));
            buttons[2].click();
            check.equal(writes.length, 0, "invalid text cannot confirm the last valid date");
            input.value = "2099-12-15T12:34";
            input.dispatchEvent(new Event("change", {bubbles: true}));
            buttons[2].click();
            await new Promise(resolve => setTimeout(resolve, 0));
            check.deepEqual(writes, [{url: "/api/block/setBlockReminder", data: {id: file ? "document" : "block", timed: "20991215123400"}}]);
            check.equal(dialog.element.isConnected, false);
            check.equal(calendar.children.length, 0);
            writes.length = 0;
            dialog = open();
            input = dialog.element.querySelector(".date-picker-input");
            calendar = dialog.element.querySelector('[data-role="reminder-date-calendar"]');
            buttons = dialog.element.querySelectorAll(".b3-dialog__action .b3-button");
            input.value = "2099-12-31T23:59";
            input.dispatchEvent(new Event("change", {bubbles: true}));
            buttons[0].click();
            check.equal(writes.length, 0, "cancel never sends a reminder");
            check.equal(calendar.children.length, 0);
        }
    }
    return "Embedded WeChat reminders passed";
};

if (process.versions.electron && process.type === "browser") {
    (async () => {
        const {app, BrowserWindow} = require("electron");
        app.setPath("userData", process.argv[2]);
        await app.whenReady();
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
        await win.loadURL("data:text/html,<html><body></body></html>");
        win.show();
        win.focus();
        const ts = require("typescript");
        const compile = value => ts.transpileModule(value, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021}}).outputText;
        const appPath = path.resolve(__dirname, "..");
        const sources = {};
        for (const name of ["inline", "field", "model", "yearInput"]) {
            sources[name] = compile(fs.readFileSync(path.join(appPath, "src/datePicker", name + ".ts"), "utf8"));
        }
        const parsed = ts.createSourceFile("commonMenuItem.ts", fs.readFileSync(path.join(appPath, "src/menus/commonMenuItem.ts"), "utf8"), ts.ScriptTarget.Latest, true);
        sources.reminder = compile(parsed.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => ["openWechatNotify", "openFileWechatNotify"].includes(item.name.getText(parsed))))
            .map(node => node.getText(parsed).replace(/^export /, "")).join("\n"));
        const languages = JSON.parse(fs.readFileSync(path.join(appPath, "appearance/langs/en.json"), "utf8"));
        const result = await win.webContents.executeJavaScript(`(async () => { try { return await (${cases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(appPath)}, ${JSON.stringify(languages)}); } catch (error) { return {error: error.stack}; } })()`);
        assert.equal(typeof result, "string", JSON.stringify(result));
        console.log(result);
        win.destroy();
        app.exit(0);
    })().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").test("embedded WeChat reminder calendars preserve block and document confirmation boundaries", {
        timeout: 30000,
    }, async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-wechat-reminder-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const headlessArgs = process.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY ?
            ["--no-sandbox", "--disable-gpu", "--ozone-platform=headless"] : [];
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(require("electron"), [__filename, profile, ...headlessArgs], {env, windowsHide: true, timeout: 25000});
            assert.match(stdout, /Embedded WeChat reminders passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
