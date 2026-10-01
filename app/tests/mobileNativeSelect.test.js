const assert = require("node:assert/strict");
const {execFile} = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {test} = require("node:test");
const {promisify} = require("node:util");
const {ModuleKind, transpileModule} = require("typescript");

const runCases = source => {
    const check = require("node:assert/strict");
    const state = {};
    const dismissals = [];
    class Menu {
        constructor(_id, onClose, independent) {
            this.items = [];
            this.element = document.createElement("div");
            this.independent = independent;
            this.onClose = onClose;
            this.element.addEventListener("click", event => dismissals.push([this, event.detail]));
            state.menu = this;
        }
        addItem(item) { this.items.push(item); }
        open() { document.body.appendChild(this.element); }
        close() { this.element.remove(); this.onClose(); }
    }
    const api = {};
    new Function("require", "exports", source)(name => ({
        "../../plugin/Menu": {Menu},
        "../../util/escape": {escapeHtml: value => value.replace(/&/g, "&amp;").replace(/</g, "&lt;")},
    })[name], api);
    api.initMobileSelect();
    const host = document.createElement("div");
    host.innerHTML = `<select class="b3-select"><option value="same">First</option>
        <option value="same">Second</option><optgroup label="Group" disabled><option>Disabled</option></optgroup>
        <option hidden>Hidden</option></select>`;
    document.body.appendChild(host);
    const select = host.querySelector("select");
    const changes = [];
    for (const type of ["input", "change"]) {
        host.addEventListener(type, event => changes.push([event.type, event.target.selectedIndex]));
    }
    const pointer = new PointerEvent("pointerdown", {bubbles: true, cancelable: true});
    select.dispatchEvent(pointer);
    check.equal(pointer.defaultPrevented, true);
    select.click();
    check.equal(state.menu.independent, false);
    check.equal(api.getMobileSelectMenuElement(), state.menu.element);
    check.deepEqual(state.menu.items.map(item => item.label), ["First", "Second", "Group", "Disabled"]);
    check.equal(state.menu.items[0].current, true);
    check.equal(state.menu.items[3].disabled, true);
    check.equal(state.menu.items[0].click(), true);
    check.equal(changes.length, 0);
    check.equal(dismissals.at(-1)[1], "back");
    check.equal(state.menu.items[1].click(), true);
    check.equal(select.selectedIndex, 1);
    check.deepEqual(changes, [["input", 1], ["change", 1]]);
    check.equal(dismissals.at(-1)[1], "back");
    state.menu.close();
    check.equal(api.getMobileSelectMenuElement(), undefined);

    select.className = "b3-text-field";
    select.click();
    check.equal(api.getMobileSelectMenuElement(), state.menu.element);
    state.menu.close();
    select.className = "b3-select";

    host.className = "b3-menu";
    select.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
    check.equal(state.menu.independent, true);
    check.equal(state.menu.items[1].current, true);
    state.menu.items[3].click();
    check.equal(select.selectedIndex, 1);
    state.menu.close();
    for (const attribute of ["disabled", "multiple", "size"]) {
        select.setAttribute(attribute, attribute === "size" ? "3" : "");
        select.click();
        check.equal(api.getMobileSelectMenuElement(), undefined);
        select.removeAttribute(attribute);
    }
    select.click();
    host.remove();
    state.menu.items[0].click();
    check.equal(changes.length, 2);
    state.menu.close();

    document.body.appendChild(host);
    select.addEventListener("change", () => select.click(), {once: true});
    select.click();
    const replacedMenu = state.menu;
    const count = dismissals.length;
    check.equal(replacedMenu.items[0].click(), true);
    check.notEqual(state.menu, replacedMenu);
    check.equal(dismissals.length, count);
    state.menu.close();
    host.remove();
    return "Mobile native select cases passed";
};

test("mobile native select keeps form events, option groups and nested menu ownership", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const source = transpileModule(fs.readFileSync(path.join(__dirname, "../src/mobile/util/nativeSelect.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-mobile-select-test-"));
    const script = path.join(temporary, "run.cjs");
    fs.writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("(" + runCases.toString() + ")(" + JSON.stringify(source) + ")")}));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron"), [script], {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Mobile native select cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(os.tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-mobile-select-test-")) {
            fs.rmSync(temporary, {recursive: true, force: true});
        }
    }
});
