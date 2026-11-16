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
    let storedReminder = "";
    window.siyuan = {languages};
    class MobileDialog {
        constructor(options) {
            this.options = options;
            this.element = document.createElement("div");
            this.element.className = "b3-dialog--open";
            this.element.innerHTML = `<div class="b3-dialog"><div class="b3-dialog__scrim"></div><div class="b3-dialog__container ${options.containerClassName || ""}" style="width:${options.width}"><div class="b3-dialog__header">${options.title}</div><div class="b3-dialog__body">${options.content}</div></div></div>`;
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
            if (url.endsWith("getDocInfo")) callback({data: {ial: {reminder: storedReminder}}});
            else { writes.push({url, data}); callback(); }
        },
        fetchSyncPost: async (url, data) => { writes.push({url, data}); return {code: 0}; },
    };
    const methods = new Function(...Object.keys(dependencies), sources.reminder + "\nreturn {openWechatNotify, openFileWechatNotify, getWechatTipHTML};")(...Object.values(dependencies));
    const originalTip = languages.wechatTip;
    languages.wechatTip = "该内容块将以明文形式发送到云端\n到期时通过微信公众号模板消息进行推送";
    check.equal(methods.getWechatTipHTML(), "该内容块将以明文形式发送到云端<br>到期时通过微信公众号模板消息进行推送");
    languages.wechatTip = "该内容块将以明文形式发送到云端，到期时通过微信公众号模板消息进行推送";
    check.equal(methods.getWechatTipHTML(), languages.wechatTip, "punctuation without an explicit line break is preserved");
    languages.wechatTip = "Cloud notice, keep its punctuation <safe>";
    check.equal(methods.getWechatTipHTML(), "Cloud notice, keep its punctuation &lt;safe&gt;");
    languages.wechatTip = originalTip;
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
            check.equal(dialog.options.width, mobile ? "92vw" : "min(300px, 92vw)");
            check.equal(dialog.options.containerClassName, mobile ? undefined : "date-picker-reminder-dialog");
            if (!mobile) {
                const container = dialog.element.querySelector(".b3-dialog__container").getBoundingClientRect();
                const footer = dialog.element.querySelector(".b3-dialog__action").getBoundingClientRect();
                const content = dialog.element.querySelector(".b3-dialog__content");
                check.ok(container.top >= 0 && container.bottom <= innerHeight, `short viewport contains the initial dialog: ${container.top},${container.bottom}/${innerHeight}`);
                check.ok(footer.top >= container.top && footer.bottom <= innerHeight, "footer is reachable without scrolling the overlay");
                check.ok(content.scrollHeight > content.clientHeight, "the expanded calendar scrolls inside the short dialog");
            }
            check.equal(dialog.element.querySelector(".b3-label__text").innerHTML, methods.getWechatTipHTML(), "both reminder hosts share the same notice rendering");
            check.equal(input.closest(".date-picker__reminder"), calendar.parentElement, "fields and calendar share an aligned column");
            check.equal(input.closest(".date-picker__split").querySelector(".ft__smaller"), null, "no duplicate date/time captions");
            check.equal(input.type, "text", "the reminder does not invoke a native mobile picker");
            check.equal(calendar.querySelectorAll('[role="grid"]').length, 1, "the reminder calendar is visible on initial dialog opening");
            check.equal(getInlineDateValue(input), "", "opening the calendar does not fill an empty reminder");
            check.notEqual(document.activeElement, input, "initial calendar activation does not steal input focus");
            check.equal(writes.length, 0, "opening the calendar sends no reminder");
            check.equal(input.placeholder, "YYYY-MM-DD");
            check.equal(input.closest(".date-picker__split").querySelector('[data-date-picker-part="time"]').placeholder, "HH:mm");
            input.focus();
            check.equal(calendar.querySelectorAll(".date-picker").length, 1);
            const timeInput = input.closest(".date-picker__split").querySelector('[data-date-picker-part="time"]');
            timeInput.focus();
            check.equal(calendar.querySelectorAll('[role="grid"]').length, 1, "time focus keeps the calendar visible");
            check.equal(buttons.length, 3, "calendar buttons are not host save/cancel controls");
            input.value = "2099-12-01T12:34";
            input.dispatchEvent(new Event("change", {bubbles: true}));
            calendar.querySelector('[data-date="2099-12-15"]').click();
            check.equal(input.value, "2099-12-15");
            check.equal(input.closest(".date-picker__split").querySelector('[data-date-picker-part="time"]').value, "12:34");
            check.equal(writes.length, 0, "choosing a day sends no reminder");
            check.equal(document.querySelectorAll(".b3-dialog").length, 1);
            input.value = "";
            timeInput.value = "";
            input.dispatchEvent(new Event("change", {bubbles: true}));
            check.equal(getInlineDateValue(input), "");
            check.equal(calendar.querySelectorAll('[role="grid"]').length, 1, "clearing the reminder keeps the calendar available");
            check.equal(writes.length, 0, "clearing the draft does not remove a reminder");
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
            storedReminder = "20991215123400";
            node.setAttribute("reminder", storedReminder);
            dialog = open();
            input = dialog.element.querySelector(".date-picker-input");
            check.equal(getInlineDateValue(input), "2099-12-15T12:34", "initial expansion preserves an existing reminder");
            check.equal(dialog.element.querySelector('[data-date="2099-12-15"]').closest("td[aria-selected]").getAttribute("aria-selected"), "true");
            check.equal(writes.length, 0, "opening an existing reminder does not write it");
            dialog.element.querySelector(".b3-dialog__action .b3-button--cancel").click();
            storedReminder = "";
            node.removeAttribute("reminder");
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
        const win = new BrowserWindow({show: false, width: 320, height: 400, useContentSize: true, webPreferences: {nodeIntegration: true, contextIsolation: false}});
        await win.loadURL("data:text/html,<html><body></body></html>");
        win.show();
        win.focus();
        const ts = require("typescript");
        const compile = value => ts.transpileModule(value, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021}}).outputText;
        const appPath = path.resolve(__dirname, "..");
        const stylesheet = fs.readFileSync(path.join(appPath, "appearance/themes/daylight/theme.css"), "utf8") +
            require("sass").compile(path.join(appPath, "src/assets/scss/base.scss"), {logger: {warn() {}}}).css;
        await win.webContents.insertCSS(stylesheet);
        const sources = {};
        for (const name of ["inline", "field", "model", "yearInput"]) {
            sources[name] = compile(fs.readFileSync(path.join(appPath, "src/datePicker", name + ".ts"), "utf8"));
        }
        const parsed = ts.createSourceFile("commonMenuItem.ts", fs.readFileSync(path.join(appPath, "src/menus/commonMenuItem.ts"), "utf8"), ts.ScriptTarget.Latest, true);
        sources.reminder = compile(parsed.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => ["getWechatTipHTML", "openWechatNotify", "openFileWechatNotify"].includes(item.name.getText(parsed))))
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
            ["--no-sandbox", "--disable-gpu", "--ozone-platform=headless", "--ozone-override-screen-size=1200,1200"] : [];
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(require("electron"), [__filename, profile, ...headlessArgs], {env, windowsHide: true, timeout: 25000});
            assert.match(stdout, /Embedded WeChat reminders passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
