import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as keymapBindings from "../../util/keymapBindings";

const compiled = new Map<string, string>();
const loadModule = (path: string, globals: Record<string, unknown>, dependencies: Record<string, object>) => {
    if (!compiled.has(path)) {
        compiled.set(path, transpileModule(readFileSync(path, "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText);
    }
    const exports: any = {};
    runInNewContext(compiled.get(path), {exports, ...globals, require: (name: string) => dependencies[name] || {}});
    return exports;
};

const fixture = (mac = false) => {
    const calls: string[] = [];
    const general: Record<string, keymapBindings.IShortcutKeymap> = {
        goToDocumentStart: {default: "⌘Home", custom: "⌘Home"},
        goToDocumentEnd: {default: "⌘End", custom: "⌘End"},
    };
    const window = {siyuan: {config: {keymap: {editor: {general}, general: {}}}, languages: {
        goToDocumentStart: "Document start", goToDocumentEnd: "Document end",
    }}};
    const hotKey = loadModule("src/protyle/util/hotKey.ts", {window}, {
        "../../util/keymapBindings": keymapBindings,
        "../../constants": {Constants: {KEYCODELIST: {36: "Home", 35: "End", 65: "A"}}},
        "./compatibility": {
            isMac: () => mac,
            isNotCtrl: (event: KeyboardEvent) => !event.ctrlKey && !event.metaKey,
            isOnlyMeta: (event: KeyboardEvent) => mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey,
        },
    });
    const helper = loadModule("src/protyle/util/documentBoundaryHotkey.ts", {window}, {
        "./hotKey": hotKey,
        "../wysiwyg/commonHotkey": {goHome: () => calls.push("home"), goEnd: () => calls.push("end")},
        "../ui/hideElements": {hideElements: () => calls.push("hide")},
    });
    const protyle = {element: {contains: (target: any) => !target.outside}, wysiwyg: {element: {firstElementChild: {}}}};
    const event = (key: string, overrides: Record<string, unknown> = {}) => ({
        key, keyCode: key === "Home" ? 36 : key === "End" ? 35 : 65,
        ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false,
        target: {localName: "div", closest: (): unknown => null},
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation: () => calls.push("stop"),
        ...overrides,
    });
    return {window, calls, general, helper, protyle, event};
};

test("document boundary defaults retain platform modifiers and native plain and Shift keys", () => {
    for (const mac of [false, true]) {
        const f = fixture(mac);
        for (const key of ["Home", "End"]) {
            for (const overrides of [{}, {shiftKey: true}, mac ? {ctrlKey: true} : {metaKey: true}]) {
                assert.equal(f.helper.handleDocumentBoundaryHotkey(f.protyle, f.event(key, overrides)), false);
            }
            const event = f.event(key, mac ? {metaKey: true} : {ctrlKey: true});
            assert.equal(f.helper.handleDocumentBoundaryHotkey(f.protyle, event), true);
            assert.equal(event.defaultPrevented, true);
        }
        assert.deepEqual(f.calls, ["home", "hide", "stop", "end", "hide", "stop"]);
    }
});

test("document boundary bindings can be added, replaced and cleared without a default fallback", () => {
    const f = fixture();
    keymapBindings.setKeymapBindings(f.general.goToDocumentStart, ["Home", "⌘Home"]);
    keymapBindings.setKeymapBindings(f.general.goToDocumentEnd, ["End"]);
    for (const event of [f.event("Home"), f.event("Home", {ctrlKey: true}), f.event("End")]) {
        assert.equal(f.helper.handleDocumentBoundaryHotkey(f.protyle, event), true);
    }
    assert.equal(f.helper.handleDocumentBoundaryHotkey(f.protyle, f.event("End", {ctrlKey: true})), false);
    keymapBindings.setKeymapBindings(f.general.goToDocumentStart, []);
    for (const event of [f.event("Home"), f.event("Home", {ctrlKey: true})]) {
        assert.equal(f.helper.handleDocumentBoundaryHotkey(f.protyle, event), false);
    }
    assert.deepEqual(f.calls.filter(call => call === "home" || call === "end"), ["home", "home", "end"]);
});

test("document navigation preserves controls, composition and already handled events", () => {
    const f = fixture();
    keymapBindings.setKeymapBindings(f.general.goToDocumentStart, ["Home"]);
    for (const overrides of [{isComposing: true}, {defaultPrevented: true},
        {target: {closest: () => ({})}}]) {
        assert.equal(f.helper.handleDocumentBoundaryHotkey(f.protyle, f.event("Home", overrides)), false);
    }
    f.protyle.wysiwyg.element.firstElementChild = null;
    assert.equal(f.helper.handleDocumentBoundaryHotkey(f.protyle, f.event("Home")), false);
    assert.deepEqual(f.calls, []);
});

test("editable and readonly bodies handle configured navigation before local caret processing", async () => {
    const f = fixture();
    keymapBindings.setKeymapBindings(f.general.goToDocumentStart, ["Home"]);
    let handle: (event: unknown) => Promise<void>;
    const body = {firstElementChild: {}, addEventListener: (_type: string, callback: typeof handle) => handle = callback};
    const editor = {...f.protyle, disabled: false, wysiwyg: {element: body}};
    const module = loadModule("src/protyle/wysiwyg/keydown.ts", {window: f.window}, {
        "../util/documentBoundaryHotkey": f.helper,
        "../../util/keyboardDiagnostic": {logKeyboardDiagnostic: (): void => undefined},
        "./verticalNavigation": {bindVerticalNavigationReset: (): void => undefined},
        "../util/hasClosest": {hasClosestByAttribute: () => false},
        "../render/av/attributeValue": {getAVTemplateInteractiveElement: () => false},
    });
    module.keydown(editor, body);
    for (const readonly of [false, true]) {
        editor.disabled = readonly;
        const event = f.event("Home");
        await handle(event);
        assert.equal(event.defaultPrevented, true);
    }
    assert.deepEqual(f.calls, ["home", "hide", "stop", "home", "hide", "stop"]);
});

test("mobile navigation is limited to the current editor and does not dispatch twice", () => {
    const f = fixture();
    keymapBindings.setKeymapBindings(f.general.goToDocumentEnd, ["End"]);
    const module = loadModule("src/mobile/util/keydown.ts", {window: f.window}, {
        "../../protyle/util/documentBoundaryHotkey": f.helper,
        "../../util/keyboardDiagnostic": {logKeyboardDiagnostic: (): void => undefined},
        "../../boot/globalEvent/commonHotkey": {filterHotkey: () => false},
        "../editor": {getCurrentEditor: () => ({protyle: f.protyle})},
        "../../command/shortcutRuntime": {dispatchPluginShortcut: () => f.calls.push("plugin")},
    });
    const event = f.event("End");
    module.mobileKeydown({}, event);
    assert.equal(event.defaultPrevented, true);
    module.mobileKeydown({}, event);
    module.mobileKeydown({}, f.event("End", {target: {outside: true}}));
    assert.deepEqual(f.calls, ["end", "hide", "stop", "plugin"]);
});

test("scroll button labels follow multiple bindings and retain the action when cleared", () => {
    const f = fixture();
    const labels: Record<string, string> = {};
    const module = loadModule("src/protyle/scroll/index.ts", {window: f.window}, {
        "../../util/keymapBindings": keymapBindings,
        "../util/compatibility": {updateHotkeyTip: (key: string) => key.replace("⌘", "Ctrl+")},
    });
    const scroll = Object.create(module.Scroll.prototype);
    scroll.parentElement = {querySelector: (selector: string) => ({setAttribute: (_name: string, value: string) => labels[selector] = value})};
    scroll.updateHotkeyLabels();
    assert.equal(labels[".protyle-scroll__up"], "Document start Ctrl+Home");
    keymapBindings.setKeymapBindings(f.general.goToDocumentStart, ["Home", "⌘Home"]);
    keymapBindings.setKeymapBindings(f.general.goToDocumentEnd, []);
    scroll.updateHotkeyLabels();
    assert.equal(labels[".protyle-scroll__up"], "Document start Home / Ctrl+Home");
    assert.equal(labels[".protyle-scroll__down"], "Document end");
});
