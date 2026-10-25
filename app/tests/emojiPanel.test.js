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
    let sheets = 0;
    let disposed = 0;
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
        ...escape, ...values, ContractFormData, Dialog, EmojiPanelController,
        isMobile: () => mobile,
        dayjs: () => ({format: () => "2026-10-26"}),
        Constants: {LOCAL_EMOJIS: "emojis", DIALOG_EMOJIS: "emoji-panel"},
        genEmojiCategoryButtons: () => "", getEmojiTitle: () => "Custom",
        setPosition() {}, updateHotkeyTip: value => value, setStorageVal() {}, activeBlur() {},
        bindBottomSheetDialog: () => {sheets++; return () => disposed++;},
        reloadEmoji() {}, addEmoji: value => recent.push(value), showMessage: message => messages.push(message),
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
    check.equal(sheets, 2, "both mobile openings use the shared sheet");
    check.equal(disposed, sheets, "mobile sheet handlers are disposed on cancel and save");
    return "Emoji panel uploads passed";
};

if (process.versions.electron && process.type === "browser") {
    (async () => {
        const {app, BrowserWindow} = require("electron");
        app.setPath("userData", process.argv[2]);
        await app.whenReady();
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
        await win.loadURL("data:text/html,<html><body></body></html>");
        const ts = require("typescript");
        const compile = value => ts.transpileModule(value, {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
        }).outputText;
        const parsed = ts.createSourceFile("index.ts", readFileSync(path.join(__dirname, "../src/emoji/index.ts"), "utf8"), ts.ScriptTarget.Latest, true);
        const source = compile(parsed.statements.filter(node => ts.isVariableStatement(node) &&
            node.declarationList.declarations.some(item => ["openEmojiPanel", "genWeekdayOptions"].includes(item.name.getText(parsed))))
            .map(node => node.getText(parsed).replace(/^export /, "")).join("\n"));
        const helpers = {};
        for (const [name, file] of [["escape", "util/escape"], ["iconValue", "emoji/iconValue"], ["contractFormData", "util/contractFormData"]]) {
            helpers[name] = compile(readFileSync(path.join(__dirname, "../src", `${file}.ts`), "utf8"));
        }
        const languages = JSON.parse(readFileSync(path.join(__dirname, "../appearance/langs/en.json"), "utf8"));
        console.log(await win.webContents.executeJavaScript(`(${cases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(helpers)}, ${JSON.stringify(languages)})`));
        win.destroy();
        app.exit(0);
    })().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").test("database icons offer uploads and apply them only after successful selection on desktop and mobile", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 30000,
    }, async () => {
        const temporary = mkdtempSync(path.join(os.tmpdir(), "siyuan-emoji-panel-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, temporary], {env, windowsHide: true, timeout: 25000});
            assert.match(stdout, /Emoji panel uploads passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(temporary).startsWith("siyuan-emoji-panel-"));
            rmSync(temporary, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
