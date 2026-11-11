import * as assert from "node:assert/strict";
import {join} from "node:path";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {loadModule} from "../../../testSupport/loadModule";

const mountDate = (requireExplicitChange = false) => {
    const inputs = Array.from({length: 4}, (_, index) => {
        const listeners = new Map<string, Array<(event: unknown) => void>>();
        const classes = new Set<string>();
        return {
            type: index < 2 ? "date" : "checkbox", value: index === 0 ? "2026-02-28" : "",
            closest: (): null => null,
            checked: false, dataset: {value: index === 0 ? "2026-02-28 14:25" : ""},
            classList: {add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name)},
            setAttribute(name: string, value: string) { this[name] = value; },
            addEventListener(type: string, listener: (event: unknown) => void) {
                listeners.set(type, [...(listeners.get(type) || []), listener]);
            },
            fire(type: string, properties: Record<string, unknown> = {}) {
                const event = {key: "", stopPropagation() {}, preventDefault() {}, ...properties};
                listeners.get(type)?.forEach(listener => listener(event));
            },
            listeners,
        };
    });
    const updates: IAVCellDateValue[] = [];
    const pickers: {input: typeof inputs[number]; select: () => void}[] = [];
    let valid = true;
    let pickerActive = false;
    const exports = loadModule<typeof import("./date")>(join(__dirname, "date.ts"), {
        Date,
        CustomEvent: class {},
        document: {querySelector: () => ({dispatchEvent: () => close()})},
        require: (name: string) => ({
            "dayjs": require("dayjs"),
            "./dateSubmit": {shouldSubmitDateEdit: (dirty: boolean, explicit: boolean) => dirty || !explicit},
            "./cell": {updateCellsValue: (_protyle: unknown, _block: unknown, value: IAVCellDateValue) => updates.push(value)},
            "./view": {getFieldsByData: (): IAVColumn[] => []},
            "../../../datePicker/inline": {validateInlineDateInput: () => valid,
                getInlineDateType: (input: typeof inputs[number]) => (input.dataset as Record<string, string>).datePickerType || input.type, bindInlineDatePicker: (_host: unknown, bound: typeof inputs,
                options: {onChange: (input: typeof inputs[number], state: {valid: boolean; kind: string}) => void}) => {
                bound.forEach(input => {
                    input.addEventListener("focus", () => { pickerActive = true; });
                    pickers.push({input, select: () => options.onChange(input, {valid: true, kind: "select"})});
                });
                return {activate() {}, validate: () => valid, isActive: () => pickerActive, update() {}, destroy() {}};
            }},
        })[name] || {},
    }, ScriptTarget.ES2020);
    const close = exports.bindDateEvent({menuElement: {querySelectorAll: () => inputs, querySelector: () => ({})}, requireExplicitChange} as unknown as
        Parameters<typeof exports.bindDateEvent>[0]);
    return {inputs, updates, pickers, close, setValid: (value: boolean) => { valid = value; }};
};

test("date inputs keep segment navigation while allowing Escape to close the panel", () => {
    const {inputs, pickers} = mountDate();
    assert.deepEqual(pickers.map(picker => picker.input), inputs.slice(0, 2));
    for (const input of inputs.slice(0, 2)) {
        for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Escape"]) {
            let stopped = false;
            let prevented = false;
            input.fire("keydown", {key, stopPropagation() { stopped = true; }, preventDefault() { prevented = true; }});
            assert.equal(stopped, key !== "Escape");
            assert.equal(prevented, false);
        }
    }
});

test("ordinary date close saves the prefill once, including Enter followed by outer close", () => {
    const ordinary = mountDate();
    ordinary.close();
    ordinary.close();
    assert.equal(ordinary.updates.length, 1);
    assert.equal(ordinary.updates[0].content, new Date("2026-02-28T00:00:00").getTime());
    const enter = mountDate();
    enter.inputs[0].fire("keydown", {key: "Enter"});
    enter.close();
    assert.equal(enter.updates.length, 1);
});

test("focusing either inline endpoint without editing does not accept the batch prefill", () => {
    for (const index of [0, 1]) {
        const cancelled = mountDate(true);
        cancelled.inputs[index].fire("focus");
        cancelled.close();
        assert.equal(cancelled.updates.length, 0, "endpoint focus without an edit cannot overwrite the batch");
    }
    const ordinary = mountDate();
    ordinary.inputs[0].fire("focus");
    ordinary.close();
    assert.equal(ordinary.updates.length, 1, "ordinary date close retains its default prefill behavior");
});

test("selecting the unchanged inline calendar day explicitly accepts a batch date", () => {
    const accepted = mountDate(true);
    const initialValue = accepted.inputs[0].value;
    accepted.inputs[0].fire("focus");
    assert.equal(accepted.updates.length, 0);
    accepted.pickers[0].select();
    assert.equal(accepted.inputs[0].value, initialValue);
    accepted.close();
    assert.equal(accepted.updates.length, 1);
    assert.equal(accepted.updates[0].content, new Date("2026-02-28T00:00:00").getTime());
});

