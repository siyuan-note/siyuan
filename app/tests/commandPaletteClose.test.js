const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");
const ts = require("typescript");
function fixture(delay, mobile = false) {
    const log = [];
    let now = 0;
    let counter = 0;
    const timers = [];
    const timeout = (fn, ms) => { timers.push({ fn, at: now + ms, seq: counter++ }); };
    const advance = ms => {
        const target = now + ms;
        for (;;) {
            timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
            if (!timers.length || timers[0].at > target)
                break;
            const next = timers.shift();
            now = next.at;
            next.fn();
        }
        now = target;
    };
    class Element {
        constructor(tag = "div") {
            this.tag = tag;
            this.style = {};
            this.dataset = {};
            this.children = [];
            this.attrs = {};
            this.listeners = {};
            this.selectorMap = {};
            this.isConnected = true;
            this.value = "";
            const classes = new Set();
            this.classList = { add: (...x) => x.forEach(c => classes.add(c)),
                remove: (...x) => x.forEach(c => classes.delete(c)), contains: x => classes.has(x) };
        }
        set innerHTML(html) {
            this.html = html;
            if (html.includes('class="b3-dialog"')) {
                const shell = new Element();
                shell.style.zIndex = html.match(/z-index: (\d+)/)[1];
                this.selectorMap[".b3-dialog"] = shell;
                this.selectorMap[".b3-dialog__container"] = new Element();
                this.selectorMap[".b3-dialog__scrim"] = new Element();
                this.selectorMap[".b3-dialog__close"] = new Element();
                this.selectorMap["#commands"] = new Element("ul");
                this.selectorMap[".b3-text-field"] = new Element("input");
            }
        }
        get innerHTML() { return this.html || ""; }
        setAttribute(k, v) { this.attrs[k] = v; }
        getAttribute(k) { return this.attrs[k] || null; }
        append(...nodes) { for (const n of nodes) {
            this.children.push(n);
            n.parent = this;
        } }
        replaceChildren(fragment) { this.children = fragment.children; }
        get firstElementChild() { return this.children[0]; }
        querySelector(selector) {
            if (selector === ".b3-list-item--focus")
                return this.children[0];
            return this.selectorMap[selector] || null;
        }
        addEventListener(name, fn) { this.listeners[name] = fn; }
        contains(node) { return node === this || Object.values(this.selectorMap).includes(node); }
        focus() { document.activeElement = this; }
        remove() { this.isConnected = false; log.push({ at: now, action: "dialog removed" }); }
    }
    const document = { body: new Element("body"), activeElement: null,
        createElement: tag => new Element(tag), createDocumentFragment: () => new Element("fragment"),
        addEventListener() { }, removeEventListener() { }, getElementById() { return null; } };
    document.activeElement = document.body;
    const menu = { element: new Element(), visible: false,
        closeSheet() { log.push({at: now, action: "sheet closed"}); },
        remove() {
            if (this.visible)
                log.push({ at: now, action: "resources removed" });
            this.visible = false;
            this.element.style.zIndex = "";
        },
        popup() {
            this.element.style.zIndex = String(++window.siyuan.zIndex);
            this.visible = true;
            log.push({ at: now, action: "resources opened", zIndex: this.element.style.zIndex });
        } };
    const window = { siyuan: { dialogs: [], menus: { menu }, zIndex: 10, storage: {},
            config: { keymap: { general: { commandPanel: {} } }, appearance: { lang: "zh-CN" } },
            languages: { commandPanel: "Commands" } }, getSelection: () => null };
    const load = (file, dependencies = {}) => {
        const exports = {};
        const compiled = ts.transpileModule(readFileSync(path.join(__dirname, "../src", file), "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText;
        runInNewContext(compiled, { exports, require: name => dependencies[name] || {},
            window, document, HTMLElement: Element, setTimeout: timeout, console,
            SIYUAN_VERSION: "qa", NODE_ENV: "development" });
        return exports;
    };
    const { Constants } = load("constants.ts");
    const zIndex = load("util/zIndex.ts");
    const { Dialog } = load("dialog/index.ts", {
        "../util/genID": { genUUID: () => "palette" }, "../util/zIndex": zIndex,
        "./moveResize": { moveResize() { } }, "../util/functions": { isMobile: () => false },
        "../constants": { Constants },
    });
    const lifecycle = load("command/paletteCore.ts");
    const command = { id: "core.insert.assets", label: () => "Assets" };
    const context = {};
    const { commandPanel } = load("boot/globalEvent/command/panel.ts", {
        "../../../dialog": { Dialog }, "../../../util/functions": { isMobile: () => mobile },
        "../../../constants": { Constants }, "../../../util/upDownHint": { upDownHint() { } },
        "../../../util/keymapBindings": {},
        "../../../protyle/util/compatibility": { updateHotkeyTip: x => x, setStorageVal() { } },
        "../../../protyle/util/hasClosest": { hasClosestByClassName: x => x },
        "../../../protyle/util/hotKey": { matchHotKey: (_keymap, event) => event.key === "Palette" },
        "../../../command/context": { captureCommandContext: () => context },
        "../../../command/insertCommands": { ensureInsertCommands() { } },
        "../../../command/executor": { ensureCommandSystem: () => ({}), executeCommandById: () => {
                log.push({ at: now, action: "assets command executed" });
                timeout(() => menu.popup(), delay);
                return Promise.resolve({ status: "executed" });
            } },
        "../../../command/english": { initializeEnglishCommandTranslations: () => Promise.resolve() },
        "../../../command/paletteCore": { ...lifecycle, queryCommandPalette: () => [command] },
    });
    return { commandPanel, menu, window, advance, log, Dialog, Constants, timeout: Constants.TIMEOUT_DBLCLICK };
}

test("palette shortcuts retain the existing query and Escape still cancels", () => {
    const f = fixture(0);
    f.commandPanel({}, {openOnly: true});
    const dialog = f.window.siyuan.dialogs[0];
    const input = dialog.element.querySelector(".b3-text-field");
    input.value = "query";
    f.commandPanel({}, {openOnly: true});
    assert.equal(f.window.siyuan.dialogs[0], dialog);
    let prevented = 0;
    for (const repeat of [false, true]) {
        input.listeners.keydown({key: "Palette", repeat, stopPropagation() {}, preventDefault() {prevented++;}});
        assert.equal(f.window.siyuan.dialogs[0], dialog);
        assert.equal(input.value, "query");
    }
    assert.equal(prevented, 2);
    input.listeners.keydown({key: "Escape", stopPropagation() {}, preventDefault() {}});
    f.advance(300);
    assert.equal(f.window.siyuan.dialogs.length, 0);
    assert.equal(f.log.some(item => item.action === "assets command executed"), false);
});

test("palette mouse entry still toggles and mobile shortcut keeps its sheet open", () => {
    const desktop = fixture(0);
    desktop.commandPanel({});
    desktop.commandPanel({});
    desktop.advance(300);
    assert.equal(desktop.window.siyuan.dialogs.length, 0);
    const mobile = fixture(0, true);
    mobile.menu.element.setAttribute("data-name", mobile.Constants.DIALOG_COMMANDPANEL);
    mobile.commandPanel({}, {openOnly: true});
    assert.equal(mobile.log.some(item => item.action === "sheet closed"), false);
    mobile.commandPanel({});
    assert.equal(mobile.log.filter(item => item.action === "sheet closed").length, 1);
});
for (const action of ["Enter", "click"]) {
    for (const responseDelay of [0, 10, 189, 190, 250]) {
        test(`palette ${action} preserves resources opened after ${responseDelay}ms`, () => {
            const f = fixture(responseDelay);
            f.commandPanel({});
            const dialog = f.window.siyuan.dialogs[0];
            const list = dialog.element.querySelector("#commands");
            const input = dialog.element.querySelector(".b3-text-field");
            const event = { key: "Enter", target: list.firstElementChild,
                stopPropagation() { }, preventDefault() { } };
            if (action === "Enter")
                input.listeners.keydown(event);
            else
                list.listeners.click(event);
            f.advance(300);
            assert.equal(f.menu.visible, true);
            assert.equal(f.log.filter(item => item.action === "resources removed").length, 0);
            assert.equal(f.window.siyuan.dialogs.length, 0);
        });
    }
}
test("closing a dialog still cleans up its existing menu exactly once", () => {
    const f = fixture(0);
    f.commandPanel({});
    const dialog = f.window.siyuan.dialogs[0];
    f.menu.popup();
    dialog.destroy();
    dialog.destroy();
    f.advance(300);
    assert.equal(f.menu.visible, false);
    assert.equal(f.log.filter(item => item.action === "resources removed").length, 1);
    assert.equal(f.log.filter(item => item.action === "dialog removed").length, 1);
});
test("reusing the same menu and DOM during dialog closing preserves the newer contents", () => {
    const f = fixture(0);
    f.commandPanel({});
    const dialog = f.window.siyuan.dialogs[0];
    f.menu.popup();
    dialog.destroy();
    f.advance(10);
    f.menu.remove();
    f.menu.popup();
    f.advance(300);
    assert.equal(f.menu.visible, true);
    assert.equal(f.log.filter(item => item.action === "resources removed").length, 1);
});
test("a replaced global menu is not owned by an earlier dialog cleanup", () => {
    const f = fixture(0);
    f.commandPanel({});
    f.menu.popup();
    f.window.siyuan.dialogs[0].destroy();
    let removed = false;
    const replacement = { element: f.menu.element, remove() { removed = true; } };
    f.window.siyuan.menus.menu = replacement;
    f.advance(300);
    assert.equal(removed, false);
});
test("a menu below the closing dialog is preserved", () => {
    const f = fixture(0);
    f.commandPanel({});
    f.menu.popup();
    f.menu.element.style.zIndex = "1";
    f.window.siyuan.dialogs[0].destroy();
    f.advance(300);
    assert.equal(f.menu.visible, true);
});

test("a menu closed before the dialog timer is not removed twice", () => {
    const f = fixture(0);
    f.commandPanel({});
    let removals = 0;
    const remove = f.menu.remove;
    f.menu.remove = () => { removals++; remove.call(f.menu); };
    f.menu.popup();
    f.window.siyuan.dialogs[0].destroy();
    f.menu.remove();
    f.advance(300);
    assert.equal(removals, 1);
});

test("Escape cancels the palette and cleans its current menu without executing a command", () => {
    const f = fixture(0);
    f.commandPanel({});
    const input = f.window.siyuan.dialogs[0].element.querySelector(".b3-text-field");
    f.menu.popup();
    input.listeners.keydown({key: "Escape", stopPropagation() {}, preventDefault() {}});
    f.advance(300);
    assert.equal(f.menu.visible, false);
    assert.equal(f.window.siyuan.dialogs.length, 0);
    assert.equal(f.log.some(item => item.action === "assets command executed"), false);
});
