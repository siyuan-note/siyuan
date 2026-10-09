import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const loadSource = (source: string, globals: Record<string, unknown>) => {
    const compiled = transpileModule(source, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const exports: any = {};
    runInNewContext(compiled, {exports, ...globals});
    return exports;
};

const loadDialogMethods = (globals: Record<string, unknown>) => {
    const path = "src/dialog/index.ts";
    const source = createSourceFile(path, readFileSync(path, "utf8"), ScriptTarget.ES2021, true);
    const declaration = source.statements.find(statement => isClassDeclaration(statement) &&
        statement.name?.text === "Dialog");
    assert.ok(declaration && isClassDeclaration(declaration));
    const names = ["destroying", "trapFocus", "destroy"];
    const members = declaration.members.filter(member => names.includes(member.name?.getText(source)));
    assert.equal(members.length, names.length);
    return loadSource(`export class Dialog {${members.map(member => member.getText(source)).join("\n")}}`, globals).Dialog;
};

class TestElement {
    public parentElement: TestElement | null = null;
    public children: TestElement[] = [];
    public dataset: Record<string, string> = {};
    public style = {zIndex: "0", visibility: "visible"};
    public tabIndex = -1;
    public isContentEditable = false;
    public disabled = false;
    public hidden = false;
    public inert = false;
    private attributes = new Set<string>();
    private classes = new Set<string>();
    public classList = {
        add: (value: string) => this.classes.add(value),
        remove: (value: string) => this.classes.delete(value),
        contains: (value: string) => this.classes.has(value),
    };

    constructor(private document: any, public tagName = "div", className = "") {
        className.split(" ").filter(Boolean).forEach(value => this.classes.add(value));
        if (["button", "input", "select", "textarea"].includes(tagName)) {
            this.tabIndex = 0;
        }
    }

    get isConnected(): boolean {
        return this === this.document.body || !!this.parentElement?.isConnected;
    }

    public append(child: TestElement) {
        child.remove();
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    public remove() {
        if (this.contains(this.document.activeElement)) {
            this.document.activeElement = this.document.body;
        }
        if (this.parentElement) {
            this.parentElement.children = this.parentElement.children.filter(child => child !== this);
            this.parentElement = null;
        }
    }

    public contains(element: TestElement): boolean {
        return !!element && (element === this || this.children.some(child => child.contains(element)));
    }

    public matches(selector: string): boolean {
        if (selector.includes(",")) {
            return selector.split(",").some(value => this.matches(value.trim()));
        }
        if (selector.startsWith(".")) {
            return this.classes.has(selector.slice(1));
        }
        if (selector === ":disabled") {
            return this.disabled;
        }
        if (selector === "[inert]") {
            return this.inert;
        }
        if (selector === '[data-dialog-closing="true"]') {
            return this.dataset.dialogClosing === "true";
        }
        if (selector === "[contenteditable]") {
            return this.hasAttribute("contenteditable") || this.isContentEditable;
        }
        if (selector === "[tabindex]") {
            return this.hasAttribute("tabindex");
        }
        return this.tagName === selector;
    }

    public closest(selector: string): TestElement | null {
        return this.matches(selector) ? this : this.parentElement?.closest(selector) || null;
    }

    public querySelectorAll(selector: string): TestElement[] {
        return this.children.flatMap(child => [
            ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
        ]);
    }

    public querySelector(selector: string) {
        return this.querySelectorAll(selector)[0] || null;
    }

    public hasAttribute(name: string) {
        return this.attributes.has(name);
    }

    public setAttribute(name: string, value: string) {
        this.attributes.add(name);
        if (name === "tabindex") {
            this.tabIndex = Number(value);
        }
    }

    public getClientRects() {
        return this.isConnected && !this.hidden ? [{}] : [];
    }

    public focus() {
        this.document.activeElement = this;
    }
}

const keyboardEvent = (shiftKey = false, key = "Tab") => ({
    key,
    shiftKey,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
});

const fixture = () => {
    const timers: Array<() => void> = [];
    const removedListeners: unknown[][] = [];
    const document: any = {
        removeEventListener: (...args: unknown[]) => removedListeners.push(args),
        getElementById: (): null => null,
    };
    const element = (tagName = "div", className = "") => new TestElement(document, tagName, className);
    document.body = element("body");
    document.activeElement = document.body;
    const menu = {element: document.body.append(element()), remove: (): void => undefined};
    const window = {siyuan: {blockPanels: [] as any[], dialogs: [] as any[], menus: {menu}}};
    const globals = {window, document};
    const ownership = loadSource(readFileSync("src/block/panelOwnership.ts", "utf8"), globals);
    const zIndex = loadSource(readFileSync("src/util/zIndex.ts", "utf8"), globals);
    const Dialog = loadDialogMethods({
        ...globals, ...ownership, ...zIndex,
        Constants: {TIMEOUT_DBLCLICK: 200},
        setTimeout: (callback: () => void) => timers.push(callback),
        getComputedStyle: (node: TestElement) => node.style,
    });
    const dialog = () => {
        const instance = new Dialog();
        instance.id = `dialog-${window.siyuan.dialogs.length}`;
        instance.element = document.body.append(element());
        instance.element.classList.add("b3-dialog--open");
        const overlay = instance.element.append(element("div", "b3-dialog"));
        overlay.style.zIndex = String(10 + window.siyuan.dialogs.length * 10);
        const container = overlay.append(element("div", "b3-dialog__container"));
        const first = container.append(element("button"));
        const last = container.append(element("input"));
        window.siyuan.dialogs.push(instance);
        return {instance, wrapper: instance.element as TestElement, overlay, container, first, last};
    };
    const destroyed: string[] = [];
    const panel = (name: string, anchor?: TestElement, pinned = false) => {
        const node = document.body.append(element("div", "block__popover")) as TestElement;
        node.dataset.pin = String(pinned);
        node.style.zIndex = "100";
        ownership.registerBlockPanelOwner(node, anchor);
        const first = node.append(element("button"));
        const last = node.append(element("button"));
        const item = {element: node, destroy: () => {
            destroyed.push(name);
            node.remove();
            window.siyuan.blockPanels = window.siyuan.blockPanels.filter(value => value !== item);
        }};
        window.siyuan.blockPanels.push(item);
        return {item, element: node, first, last};
    };
    return {document, window, element, ownership, dialog, panel, destroyed, timers, removedListeners};
};

test("panel ownership survives detached and moved recent-document anchors", () => {
    const f = fixture();
    const owner = f.dialog();
    const other = f.dialog();
    const preview = f.panel("preview", owner.first);
    owner.first.remove();
    assert.equal(f.ownership.getDialogBlockPanel(owner.wrapper, preview.last), preview.element);
    other.container.append(owner.first);
    assert.equal(f.ownership.getDialogBlockPanel(owner.wrapper, preview.last), preview.element);
    assert.equal(f.ownership.getDialogBlockPanel(other.wrapper, preview.last), undefined);
    assert.equal(f.ownership.getDialogBlockPanel(owner.wrapper, other.first), undefined);
    assert.equal(f.ownership.getDialogBlockPanel(owner.wrapper, null), undefined);
});

test("nested panels inherit their original dialog even after ancestor anchors detach", () => {
    const f = fixture();
    const owner = f.dialog();
    const parent = f.panel("parent", owner.first);
    owner.first.remove();
    const child = f.panel("child", parent.last);
    parent.element.remove();
    const grandchild = f.panel("grandchild", child.last);
    for (const preview of [parent, child, grandchild]) {
        assert.equal(f.ownership.getDialogBlockPanel(owner.wrapper, preview.last), preview.element);
    }
});

test("dialog cleanup snapshots nested panels and destroys children before parents", () => {
    const f = fixture();
    const owner = f.dialog();
    const parent = f.panel("parent", owner.first);
    const child = f.panel("child", parent.last);
    f.panel("grandchild", child.last);
    f.ownership.destroyDialogBlockPanels(owner.wrapper);
    assert.deepEqual(f.destroyed, ["grandchild", "child", "parent"]);
    assert.equal(f.window.siyuan.blockPanels.length, 0);
    f.ownership.destroyDialogBlockPanels(owner.wrapper);
    assert.deepEqual(f.destroyed, ["grandchild", "child", "parent"]);
});

test("dialog cleanup preserves pinned panels and unrelated panels without changing ownership", () => {
    const f = fixture();
    const owner = f.dialog();
    const other = f.dialog();
    const parent = f.panel("parent", owner.first);
    const pinned = f.panel("pinned", parent.last, true);
    f.panel("child", pinned.last);
    const unrelated = f.panel("unrelated", other.first);
    const unowned = f.panel("unowned");
    f.ownership.destroyDialogBlockPanels(owner.wrapper);
    owner.wrapper.remove();
    assert.deepEqual(f.destroyed, ["child", "parent"]);
    assert.deepEqual(f.window.siyuan.blockPanels, [pinned.item, unrelated.item, unowned.item]);
    assert.equal(f.ownership.getDialogBlockPanel(owner.wrapper, pinned.last), pinned.element);
    assert.equal(f.ownership.getDialogBlockPanel(other.wrapper, pinned.last), undefined);
    pinned.element.dataset.pin = "false";
    f.ownership.destroyDialogBlockPanels(owner.wrapper);
    assert.deepEqual(f.destroyed, ["child", "parent", "pinned"]);
    assert.equal(unrelated.element.isConnected, true);
    assert.equal(unowned.element.isConnected, true);
});

test("preview targets must remain connected and outside a closing dialog", () => {
    const f = fixture();
    const owner = f.dialog();
    assert.equal(f.ownership.isBlockPanelTargetAvailable(owner.first), true);
    owner.wrapper.dataset.dialogClosing = "true";
    assert.equal(owner.first.isConnected, true);
    assert.equal(f.ownership.isBlockPanelTargetAvailable(owner.first), false);
    delete owner.wrapper.dataset.dialogClosing;
    assert.equal(f.ownership.isBlockPanelTargetAvailable(owner.first), true);
    owner.first.remove();
    assert.equal(f.ownership.isBlockPanelTargetAvailable(owner.first), false);
});

test("Dialog.destroy marks closing and clears owned previews synchronously and only once", () => {
    const f = fixture();
    const owner = f.dialog();
    const preview = f.panel("preview", owner.first);
    const pinned = f.panel("pinned", owner.last, true);
    const unrelated = f.panel("unrelated");
    const destroyPanel = preview.item.destroy;
    preview.item.destroy = () => {
        assert.equal(owner.wrapper.dataset.dialogClosing, "true");
        assert.equal(f.ownership.isBlockPanelTargetAvailable(owner.first), false);
        assert.equal(owner.instance.destroying, true);
        assert.equal(f.removedListeners.length, 1);
        destroyPanel();
    };
    let callbacks = 0;
    const options = {reason: "close"};
    owner.instance.destroyCallback = (value: unknown) => {
        assert.equal(value, options);
        callbacks++;
    };
    owner.instance.destroy(options);
    owner.instance.destroy(options);
    assert.equal(owner.wrapper.isConnected, true);
    assert.equal(owner.wrapper.classList.contains("b3-dialog--open"), false);
    assert.deepEqual(f.destroyed, ["preview"]);
    assert.deepEqual(f.removedListeners, [["keydown", owner.instance.trapFocus, true]]);
    assert.equal(callbacks, 0);
    assert.equal(f.timers.length, 1);
    f.timers.shift()();
    assert.equal(owner.wrapper.isConnected, false);
    assert.equal(f.window.siyuan.dialogs.length, 0);
    assert.equal(callbacks, 1);
    assert.deepEqual(f.window.siyuan.blockPanels, [pinned.item, unrelated.item]);
});

test("Tab in an owned Protyle body remains editor-owned in both directions", () => {
    const f = fixture();
    const owner = f.dialog();
    const preview = f.panel("preview", owner.first);
    const body = preview.element.append(f.element("div", "protyle-wysiwyg"));
    body.isContentEditable = true;
    const block = body.append(f.element());
    block.isContentEditable = true;
    for (const active of [body, block]) {
        for (const shiftKey of [false, true]) {
            active.focus();
            const event = keyboardEvent(shiftKey);
            owner.instance.trapFocus(event);
            assert.equal(event.defaultPrevented, false);
            assert.equal(event.propagationStopped, false);
            assert.equal(f.document.activeElement, active);
        }
    }
});

test("Tab in a readonly Protyle body or embedded input remains panel-trapped", () => {
    for (const mode of ["readonly", "input"]) {
        const f = fixture();
        const owner = f.dialog();
        const preview = f.panel("preview", owner.first);
        const body = preview.element.append(f.element("div", "protyle-wysiwyg"));
        body.isContentEditable = mode !== "readonly";
        body.setAttribute("tabindex", "0");
        const active = mode === "readonly" ? body : body.append(f.element("input"));
        active.focus();
        const event = keyboardEvent();
        owner.instance.trapFocus(event);
        assert.equal(event.defaultPrevented, true, mode);
        assert.equal(event.propagationStopped, true, mode);
        assert.equal(f.document.activeElement, preview.first, mode);
    }
});

test("Tab from a non-tabbable readonly body returns to the owned panel controls", () => {
    const f = fixture();
    const owner = f.dialog();
    const preview = f.panel("preview", owner.first);
    const body = preview.element.append(f.element("div", "protyle-wysiwyg"));
    body.setAttribute("contenteditable", "false");
    assert.equal(body.tabIndex, -1);
    for (const shiftKey of [false, true]) {
        body.focus();
        const event = keyboardEvent(shiftKey);
        owner.instance.trapFocus(event);
        assert.equal(event.defaultPrevented, true);
        assert.equal(event.propagationStopped, true);
        assert.equal(f.document.activeElement, shiftKey ? preview.last : preview.first);
    }
});

test("Tab wraps within owned panel controls, including nested panels", () => {
    const f = fixture();
    const owner = f.dialog();
    const parent = f.panel("parent", owner.first);
    const child = f.panel("child", parent.last);
    owner.first.remove();
    for (const preview of [parent, child]) {
        for (const shiftKey of [false, true]) {
            (shiftKey ? preview.first : preview.last).focus();
            const event = keyboardEvent(shiftKey);
            owner.instance.trapFocus(event);
            assert.equal(event.defaultPrevented, true);
            assert.equal(event.propagationStopped, true);
            assert.equal(f.document.activeElement, shiftKey ? preview.last : preview.first);
        }
        preview.first.focus();
        const event = keyboardEvent();
        owner.instance.trapFocus(event);
        assert.equal(event.defaultPrevented, false);
        assert.equal(event.propagationStopped, false);
    }
});

test("unrelated panels and panels behind the dialog cannot escape modal focus", () => {
    for (const mode of ["unowned", "other-dialog", "behind"]) {
        const f = fixture();
        const other = f.dialog();
        const owner = f.dialog();
        const preview = f.panel("preview", mode === "unowned" ? undefined :
            mode === "other-dialog" ? other.first : owner.first);
        if (mode === "behind") {
            preview.element.style.zIndex = "0";
        }
        const body = preview.element.append(f.element("div", "protyle-wysiwyg"));
        body.isContentEditable = true;
        for (const active of [preview.last, body]) {
            for (const shiftKey of [false, true]) {
                active.focus();
                const event = keyboardEvent(shiftKey);
                owner.instance.trapFocus(event);
                assert.equal(event.defaultPrevented, true, mode);
                assert.equal(event.propagationStopped, true, mode);
                assert.equal(f.document.activeElement, shiftKey ? owner.last : owner.first, mode);
            }
        }
    }
});

test("an upper Dialog controls focus while a lower dialog owns the preview", () => {
    const f = fixture();
    const lower = f.dialog();
    const preview = f.panel("preview", lower.first);
    const upper = f.dialog();
    for (const shiftKey of [false, true]) {
        preview.last.focus();
        const event = keyboardEvent(shiftKey);
        lower.instance.trapFocus(event);
        assert.equal(event.defaultPrevented, false);
        assert.equal(f.document.activeElement, preview.last);
        upper.instance.trapFocus(event);
        assert.equal(event.defaultPrevented, true);
        assert.equal(event.propagationStopped, true);
        assert.equal(f.document.activeElement, shiftKey ? upper.last : upper.first);
    }
});

test("closing a child Dialog restores focus to its parent dialog's owned preview", () => {
    const f = fixture();
    const owner = f.dialog();
    const preview = f.panel("preview", owner.first);
    preview.last.focus();
    const child = f.dialog();
    child.instance.previousFocus = preview.last;
    child.first.focus();
    child.instance.destroy();
    assert.equal(f.document.activeElement, child.first);
    f.timers.shift()();
    assert.equal(f.document.activeElement, preview.last);
    assert.deepEqual(f.window.siyuan.dialogs, [owner.instance]);
    assert.equal(preview.element.isConnected, true);
});

test("closing a child Dialog does not restore focus to unrelated or covered previews", () => {
    for (const mode of ["unowned", "other-dialog", "behind"]) {
        const f = fixture();
        const other = f.dialog();
        const owner = f.dialog();
        const preview = f.panel("preview", mode === "unowned" ? undefined :
            mode === "other-dialog" ? other.first : owner.first);
        if (mode === "behind") {
            preview.element.style.zIndex = "0";
        }
        const child = f.dialog();
        child.instance.previousFocus = preview.last;
        child.first.focus();
        child.instance.destroy();
        f.timers.shift()();
        assert.equal(f.document.activeElement, f.document.body, mode);
        assert.equal(preview.element.isConnected, true, mode);
    }
});

test("child Dialog cleanup preserves focus taken by another control or its close callback", () => {
    for (const fromCallback of [false, true]) {
        const f = fixture();
        const owner = f.dialog();
        const preview = f.panel("preview", owner.first);
        const child = f.dialog();
        child.instance.previousFocus = preview.last;
        child.first.focus();
        if (fromCallback) {
            child.instance.destroyCallback = () => owner.last.focus();
        }
        child.instance.destroy();
        if (!fromCallback) {
            owner.last.focus();
        }
        f.timers.shift()();
        assert.equal(f.document.activeElement, owner.last);
    }
});

test("closing dialogs and non-Tab keys do not intercept panel focus", () => {
    const f = fixture();
    const owner = f.dialog();
    const preview = f.panel("pinned", owner.first, true);
    preview.last.focus();
    const escape = keyboardEvent(false, "Escape");
    owner.instance.trapFocus(escape);
    assert.equal(escape.defaultPrevented, false);
    owner.instance.destroy();
    const tab = keyboardEvent();
    owner.instance.trapFocus(tab);
    assert.equal(tab.defaultPrevented, false);
    assert.equal(tab.propagationStopped, false);
    assert.equal(f.document.activeElement, preview.last);
});
