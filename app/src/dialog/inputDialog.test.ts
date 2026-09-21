import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {it} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, forEachChild, isCallExpression, ModuleKind, ScriptTarget, transpileModule} from "typescript";

class Control {
    value = "";
    disabled = false;
    focusCount = 0;
    dataset: Record<string, string> = {};
    listeners: Record<string, () => void> = {};
    addEventListener(type: string, listener: () => void) {
        this.listeners[type] = listener;
    }
    click() {
        if (!this.disabled) {
            this.listeners.click?.();
        }
    }
    focus() {
        this.focusCount++;
    }
    select() {}
}

class Input extends Control {
    type = "text";
    min = "";
    max = "";
    valid = true;
    reportValidity() {
        return this.valid;
    }
}

const loadDialog = () => {
    class TestDialog {
        input: Control;
        cancel = new Control();
        confirm = new Control();
        actions: Control[];
        closed = false;
        enter?: () => void;
        element: {
            querySelector: (selector: string) => Control,
            querySelectorAll: (selector: string) => Control[],
        };
        constructor(public options: {content: string}) {
            this.input = options.content.includes("<textarea") ? new Control() : new Input();
            this.actions = Array.from(options.content.matchAll(/data-input-action="(\d+)"/g), match => {
                const control = new Control();
                control.dataset.inputAction = match[1];
                return control;
            });
            this.element = {
                querySelector: selector => ({
                    "[data-dialog-input]": this.input,
                    "[data-input-cancel]": this.cancel,
                    "[data-input-confirm]": this.confirm,
                })[selector],
                querySelectorAll: () => this.actions,
            };
        }
        bindInput(input: Control, enter: () => void) {
            assert.equal(input, this.input);
            this.enter = enter;
        }
        destroy() {
            this.closed = true;
        }
    }
    const exports = {} as {openInputDialog: (options: Record<string, unknown>) => TestDialog};
    runInNewContext(transpileModule(readFileSync("src/dialog/inputDialog.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText, {
        exports,
        HTMLInputElement: Input,
        window: {siyuan: {languages: {confirm: "Confirm", cancel: "Cancel"}}},
        require: (name: string) => {
            if (name === "./index") {
                return {Dialog: TestDialog};
            }
            if (name === "../util/functions") {
                return {isMobile: () => false};
            }
            if (name === "../util/escape") {
                return {escapeHtml: (value: string) => value.replace(/</g, "&lt;")};
            }
            throw new Error(name);
        },
    });
    return exports.openInputDialog;
};

it("keeps validation and closing with the caller and respects a disabled confirm button", () => {
    const open = loadDialog();
    let calls = 0;
    const dialog = open({
        title: "Password",
        value: "",
        type: "password",
        onConfirm: (value: string, current: {destroy: () => void}) => {
            calls++;
            if (value) {
                current.destroy();
            }
        },
    });
    assert.equal((dialog.input as Input).type, "password");
    const initialFocusCount = dialog.input.focusCount;
    dialog.confirm.click();
    assert.equal(dialog.closed, false);
    assert.equal(dialog.input.focusCount, initialFocusCount + 1);
    dialog.confirm.disabled = true;
    dialog.enter();
    assert.equal(calls, 1);
    dialog.confirm.disabled = false;
    dialog.input.value = "secret";
    dialog.enter();
    assert.equal(dialog.closed, true);
});

it("uses the primary action for Enter and leaves extra content buttons independent", () => {
    const open = loadDialog();
    const calls: string[] = [];
    const dialog = open({
        title: "Template",
        value: "<name>",
        extraContent: '<button class="b3-button">Manager</button>',
        confirmText: "Update",
        actions: [{text: "Delete", position: "beforeCancel", onClick: (value: string) => calls.push("delete:" + value)},
            {text: "Rename", onClick: (value: string) => calls.push("rename:" + value)},
            {text: "Upload", position: "afterConfirm", onClick: (value: string) => calls.push("upload:" + value)}],
        onConfirm: (value: string) => calls.push("confirm:" + value),
    });
    assert.equal(dialog.input.value, "<name>");
    assert.equal(dialog.options.content.includes("<name>"), false);
    assert.deepEqual(dialog.actions.map(action => action.dataset.inputAction), ["0", "1", "2"]);
    dialog.input.value = "changed";
    dialog.enter();
    dialog.actions.forEach(action => action.click());
    assert.equal(dialog.input.focusCount, 5);
    assert.deepEqual(calls, ["confirm:changed", "delete:changed", "rename:changed", "upload:changed"]);
    assert.equal(dialog.closed, false);
    dialog.cancel.click();
    assert.equal(dialog.closed, true);
});

it("supports multiline values and lets autocomplete own keyboard events", () => {
    const open = loadDialog();
    const dialog = open({title: "AI", value: "one\ntwo", multiline: true, onConfirm: () => {}});
    assert.equal(dialog.input instanceof Input, false);
    assert.equal(dialog.input.value, "one\ntwo");
    const autocomplete = open({title: "Tag", value: "tag", bindInput: false, onConfirm: () => {}});
    assert.equal(autocomplete.enter, undefined);
});

it("calendar date jump waits for confirmation and uses local midnight without changing the view mode", () => {
    const file = "src/protyle/render/av/calendar/render.ts";
    const source = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.Latest, true);
    let call = "";
    const visit = (node: import("typescript").Node) => {
        if (isCallExpression(node) && node.expression.getText(source) === "openInputDialog") {
            call = node.getText(source);
        }
        forEachChild(node, visit);
    };
    visit(source);
    assert.ok(call);
    for (const mode of ["month", "week"]) {
        const open = loadDialog();
        let dialog: ReturnType<typeof open>;
        const initial = new Date("2026-09-21T00:00:00").getTime();
        const state = {anchor: initial, mode, expandedWeeks: new Set([initial])};
        let refreshed = 0;
        runInNewContext(transpileModule(call, {compilerOptions: {target: ScriptTarget.ES2020}}).outputText, {
            openInputDialog: (options: Parameters<typeof open>[0]) => { dialog = open(options); },
            window: {siyuan: {languages: {calendarJumpDate: "Go to date"}}},
            state, dayjs: require("dayjs"), Date,
            refresh: () => refreshed++,
        });
        const input = dialog.input as Input;
        assert.equal(input.type, "date");
        assert.equal(input.value, "2026-09-21");
        assert.equal(input.min, "0001-01-01");
        assert.equal(input.max, "9999-12-31");
        for (const [value, valid] of [["", true], ["10000-01-01", false]] as const) {
            input.value = value;
            input.valid = valid;
            dialog.enter();
            assert.equal(dialog.closed, false);
            assert.equal(state.anchor, initial);
            assert.equal(refreshed, 0);
        }
        input.value = "2024-02-29";
        input.valid = true;
        assert.equal(state.anchor, initial);
        dialog.enter();
        assert.equal(state.anchor, new Date("2024-02-29T00:00:00").getTime());
        assert.equal(state.mode, mode);
        assert.equal(state.expandedWeeks.size, 0);
        assert.equal(dialog.closed, true);
        assert.equal(refreshed, 1);
    }
});

