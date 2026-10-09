import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {describe, it} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as locationValue from "./locationValue";

const compiled = transpileModule(readFileSync("src/protyle/render/av/locationEditor.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
}).outputText;

class Control {
    value = "";
    disabled = false;
    textContent = "";
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    listeners = new Map<string, (event: any) => void>();
    classes = new Set<string>();
    classList = {
        toggle: (name: string, enabled: boolean) => enabled ? this.classes.add(name) : this.classes.delete(name),
    };
    focused = false;
    focus() {
        this.focused = true;
    }
    appendChild() {}
    addEventListener(name: string, handler: (event: any) => void) {
        this.listeners.set(name, handler);
    }
    dispatch(name: string, event = {}) {
        this.listeners.get(name)?.(event);
    }
}

const createEditor = (options: {
    value?: IAVCellLocationValue;
    mobile?: boolean;
    isValid?: () => boolean;
    alreadyOpen?: boolean;
    save?: (value: IAVCellLocationValue) => Promise<void>;
} = {}) => {
    const fields = Object.fromEntries(["name", "latitude", "longitude", "coordinateSystem", "paste"]
        .map(name => [name, new Control()]));
    const buttons = Object.fromEntries(["save", "clear", "cancel", "parse"].map(name => [name, new Control()]));
    const container = new Control();
    const error = new Control();
    const lifecycle: string[] = [];
    const saved: IAVCellLocationValue[] = [];
    const owner = {isConnected: true};
    const root = Object.assign(new Control(), {
        contains: () => true,
        querySelector: (selector: string) => {
            if (selector === ".b3-dialog__container") {
                return container;
            }
            if (selector === '[data-role="error"]') {
                return error;
            }
            const field = selector.match(/data-field="(\w+)"/);
            const action = selector.match(/data-action="(\w+)"/);
            return field ? fields[field[1]] : buttons[action[1]];
        },
        querySelectorAll: () => [...Object.values(fields), ...Object.values(buttons)],
    });
    let markup = "";
    let ownerChanged: () => void;
    let closeSheet: () => Promise<void>;
    class MockDialog {
        element = root;
        options: {destroyCallback: () => void};
        constructor(settings: {content: string; destroyCallback: () => void}) {
            markup = settings.content;
            this.options = settings;
        }
        destroy() {
            lifecycle.push("destroy");
            this.options.destroyCallback();
        }
    }
    const methods = {} as typeof import("./locationEditor");
    const modules: Record<string, unknown> = {
        "../../../dialog": {Dialog: MockDialog},
        "../../../util/escape": {escapeHtml: (text: string) => text},
        "../../../util/functions": {isMobile: () => !!options.mobile},
        "../../../mobile/util/bindBottomSheetDialog": {bindBottomSheetDialog: (_dialog: unknown, close: () => Promise<void>) => {
            closeSheet = close;
            lifecycle.push("sheet");
            return () => lifecycle.push("dispose-sheet");
        }},
        "../../../mobile/util/keyboardToolbar": {activeBlur: () => lifecycle.push("blur")},
        "./editorSession": {beginAVEditorSession: () => {
            lifecycle.push("session");
            return () => lifecycle.push("end-session");
        }},
        "./locationValue": locationValue,
        "./cellEditor": {AV_CELL_EDITOR_CLOSE_EVENT: "siyuan-av-cell-editor-close"},
    };
    runInNewContext(compiled, {
        exports: methods,
        require: (name: string) => modules[name],
        Error,
        window: {siyuan: {languages: new Proxy({}, {get: (_target, property) => String(property)})}},
        document: {body: {}, activeElement: null, createElement: () => new Control(),
            querySelector: () => options.alreadyOpen ? {} : null},
        MutationObserver: class {
            constructor(callback: () => void) {
                ownerChanged = callback;
            }
            observe() {}
            disconnect() {
                lifecycle.push("disconnect");
            }
        },
    });
    const dialog = methods.openAVLocationEditor({
        value: options.value,
        ownerElement: owner as HTMLElement,
        avBlockID: "database-block",
        isValid: options.isValid,
        onSave: async value => {
            saved.push(JSON.parse(JSON.stringify(value)));
            await options.save?.(value);
        },
        onDestroy: () => lifecycle.push("on-destroy"),
    });
    return {
        fields, buttons, error, root, lifecycle, saved, owner, dialog, markup,
        ownerChanged: () => ownerChanged(),
        closeSheet: () => closeSheet(),
        settle: () => new Promise<void>(resolve => setImmediate(resolve)),
        key: (key: string, extra: Record<string, unknown> = {}) => root.dispatch("keydown", {
            key, preventDefault() {}, stopPropagation() {}, ...extra,
        }),
    };
};