test("batch dates still accept native input, change, or Enter without pointer activation", () => {
    for (const event of ["input", "change", "keydown"]) {
        const edited = mountDate(true);
        edited.inputs[0].fire(event, {key: "Enter"});
        edited.close();
        assert.equal(edited.updates.length, 1);
    }
});

test("invalid text drafts are rejected while delete and explicit calendar clear save empty values", () => {
    const invalid = mountDate();
    invalid.inputs[0].value = "2026-02-31";
    invalid.inputs[0].fire("input");
    invalid.setValid(false);
    invalid.inputs[0].fire("keydown", {key: "Enter"});
    invalid.close();
    assert.equal(invalid.updates.length, 0);
    assert.equal(invalid.inputs[0].value, "2026-02-31");
    const deleted = mountDate();
    deleted.inputs[0].value = "";
    deleted.inputs[0].fire("input");
    deleted.close();
    assert.equal(deleted.updates[0].isNotEmpty, false);
    const cleared = mountDate();
    cleared.inputs[0].value = "";
    cleared.pickers[0].select();
    cleared.close();
    assert.equal(cleared.updates[0].isNotEmpty, false);
});

test("time and end switches preserve their cached values through repeated toggles", () => {
    const editor = mountDate();
    editor.inputs[3].checked = true;
    editor.inputs[3].fire("change");
    assert.equal((editor.inputs[0].dataset as Record<string, string>).datePickerType, "datetime-local");
    assert.equal(editor.inputs[0].value, "2026-02-28T14:25");
    editor.inputs[3].checked = false;
    editor.inputs[3].fire("change");
    assert.equal((editor.inputs[0].dataset as Record<string, string>).datePickerType, "date");
    assert.equal(editor.inputs[0].value, "2026-02-28");
    editor.inputs[3].checked = true;
    editor.inputs[3].fire("change");
    assert.equal(editor.inputs[0].value, "2026-02-28T14:25");
    editor.inputs[1].value = "2026-03-01 15:45";
    editor.inputs[1].fire("change");
    editor.inputs[2].checked = false;
    editor.inputs[2].fire("change");
    editor.inputs[2].checked = true;
    editor.inputs[2].fire("change");
    assert.equal(editor.inputs[1].value, "2026-03-01 15:45");
    editor.close();
    assert.equal(editor.updates[0].content2, new Date("2026-03-01T15:45:00").getTime());
    assert.equal(editor.updates[0].hasEndDate, true);
});

test("date panels pass the batch explicit-change option to Gregorian and lunar editors", () => {
    const received: Parameters<typeof import("./date").bindDateEvent>[0][] = [];
    const methods = loadModule<typeof import("./panels/date")>(join(__dirname, "panels/date.ts"), {
        require: (name: string) => ({
            "../date": {bindDateEvent: (options: Parameters<typeof import("./date").bindDateEvent>[0]) => received.push(options)},
            "../col": {getColId: () => "date"},
            "../datePosition": {bindDatePanelPosition: () => () => {}},
        })[name] || {},
    });
    for (const format of ["", "lunar"]) {
        methods.datePanel.bind({options: {cellElements: [{}], requireExplicitChange: true},
            data: {}, fields: [{id: "date", dateFormat: format}]} as unknown as
            Parameters<typeof methods.datePanel.bind>[0]);
        assert.equal(received.at(-1).requireExplicitChange, true);
        assert.equal(received.at(-1).format, format);
    }
});

test("date cell routing forwards explicit batch intent without changing ordinary date routing", () => {
    const received: {requireExplicitChange?: boolean; type: string}[] = [];
    const block = {getAttribute: () => "gallery"};
    const cell = {dataset: {}, getBoundingClientRect: () => ({}), querySelector: (): null => null, matches: () => false};
    const methods = loadModule<typeof import("./cell")>(join(__dirname, "cell.ts"), {
        document: {querySelector: (): null => null}, getComputedStyle: () => ({}),
        require: (name: string) => ({
            "./host": {getAVHost: () => block},
            "./capabilities": {isAVRichTextType: () => false, isAVSelectType: () => false},
            "./viewType": {isTableLikeView: () => false},
            "../../util/hasClosest": {hasClosestByClassName: (): null => null},
            "../../../mobile/util/keyboardToolbar": {activeBlur() {}},
            "./openMenuPanel": {openMenuPanel: (options: typeof received[number]) => received.push(options)},
        })[name] || {},
    });
    for (const explicit of [true, false, undefined]) {
        methods.popTextCell({} as IProtyle, [cell] as unknown as HTMLElement[], "date", {requireExplicitChange: explicit});
        assert.equal(received.at(-1).type, "date");
        assert.equal(received.at(-1).requireExplicitChange, explicit);
    }
});
