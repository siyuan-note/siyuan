const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const fixtures = () => {
    const ts = require("typescript");
    return Object.fromEntries(["mobileConfirmDialog", "mobileInputDialog"].map(name => [name,
        ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/dialog", name + ".ts"), "utf8"), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
        }).outputText]));
};

const runCases = sources => {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    window.siyuan = {languages: {cancel: "Cancel", confirm: "Confirm", delete: "Delete"}};
    class Dialog {
        constructor(options) {
            this.element = document.createElement("div");
            this.element.className = "mobile-bottom-sheet-dialog";
            this.element.innerHTML = `<div class="b3-dialog__body">${options.content}</div>`;
            document.body.append(this.element);

        }
        focusWhenReady() {}
        bindInput() {}
    }
    const dependencies = {MobileDialog: Dialog, isMobile: () => true, Constants: {},
        escapeHtml: value => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")};
    const load = name => {
        const exports = {};
        new Function("require", "exports", sources[name])(() => dependencies, exports);
        return exports[name];
    };
    const confirmDialog = load("mobileConfirmDialog");
    const inputDialog = load("mobileInputDialog");
    const theme = {"--b3-theme-primary": "#3366ff", "--b3-theme-on-primary": "#ffffff",
        "--b3-theme-on-surface": "#222222", "--b3-theme-surface-lighter": "#eeeeee", "--b3-theme-error": "#ff3344"};
    for (const [name, value] of Object.entries(theme)) document.body.style.setProperty(name, value);
    const geometry = (dialog, width, stacked) => {
        dialog.element.style.width = width + "px";
        const group = dialog.element.querySelector(".mobile-sheet-action-group");
        const buttons = [...group.children];
        const box = group.getBoundingClientRect();
        const outer = dialog.element.getBoundingClientRect();
        check(Math.abs(box.left - outer.left - 16) < 1 && Math.abs(outer.right - box.right - 16) < 1, "16px side insets");
        let previous;
        for (const button of buttons) {
            const rect = button.getBoundingClientRect();
            check(rect.height >= 48, "48px minimum touch target");
            check(button.scrollWidth <= button.clientWidth, "labels fit without horizontal overflow");
            if (previous) {
                check(Math.abs(previous.width - rect.width) < 1, "equal action widths");
                check(Math.abs((stacked ? rect.top - previous.bottom : rect.left - previous.right) - 12) < 1, "12px gap");
            }
            previous = rect;
        }
        return buttons;
    };
    for (const dark of [false, true]) {
        document.body.style.setProperty("--b3-theme-surface-lighter", dark ? "#333333" : "#eeeeee");
        document.body.style.setProperty("--b3-theme-on-surface", dark ? "#eeeeee" : "#222222");
        for (const make of [() => confirmDialog("Title", "Text"),
            () => inputDialog({title: "Name", value: "", onConfirm() {}})]) {
            const dialog = make();
            const buttons = geometry(dialog, 390, false);
            check(buttons[0].textContent === "Cancel" && buttons[1].textContent === "Confirm", "cancel left and confirm right");
            check(getComputedStyle(buttons[1]).backgroundColor === "rgb(51, 102, 255)", "primary theme fill");
            check(getComputedStyle(buttons[0]).backgroundColor === (dark ? "rgb(51, 51, 51)" : "rgb(238, 238, 238)"), "neutral theme cancel");
            buttons[1].textContent = "A very long translated confirmation label with several words andaverylongunbrokentoken";
            geometry(dialog, 390, false);
            check(buttons[1].getBoundingClientRect().height > 48, "long text wraps naturally");
            geometry(dialog, 280, true);
            buttons[1].disabled = true;
            check(Number(getComputedStyle(buttons[1]).opacity) < 1, "disabled feedback remains visible");
            dialog.element.remove();
        }
    }
    const danger = confirmDialog("Delete", "Text", undefined, undefined, true,
        {label: "Extra", callback() {}});
    const buttons = geometry(danger, 390, true);
    check(getComputedStyle(buttons[2]).color === "rgb(255, 51, 68)", "danger remains red");
    check(danger.element.querySelector("[data-type=sheet-expand]") === null, "no expansion control is injected");
    danger.element.remove();
    const extra = inputDialog({title: "Name", value: "", onConfirm() {}, actions: [{text: "Extra", onClick() {}}]});
    geometry(extra, 390, true);
    extra.element.remove();

    for (const height of [200, 140, 100]) {
        for (const make of [() => confirmDialog("Title", "Content", undefined, undefined, false,
            {label: "An additional translated action with a long label", callback() {}}, "Confirm changes"),
        () => inputDialog({title: "Name", value: "", confirmText: "Confirm changes", onConfirm() {},
            actions: [{text: "An additional translated action with a long label", onClick() {}}]})]) {
            const dialog = make();
            dialog.element.classList.add("b3-dialog--open");
            dialog.element.style.width = "280px";
            const panel = document.createElement("div");
            panel.className = "b3-dialog__container mobile-bottom-sheet mobile-sheet-panel";
            panel.classList.toggle("mobile-sheet-panel--compact", height <= 160);
            panel.style.height = height + "px";
            panel.style.maxHeight = "none";
            panel.style.width = "280px";
            const grip = document.createElement("div");
            grip.className = "b3-menu__title b3-menu__title--root";
            const header = document.createElement("div");
            header.className = "b3-dialog__header";
            header.textContent = "A real sheet title";
            panel.append(grip, header, dialog.element.querySelector(".b3-dialog__body"));
            dialog.element.append(panel);
            const footer = panel.querySelector(".mobile-sheet-action-bar");
            const actions = [...footer.querySelectorAll(".mobile-sheet-action-group > button")];
            const cancel = actions[0];
            const confirm = actions.at(-1);
            const footerBox = footer.getBoundingClientRect();
            const panelBox = panel.getBoundingClientRect();
            check(footerBox.top >= panelBox.top && footerBox.bottom <= panelBox.bottom + 1,
                "constrained footer stays inside the sheet");
            check(footer.clientHeight > 0 && footer.scrollHeight > footer.clientHeight,
                "constrained action bar provides vertical scrolling");
            check(getComputedStyle(footer).overflowY === "auto", "action overflow is user-scrollable");
            for (const action of actions) check(action.getBoundingClientRect().height >= 48,
                "constrained buttons retain their touch target");
            footer.scrollTop = footer.scrollHeight;
            const confirmBox = confirm.getBoundingClientRect();
            check(confirmBox.bottom <= footerBox.bottom + 1 && confirmBox.top >= footerBox.top - 1,
                "scrolling brings the complete confirmation target inside the footer");
            confirm.focus({preventScroll: true});
            check(document.activeElement === confirm, "confirmation remains keyboard focusable");
            footer.scrollTop = 0;
            const cancelBox = cancel.getBoundingClientRect();
            check(cancelBox.top >= footerBox.top - 1 && cancelBox.bottom <= footerBox.bottom + 1,
                "scrolling back brings the complete cancellation target inside the footer");
            check(actions[0].textContent === "Cancel" && actions.at(-1).textContent === "Confirm changes",
                "constrained scrolling preserves action order");
            dialog.element.remove();
        }
    }
};

module.exports = {fixtures, runCases};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, width: 390, height: 844,
            webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false}});
        let code = 0;
        try {
            await win.loadURL("data:text/html,<html><body></body></html>");
            await win.webContents.insertCSS(require("sass").compile(path.join(__dirname, "../src/assets/scss/mobile.scss"),
                {logger: {warn() {}, debug() {}}}).css);
            const error = await win.webContents.executeJavaScript(`(() => {
                try { (${runCases.toString()})(${JSON.stringify(fixtures())}); }
                catch (error) { return error.stack; }
            })()`);
            assert.equal(error, undefined);
            console.log("Mobile dialog button cases passed");
        } catch (error) { console.error(error); code = 1; }
        finally { win.destroy(); app.exit(code); }
    });
} else if (require.main === module) {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("mobile confirmation and input actions have equal touch targets and wrap responsively", async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-mobile-buttons-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const result = await promisify(execFile)(require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 60000});
            assert.match(result.stdout, /Mobile dialog button cases passed/);
        }
        finally { fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100}); }
    });
}
