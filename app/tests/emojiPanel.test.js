const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const cases = (source, helpers, languages) => {
    const check = require("node:assert/strict");
    document.head.innerHTML = "<style>.fn__none {display:none!important}</style>";
    const load = (name, dependencies = {}) => {
        const exports = {};
        new Function("exports", "require", helpers[name])(exports, id => dependencies[id]);
        return exports;
    };
    const escape = load("escape");
    const values = load("iconValue", {"../util/escape": escape});
    const {ContractFormData} = load("contractFormData");
    let mobile = false;
    let dialog;
    const dialogs = [];
    let failure = false;
    const requests = [];
    const selected = [];
    const recent = [];
    const messages = [];
    const model = load("dateModel");
    const yearInput = load("dateYearInput");
    const field = load("dateField", {"./model": model, "./yearInput": yearInput});
    const {bindInlineDatePicker} = load("dateInline", {"./model": model, "./field": field});
    let sheets = 0;
    let disposed = 0;
    const treeUpdates = [];
    class Dialog {
        constructor(options) {
            this.options = options;
            this.element = document.createElement("div");
            this.element.innerHTML = `<div class="b3-dialog"><div class="b3-dialog__container">${options.content}</div></div>`;
            document.body.append(this.element);
            dialogs.push(this);
        }
        destroy() {
            this.options.destroyCallback();
            this.element.remove();
        }
    }
    class EmojiPanelController {
        activate() {}
        deactivate() {}
        destroy() {}
        renderCategory() {}
    }
    const dependencies = {
        ...escape, ...values, ...load("dynamicIcon"), ContractFormData, Dialog, EmojiPanelController,
        bindInlineDatePicker,
        isMobile: () => mobile,
        dayjs: value => ({format: () => typeof value === "string" && value ? value : "2026-10-26"}),
        Constants: {LOCAL_EMOJIS: "emojis", DIALOG_EMOJIS: "emoji-panel"},
        genEmojiCategoryButtons: () => "", getEmojiTitle: () => "Custom",
        setPosition() {}, updateHotkeyTip: value => value, setStorageVal() {}, activeBlur() {},
        bindBottomSheetDialog: () => {
            sheets++;
            return Object.assign(() => disposed++, {freeze() {}});
        },
        reloadEmoji() {}, addEmoji: value => recent.push(value), showMessage: message => messages.push(message),
        getRandomEmoji: () => "1f600",
        updateFileTreeEmoji: (...args) => treeUpdates.push(args), updateOutlineEmoji() {},
        fetchPost: (url, data, callback) => {
            requests.push({url, data});
            callback(failure ? {code: 1} : {code: 0, data: {path: "custom-icon.png"}});
        },
    };
    const openEmojiPanel = new Function(...Object.keys(dependencies), source + "\nreturn openEmojiPanel;")(...Object.values(dependencies));
    const file = new File([new Uint8Array([1, 2, 3])], "custom-icon.png", {type: "image/png"});
    for (mobile of [false, true]) {
        window.siyuan = {languages, emojis: [], storage: {emojis: {currentTab: "link"}},
            config: {lang: "en", readonly: false}, menus: {menu: {remove() {}}}};
        const open = () => {
            openEmojiPanel("", "av", {x: 0, y: 0, h: 20, w: 20}, value => selected.push(value));
            dialog = dialogs.at(-1);
            const tab = dialog.element.querySelector('.emojis__tabheader [data-type="tab-link"]');
            check.notEqual(getComputedStyle(tab).display, "none", "database icon selection exposes Upload image");
            check.equal(tab.classList.contains("block__icon--active"), true, "the saved upload tab remains selected");
            check.notEqual(getComputedStyle(dialog.element.querySelector(".emojis__link")).display, "none");
        };
        open();
        dialog.element.querySelector('[data-action="cancel-custom-icon"]').click();
        check.equal(requests.length, 0, "canceling does not upload or write an icon");
        check.equal(selected.length, 0);
        open();
        const input = dialog.element.querySelector('[data-type="custom-icon-file"]');
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event("change"));
        const save = dialog.element.querySelector('[data-action="set-network-icon"]');
        check.equal(save.disabled, false);
        failure = true;
        save.click();
        check.equal(selected.length, 0, "failed uploads do not update the database icon");
        check.equal(dialog.element.isConnected, true, "failed uploads keep the selection available for retry");
        check.equal(messages.at(-1), languages.kernelFault8);
        failure = false;
        save.click();
        const request = requests.at(-1);
        check.equal(request.url, "/api/system/addCustomEmoji");
        check.equal(request.data.get("name"), file.name);
        check.equal(request.data.get("file").name, file.name);
        check.equal(request.data.get("file").size, file.size);
        check.equal(selected.at(-1), "custom-icon.png", "the existing database callback receives the uploaded image path");
        check.equal(recent.at(-1), "custom-icon.png");
        check.equal(dialog.element.isConnected, false);
        check.ok(requests.every(item => item.url === "/api/system/addCustomEmoji"), "database icons use their own persistence callbacks");
        requests.length = 0;
        selected.length = 0;
    }
    for (mobile of [false, true]) {
        window.siyuan.storage.emojis.currentTab = "emoji";
        openEmojiPanel("document", "doc", {x: 100, y: 100, h: 28, w: 100});
        dialog = dialogs.at(-1);
        check.equal(requests.length, 0, "opening document selection does not write an icon");
        dialog.destroy();
        check.equal(requests.length, 0, "canceling document selection leaves its icon unset");
        openEmojiPanel("document", "doc", {x: 100, y: 100, h: 28, w: 100});
        dialog = dialogs.at(-1);
        dialog.element.querySelector('[data-action="random"]').click();
        check.equal(requests.length, 1, "an explicit random choice writes once");
        check.equal(requests[0].url, "/api/attr/setBlockAttrs");
        check.deepEqual(requests[0].data, {id: "document", attrs: {icon: "1f600"}});
        check.deepEqual(treeUpdates.at(-1), ["1f600", "document"]);
        dialog.destroy();
        requests.length = 0;
        openEmojiPanel("document", "doc", {x: 100, y: 100, h: 28, w: 100});
        dialog = dialogs.at(-1);
        dialog.element.querySelector(".emojis__panel").innerHTML = '<button class="emojis__item" data-unicode="1f680">Icon</button>';
        dialog.element.querySelector(".emojis__item").click();
        check.equal(requests.length, 1, "a selected emoji writes once");
        check.deepEqual(requests[0].data, {id: "document", attrs: {icon: "1f680"}});
        check.equal(dialog.element.isConnected, false, "selecting an emoji closes the picker");
        requests.length = 0;
    }
    check.equal(sheets, 5, "mobile document and database openings use the shared sheet");
    check.equal(disposed, sheets, "mobile sheet handlers are disposed with each closed panel");
    for (mobile of [false, true]) {
        window.siyuan.storage.emojis.currentTab = "dynamic";
        openEmojiPanel("document", "doc", {x: 100, y: 100, h: 28, w: 100});
        dialog = dialogs.at(-1);
        const calendar = dialog.element.querySelector('[data-role="dynamic-date-calendar"]');
        const date = dialog.element.querySelector('[data-type="tab-dynamic"] .date-picker-input');
        check.equal(calendar.children.length, 0, "the icon calendar stays collapsed until date focus");
        check.equal(date.value, "2026-10-26", "lazy calendar setup preserves the initial icon date");
        date.focus();
        check.equal(calendar.querySelectorAll(".date-picker").length, 1);
        date.value = "2026-11-01";
        date.dispatchEvent(new Event("change", {bubbles: true}));
        calendar.querySelector('[data-date="2026-11-15"]').click();
        check.equal(date.value, "2026-11-15");
        dialog.element.querySelector('.emojis__tabheader [data-type="tab-link"]').click();
        dialog.element.querySelector('.emojis__tabheader [data-type="tab-dynamic"]').click();
        date.focus();
        check.equal(date.value, "2026-11-15", "tab switches preserve the edited icon date");
        check.equal(calendar.querySelectorAll(".date-picker").length, 1, "tab switches do not duplicate the calendar");
        const preview = dialog.element.querySelector(".emoji__dynamic-item");
        check.equal(new URL(preview.getAttribute("src"), "http://localhost").searchParams.get("date"), "2026-11-15");
        check.equal(requests.length, 0, "calendar selection only updates icon previews");
        check.equal(document.querySelectorAll(".b3-dialog").length, 1, "dynamic dates remain inside the icon dialog");
        const text = dialog.element.querySelector('[data-role="dynamic-text"]');
        text.value = "test icon";
        text.dispatchEvent(new Event("input", {bubbles: true}));
        check.equal(date.value, "2026-11-15", "text icon content does not overwrite the date");
        dialog.element.querySelector('[data-action="clearDate"]').click();
        check.equal(date.value, "");
        check.equal(new URL(preview.getAttribute("src"), "http://localhost").searchParams.get("date"), "");
        check.equal(requests.length, 0);
        dialog.destroy();
        check.equal(calendar.children.length, 0, "closing the icon panel disposes its calendar");
        check.equal(requests.length, 0, "canceling a dynamic preview never writes the document icon");
        openEmojiPanel("document", "doc", {x: 100, y: 100, h: 28, w: 100});
        dialog = dialogs.at(-1);
        const finalDate = dialog.element.querySelector('[data-type="tab-dynamic"] .date-picker-input');
        finalDate.value = "2026-02-30";
        finalDate.dispatchEvent(new Event("input", {bubbles: true}));
        dialog.element.querySelector(".emoji__dynamic-item").click();
        check.equal(requests.length, 0, "invalid date drafts block icon confirmation");
        dialog.element.querySelector('[data-action="clearDate"]').click();
        dialog.element.querySelector(".emoji__dynamic-item").click();
        check.equal(requests.length, 1, "explicit dynamic icon selection writes once");
        check.equal(requests[0].url, "/api/attr/setBlockAttrs");
        check.equal(requests[0].data.id, "document");
        requests.length = 0;
    }
    return "Emoji panel uploads passed";
};

