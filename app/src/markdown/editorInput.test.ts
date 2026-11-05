import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {MarkdownEditorMode} from "./editor";
import type {MarkdownEditorSnapshot} from "./contracts";

class TestElement {
    ownerDocument: {defaultView: {navigator: {userAgent: string}}};
    parent?: TestElement;
    listeners = new Map<string, Array<(event: object) => void>>();
    selectors = new Map<string, TestElement>();
    classList = {contains: () => false};
    hidden = false;
    value = "";
    onclick?: () => void;

    addEventListener(type: string, listener: (event: object) => void) {
        this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]);
    }
    removeEventListener(type: string, listener: (event: object) => void) {
        this.listeners.set(type, this.listeners.get(type)?.filter(item => item !== listener) ?? []);
    }
    contains(target: TestElement): boolean { return target === this || Boolean(target.parent && this.contains(target.parent)); }
    querySelector(selector: string) { return this.selectors.get(selector); }
    closest(): undefined { return undefined; }
    dispatchEvent() { this.onclick?.(); return true; }
}

const createHarness = async (mode: MarkdownEditorMode = "wysiwyg") => {
    let now = 0;
    let timerId = 0;
    const timers = new Map<number, {at: number; run: () => void}>();
    const setTimer = (run: () => void, delay = 0) => {
        timers.set(++timerId, {at: now + delay, run});
        return timerId;
    };
    const tick = (milliseconds: number) => {
        const end = now + milliseconds;
        for (;;) {
            const entry = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (!entry) break;
            now = entry[1].at;
            timers.delete(entry[0]);
            entry[1].run();
        }
        now = end;
    };
    const root = new TestElement();
    root.ownerDocument = {defaultView: {navigator: {userAgent: "test"}}};
    const surfaces = Object.fromEntries(["ir", "wysiwyg", "sv"].map(name => {
        const element = new TestElement();
        element.parent = root;
        return [name, {element, composingLock: false}];
    })) as Record<MarkdownEditorMode, {element: TestElement; composingLock: boolean}>;
    let value = "";
    let settings: {input(value: string): void; after(): void; preview: {parse(): void}};
    let currentMode = mode;
    let historyBaselines = 0;
    const snapshots: MarkdownEditorSnapshot[] = [];
    const pending: boolean[] = [];
    const normalize = (content: string) => content.replace(/^- {2,}/gm, "- ");
    const instance = {
        version: "4.0.2-alpha.0",
        vditor: {
            ...surfaces,
            lute: {GetEmojis: () => ({})},
            options: {hint: {emoji: {}}},
            toolbar: {element: new TestElement()},
            undo: {addToUndoStack: () => historyBaselines++},
        },
        getCurrentMode: () => currentMode,
        getValue: () => value,
        setValue(content: string) {
            value = normalize(content);
            settings.input(value);
            settings.preview.parse();
        },
        setPreviewMode() {},
        setTheme() { settings.input(value); },
        focus() {},
        destroy() {},
    };
    for (const next of ["ir", "wysiwyg", "sv"] as const) {
        const button = new TestElement();
        button.onclick = () => { currentMode = next; };
        root.selectors.set(`button[data-mode="${next}"]`, button);
    }
    const exports = {} as typeof import("./editor");
    const compiled = transpileModule(readFileSync("src/markdown/editor.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText;
    runInNewContext(compiled, {
        exports,
        require: () => ({
            MARKDOWN_DOCUMENT_BYTES: 8 * 1024 * 1024,
            MARKDOWN_RENDER_BYTES: 256 * 1024,
            MARKDOWN_RECOVERY_BYTES: 16 * 1024 * 1024,
            markdownByteLength: (content: string) => Buffer.byteLength(content),
            createMarkdownResourcePolicy: () => ({sanitize: (html: string) => html, restore: (html: string) => html,
                hydrate() {}, reset() {}, destroy() {}}),
        }),
        Node: TestElement, Element: TestElement, HTMLTextAreaElement: class extends TestElement {},
        MutationObserver: class { observe() {} disconnect() {} },
        Event: class {},
        queueMicrotask,
        setTimeout: setTimer,
        clearTimeout: (id: number) => timers.delete(id),
    });
    const original = "-    first\n- second\n";
    const factory = (_element: HTMLElement, options: Record<string, unknown>) => {
        settings = options as unknown as typeof settings;
        queueMicrotask(settings.after);
        return instance;
    };
    const editor = await exports.createMarkdownEditor({element: root as unknown as HTMLElement,
        initialValue: original, mode, cdn: "fixture", onEdit: snapshot => snapshots.push({...snapshot}),
        onEditPending: next => pending.push(next)}, factory as unknown as Parameters<typeof exports.createMarkdownEditor>[1]);
    const emit = (type: string, overrides: Record<string, unknown> = {}) => {
        const event = {target: surfaces[currentMode].element, key: "", code: "", ctrlKey: false, metaKey: false,
            altKey: false, shiftKey: false, isComposing: false, preventDefault() {}, stopImmediatePropagation() {}, ...overrides};
        root.listeners.get(type)?.forEach(listener => listener(event));
        if (type === "keydown" && event.ctrlKey && event.altKey && /^Digit[789]$/.test(event.code)) {
            currentMode = event.code === "Digit7" ? "wysiwyg" : event.code === "Digit8" ? "ir" : "sv";
        }
    };
    return {editor, original, snapshots, pending, tick, emit,
        setLive: (content: string) => { value = content; },
        input: (content = value) => settings.input(content),
        getMode: () => currentMode, historyBaselines: () => historyBaselines};
};

test("captured keyboard commands commit even without a native input event or Vditor input callback", async () => {
    for (const mode of ["wysiwyg", "ir", "sv"] as const) {
        for (const key of ["Backspace", "Delete", "Enter", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "j", ";"]) {
            const h = await createHarness(mode);
            h.emit("keydown", {key, ctrlKey: key === "j" || key === ";", shiftKey: key === "j" || key === ";"});
            assert.equal(h.pending.at(-1), true, `${mode} ${key} announces the input before a command mutates the editor`);
            h.setLive("first\n\n- second\n");
            const immediate = h.editor.flush();
            assert.equal(immediate.content, "first\n\n- second\n", `${mode} ${key} flush`);
            assert.equal(immediate.edited, true);
            h.tick(300);
            assert.equal(h.snapshots.length, 1);
            assert.equal(h.snapshots[0].content, immediate.content);
            assert.equal(h.pending.at(-1), false);
            h.editor.destroy();
        }
    }
});

test("keyboard intent keeps initialization, programmatic updates, navigation and composition separate from edits", async () => {
    const h = await createHarness();
    h.input(); h.tick(1000);
    assert.equal(h.editor.flush().content, h.original, "parser normalization does not rewrite the original");
    for (const key of ["ArrowRight", "Tab"]) {
        h.emit("keydown", {key}); h.tick(300);
        assert.equal(h.pending.at(-1), false, "unchanged keyboard intent resolves without an edit");
    }
    const pendingCount = h.pending.length;
    for (const key of ["Escape", "CapsLock", "F1", "F12", "Home", "End", "PageUp", "PageDown", "Shift", "Control", "Alt", "Meta"]) {
        h.emit("keydown", {key}); h.tick(300);
    }
    assert.equal(h.pending.length, pendingCount, "non-editing keys do not delay autosave");
    assert.equal(h.editor.flush().edited, false);
    assert.equal(h.snapshots.length, 0);
    h.emit("keydown", {key: "Backspace"});
    h.setLive("old pending change\n");
    h.input();
    h.editor.setValue("-    replacement\n");
    h.input("old pending change\n"); h.tick(1000);
    assert.equal(h.editor.flush().content, "-    replacement\n");
    assert.equal(h.editor.flush().edited, false);
    assert.equal(h.snapshots.length, 0);
    h.emit("compositionstart");
    h.emit("keydown", {key: "Enter", isComposing: true});
    h.setLive("composing\n"); h.input(); h.tick(1000);
    assert.equal(h.editor.flush().content, "-    replacement\n");
    assert.equal(h.editor.flush().composing, true);
    h.emit("compositionend"); h.tick(300);
    assert.equal(h.editor.flush().content, "composing\n");
    assert.equal(h.editor.flush().composing, false);
    h.editor.destroy();
});

test("native input, delayed callbacks and mode changes retain the newest keyboard edit exactly once", async () => {
    const h = await createHarness();
    h.emit("keydown", {key: "Backspace"});
    h.setLive("first change\n"); h.input();
    h.tick(100);
    h.emit("keydown", {key: "Enter"});
    h.setLive("second change\n"); h.emit("input");
    assert.equal(h.editor.flush().content, "second change\n", "new input invalidates the older cached callback");
    h.input(); h.tick(300);
    assert.equal(h.snapshots.length, 1);
    assert.equal(h.snapshots[0].content, "second change\n");
    h.emit("keydown", {key: "Tab"}); h.setLive("before mode switch\n");
    h.editor.setMode("ir");
    assert.equal(h.editor.flush().content, "before mode switch\n");
    assert.equal(h.snapshots.length, 2, "the previous mode commits its last keyboard edit before changing the baseline");
    assert.equal(h.historyBaselines(), 1);
    h.tick(1000);
    assert.equal(h.snapshots.length, 2);
    h.editor.setValue("programmatic\n"); h.editor.setTheme("dark"); h.editor.setMode("sv"); h.tick(1000);
    assert.equal(h.editor.flush().edited, false);
    assert.equal(h.snapshots.length, 2);
    h.editor.destroy();
});


test("mode keyboard shortcuts preserve a pending command before synchronizing the baseline", async () => {
    const h = await createHarness();
    h.emit("keydown", {key: "Backspace"}); h.setLive("before keyboard mode switch\n");
    h.emit("keydown", {key: "8", code: "Digit8", ctrlKey: true, altKey: true});
    await Promise.resolve();
    assert.equal(h.getMode(), "ir");
    assert.equal(h.editor.flush().content, "before keyboard mode switch\n");
    assert.equal(h.snapshots.length, 1);
    h.tick(1000);
    assert.equal(h.pending.at(-1), false);
    assert.equal(h.snapshots.length, 1);
    h.editor.destroy();
});