for (const file of ["src/history/doc.ts", "src/history/history.ts"]) {
    it(`${file} keeps all page jump dialogs open for empty input and clamps valid pages`, () => {
        const source = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.Latest, true);
        const dialogs: {onConfirm: (value: string, dialog: {destroy: () => void}) => void}[] = [];
        const pages: number[] = [];
        let messages = 0;
        const visit = (node: import("typescript").Node) => {
            if (isCallExpression(node) && node.expression.getText(source) === "openInputDialog" &&
                node.arguments[0].getText(source).includes("jumpToPage")) {
                runInNewContext(transpileModule(node.getText(source), {
                    compilerOptions: {target: ScriptTarget.ES2020},
                }).outputText, {
                    openInputDialog: (options: typeof dialogs[number]) => dialogs.push(options),
                    window: {siyuan: {languages: {jumpToPage: "Page ${x}"}}},
                    totalPage: 5, currentPage: 2, pageNumElement: {textContent: "2"}, target: {textContent: "2"},
                    options: {id: "doc"}, fileElement: {}, repoElement: {}, firstPanelElement: {},
                    showMessage: () => messages++,
                    renderDoc: (element: unknown, page: number) => pages.push(page),
                    renderRepo: (element: unknown, page: number) => pages.push(page),
                });
            }
            forEachChild(node, visit);
        };
        visit(source);
        assert.equal(dialogs.length, 2);
        for (const options of dialogs) {
            let closed = false;
            const dialog = {destroy: () => { closed = true; }};
            options.onConfirm("", dialog);
            assert.equal(closed, false);
            options.onConfirm("invalid", dialog);
            assert.equal(closed, false);
            options.onConfirm("99", dialog);
            assert.equal(closed, true);
            options.onConfirm("0", dialog);
        }
        assert.equal(messages, 4);
        assert.deepEqual(pages, [5, 1, 5, 1]);
    });
}