if (process.versions.electron && process.type === "browser") {
    (async () => {
        const {app, BrowserWindow} = require("electron");
        app.setPath("userData", process.argv[2]);
        await app.whenReady();
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
        win.webContents.on("console-message", (_event, _level, message) => console.log(message));
        win.setContentSize(1000, 900);
        await win.loadURL("data:text/html,<html><body></body></html>");
        win.show();
        win.focus();
        assert.deepEqual(await win.webContents.executeJavaScript("[innerWidth, innerHeight]"), [1000, 900]);
        const ts = require("typescript");
        const compile = value => ts.transpileModule(value, {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
        }).outputText;
        const parsed = ts.createSourceFile("index.ts", readFileSync(path.join(__dirname, "../src/emoji/index.ts"), "utf8"), ts.ScriptTarget.Latest, true);
        const source = compile(parsed.statements.filter(node => ts.isVariableStatement(node) &&
            node.declarationList.declarations.some(item => ["openEmojiPanel", "genWeekdayOptions"].includes(item.name.getText(parsed))))
            .map(node => node.getText(parsed).replace(/^export /, "")).join("\n"));
        const helpers = {};
        for (const [name, file] of [["dynamicIcon", "emoji/dynamicIcon"], ["dateModel", "datePicker/model"], ["dateYearInput", "datePicker/yearInput"], ["dateField", "datePicker/field"], ["dateInline", "datePicker/inline"], ["escape", "util/escape"], ["iconValue", "emoji/iconValue"], ["contractFormData", "util/contractFormData"]]) {
            helpers[name] = compile(readFileSync(path.join(__dirname, "../src", `${file}.ts`), "utf8"));
        }
        const languages = JSON.parse(readFileSync(path.join(__dirname, "../appearance/langs/en.json"), "utf8"));
        const result = await win.webContents.executeJavaScript(`(() => { try { return (${cases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(helpers)}, ${JSON.stringify(languages)}); } catch (error) { return {error: error.stack}; } })()`);
        assert.equal(typeof result, "string", JSON.stringify(result));
        console.log(result);
        win.destroy();
        app.exit(0);
    })().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").test("icon selection defers document writes and supports database uploads on desktop and mobile", {
        timeout: 30000,
    }, async () => {
        const temporary = mkdtempSync(path.join(os.tmpdir(), "siyuan-emoji-panel-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const headlessArgs = process.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY ?
            ["--no-sandbox", "--disable-gpu", "--ozone-platform=headless"] : [];
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, temporary, ...headlessArgs], {env, windowsHide: true, timeout: 25000});
            assert.match(stdout, /Emoji panel uploads passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(temporary).startsWith("siyuan-emoji-panel-"));
            rmSync(temporary, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