describe("database location editor", () => {
    it("does not create overlapping editors on repeated open events", () => {
        const editor = createEditor({alreadyOpen: true});
        assert.equal(editor.dialog, undefined);
        assert.deepEqual(editor.lifecycle, ["on-destroy"]);
        assert.equal(editor.markup, "");
    });
    it("cancels on navigation even when the reused editor owner remains connected", async () => {
        const editor = createEditor();
        editor.fields.name.value = "Unsaved";
        editor.root.dispatch("siyuan-av-cell-editor-close");
        editor.buttons.save.dispatch("click");
        await editor.settle();
        assert.equal(editor.saved.length, 0);
        assert.equal(editor.owner.isConnected, true);
        assert.equal(editor.lifecycle.filter(item => item === "destroy").length, 1);
    });

    it("rejects a stale block or row identity without waiting for the owner to disconnect", async () => {
        let current = true;
        const editor = createEditor({isValid: () => current});
        editor.fields.name.value = "Unsaved";
        current = false;
        editor.buttons.save.dispatch("click");
        await editor.settle();
        assert.equal(editor.saved.length, 0);
        assert.equal(editor.owner.isConnected, true);
        assert.equal(editor.lifecycle.includes("destroy"), true);
    });

    it("keeps raw invalid coordinate input visible after Save", async () => {
        const editor = createEditor();
        for (const [latitude, longitude] of [["oops", "0"], ["0", ""], ["91", "0"], ["0", "181"], ["1e2", "0"]]) {
            editor.fields.latitude.value = latitude;
            editor.fields.longitude.value = longitude;
            editor.buttons.save.dispatch("click");
            await editor.settle();
            assert.equal(editor.error.textContent, "invalidCoordinates");
            assert.equal(editor.fields.latitude.value, latitude);
            assert.equal(editor.fields.longitude.value, longitude);
        }
        assert.equal(editor.saved.length, 0);
        assert.equal(editor.lifecycle.includes("destroy"), false);
    });

    it("preserves exact provenance when only the name changes", async () => {
        const initial = {name: "Old", latitude: 0, longitude: 0, originalInput: " 0.00, +0 "};
        const editor = createEditor({value: initial});
        assert.equal(editor.fields.paste.value, initial.originalInput);
        editor.fields.name.value = "New";
        editor.buttons.save.dispatch("click");
        await editor.settle();
        assert.deepEqual(editor.saved, [{...initial, name: "New", coordinateSystem: "unknown"}]);
        assert.equal(initial.name, "Old");
    });

    it("clears provenance on manual coordinates or CRS changes", async () => {
        for (const field of ["latitude", "longitude", "coordinateSystem"]) {
            const editor = createEditor({value: {latitude: 0, longitude: 0, originalInput: "0,0"}});
            editor.fields[field].value = field === "coordinateSystem" ? "gcj02" : "1";
            editor.fields[field].dispatch(field === "coordinateSystem" ? "change" : "input");
            editor.buttons.save.dispatch("click");
            await editor.settle();
            assert.equal(editor.saved.length, 1);
            assert.equal(editor.saved[0].originalInput, "");
            assert.equal(editor.fields.paste.value, "");
        }
    });

    it("keeps failed imports and existing coordinates untouched, then saves an exact re-paste", async () => {
        const editor = createEditor({value: {latitude: 0, longitude: 0, originalInput: "0,0"}});
        editor.fields.paste.value = "121,31";
        editor.buttons.parse.dispatch("click");
        assert.equal(editor.error.textContent, "invalidCoordinates");
        assert.equal(editor.fields.paste.value, "121,31");
        assert.equal(editor.fields.latitude.value, "0");
        assert.equal(editor.fields.longitude.value, "0");
        editor.buttons.save.dispatch("click");
        await editor.settle();
        assert.equal(editor.saved.length, 0);
        assert.equal(editor.lifecycle.includes("destroy"), false);
        const source = " +0.00, 0.000\n";
        editor.fields.paste.value = source;
        editor.buttons.parse.dispatch("click");
        editor.buttons.save.dispatch("click");
        await editor.settle();
        assert.equal(editor.saved.length, 1);
        assert.equal(editor.saved[0].originalInput, source);
        assert.equal(editor.fields.paste.value, source);
    });

    it("keeps valid pending imports until explicitly confirmed and removes both old coordinates", async () => {
        const editor = createEditor({value: {name: "Office", latitude: 31, longitude: 121, originalInput: "31,121"}});
        editor.fields.paste.value = "0,0";
        editor.buttons.save.dispatch("click");
        await editor.settle();
        assert.equal(editor.saved.length, 0);
        assert.equal(editor.buttons.parse.focused, true);
        assert.equal(editor.fields.paste.value, "0,0");
        editor.fields.paste.value = "";
        editor.fields.latitude.value = "";
        editor.fields.longitude.value = "";
        editor.fields.latitude.dispatch("input");
        editor.buttons.save.dispatch("click");
        await editor.settle();
        assert.deepEqual(editor.saved, [{name: "Office", latitude: null, longitude: null,
            coordinateSystem: "unknown", originalInput: ""}]);
    });

    it("opens very small stored decimal coordinates without invalid exponent notation", async () => {
        const editor = createEditor({value: {latitude: 1e-7, longitude: -1e-8}});
        assert.equal(editor.fields.latitude.value, "0.0000001");
        assert.equal(editor.fields.longitude.value, "-0.00000001");
        editor.buttons.save.dispatch("click");
        await editor.settle();
        assert.equal(editor.saved.length, 0);
        assert.equal(editor.lifecycle.includes("destroy"), true);
    });

    it("discards edits on Cancel and Escape and produces no unchanged-save transaction", async () => {
        for (const action of ["cancel", "escape", "save"]) {
            const editor = createEditor({value: {name: "Office"}});
            if (action !== "save") {
                editor.fields.name.value = "Changed";
            }
            if (action === "escape") {
                editor.key("Escape");
            } else {
                editor.buttons[action].dispatch("click");
            }
            await editor.settle();
            assert.deepEqual(editor.saved, []);
            assert.equal(editor.lifecycle.filter(item => item === "end-session").length, 1);
            assert.equal(editor.lifecycle.filter(item => item === "on-destroy").length, 1);
        }
    });

    it("clears a value only through the explicit Clear action", async () => {
        const editor = createEditor({value: {name: "Office", latitude: 0, longitude: 0, originalInput: "Office"}});
        editor.buttons.clear.dispatch("click");
        await editor.settle();
        assert.deepEqual(editor.saved, [{name: "", latitude: null, longitude: null, coordinateSystem: "unknown", originalInput: ""}]);
    });

    it("prevents repeated submissions while saving", async () => {
        let complete: () => void;
        const editor = createEditor({save: () => new Promise<void>(resolve => complete = resolve)});
        editor.fields.name.value = "Office";
        editor.buttons.save.dispatch("click");
        editor.buttons.save.dispatch("click");
        editor.buttons.clear.dispatch("click");
        assert.equal(editor.saved.length, 1);
        assert.equal(editor.buttons.save.disabled, true);
        complete();
        await editor.settle();
        assert.equal(editor.lifecycle.filter(item => item === "destroy").length, 1);
    });

    it("retains fields and enables retry after a rejected save", async () => {
        let fail = true;
        const editor = createEditor({save: async () => {
            if (fail) {
                throw new Error("save failed");
            }
        }});
        editor.fields.name.value = "Office";
        editor.buttons.save.dispatch("click");
        await editor.settle();
        assert.equal(editor.error.textContent, "save failed");
        assert.equal(editor.fields.name.value, "Office");
        assert.equal(editor.buttons.save.disabled, false);
        assert.equal(editor.lifecycle.includes("destroy"), false);
        fail = false;
        editor.buttons.save.dispatch("click");
        await editor.settle();
        assert.equal(editor.lifecycle.includes("destroy"), true);
    });

    it("does not submit or cancel during IME composition", async () => {
        const editor = createEditor();
        editor.fields.name.value = "Office";
        editor.root.dispatch("compositionstart");
        editor.key("Escape");
        editor.key("Enter", {ctrlKey: true});
        editor.buttons.save.dispatch("click");
        assert.equal(editor.lifecycle.includes("destroy"), false);
        assert.equal(editor.saved.length, 0);
        editor.root.dispatch("compositionend");
        editor.key("Escape", {isComposing: true});
        editor.key("Escape", {keyCode: 229});
        assert.equal(editor.lifecycle.includes("destroy"), false);
        editor.key("Enter", {ctrlKey: true});
        await editor.settle();
        assert.equal(editor.saved.length, 1);
    });

    it("discards and cleans up when its owner disconnects", async () => {
        const editor = createEditor({mobile: true});
        editor.fields.name.value = "Unsaved";
        assert.equal(editor.root.dataset.avBlockId, "database-block");
        assert.equal(editor.lifecycle.includes("sheet"), true);
        editor.owner.isConnected = false;
        editor.ownerChanged();
        editor.buttons.save.dispatch("click");
        await editor.settle();
        assert.equal(editor.saved.length, 0);
        assert.equal(editor.lifecycle.filter(item => item === "dispose-sheet").length, 1);
        assert.equal(editor.lifecycle.filter(item => item === "end-session").length, 1);
        assert.equal(editor.lifecycle.filter(item => item === "on-destroy").length, 1);
    });

    it("uses mobile sheet dismissal as cancel without opening the keyboard eagerly", async () => {
        const editor = createEditor({mobile: true});
        assert.equal(editor.fields.name.focused, false);
        editor.fields.name.value = "Unsaved";
        await editor.closeSheet();
        assert.equal(editor.saved.length, 0);
        assert.equal(editor.lifecycle.includes("blur"), true);
    });

    it("requires an explicit valid coordinate system instead of silently guessing", async () => {
        const editor = createEditor({value: {coordinateSystem: "custom" as IAVCellLocationValue["coordinateSystem"]}});
        assert.equal(editor.fields.coordinateSystem.value, "custom");
        editor.buttons.save.dispatch("click");
        await editor.settle();
        assert.equal(editor.error.textContent, "invalidCoordinateSystem");
        assert.equal(editor.saved.length, 0);
    });
});
