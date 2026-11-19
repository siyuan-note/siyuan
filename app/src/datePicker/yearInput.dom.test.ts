import * as assert from "node:assert/strict";
import {join} from "node:path";
import test from "node:test";
import {browserSources, canRunBrowser, runBrowserCase} from "./test/browser";

test("year navigation input rejects whole nonnumeric edits without interrupting editing or composition", {
    timeout: 45000, skip: !canRunBrowser,
}, async () => {
    const sources = browserSources({yearInput: join(__dirname, "yearInput.ts")});
    const result = await runBrowserCase(async source => {
        const equal = (actual: unknown, expected: unknown, message: string) => {
            if (JSON.stringify(actual) !== JSON.stringify(expected)) {
                throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
            }
        };
        const exports: Record<string, any> = {};
        new Function("exports", source.yearInput)(exports);
        let currentYear = 2024;
        const input = document.createElement("input");
        input.type = "number";
        input.setAttribute("aria-label", "Year");
        document.body.append(input);
        const controller = exports.createYearInputController(input, () => currentYear);
        input.focus();
        const select = (start: number, end = start, direction: "forward" | "backward" | "none" = "none") => {
            input.setSelectionRange(start, end, direction);
            input.dispatchEvent(new Event("select"));
        };
        const selection = () => [input.selectionStart, input.selectionEnd, input.selectionDirection];
        const edit = (value: string, inputType = "insertText", isComposing = false) => {
            input.value = value;
            input.dispatchEvent(new InputEvent("input", {bubbles: true, data: value, inputType, isComposing}));
        };
        const key = (value: string, options: KeyboardEventInit = {}) => {
            const event = new KeyboardEvent("keydown", {key: value, bubbles: true, cancelable: true, ...options});
            input.dispatchEvent(event);
            return event.defaultPrevented;
        };
        const before = (data: string | null, options: InputEventInit = {}) => {
            const event = new InputEvent("beforeinput", {data, inputType: "insertText", bubbles: true, cancelable: true, ...options});
            input.dispatchEvent(event);
            return event.defaultPrevented;
        };
        const transfer = (type: "paste" | "drop", value: string) => {
            const data = new DataTransfer();
            data.setData("text/plain", value);
            const event = type === "paste" ? new ClipboardEvent(type, {clipboardData: data, bubbles: true, cancelable: true}) :
                new DragEvent(type, {dataTransfer: data, bubbles: true, cancelable: true});
            input.dispatchEvent(event);
            return event.defaultPrevented;
        };

        equal(input.type, "text", "Text input preserves selection and does not accept exponent syntax");
        equal(input.inputMode, "numeric", "Touch keyboards request digits");
        equal(input.getAttribute("aria-label"), "Year", "The caller's accessible label remains intact");
        equal(input.value, "2024", "The displayed year initializes the draft");
        for (const value of ["e", "E", "+", "-", ".", ",", " ", "a", "２", "٢"]) {
            equal(key(value), true, "Reject a nonnumeric key: " + value);
            equal(input.value, "2024", "Rejected keys cannot change the year");
        }
        for (const value of ["0", "9", "Backspace", "Delete", "Home", "End", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Tab", "Enter", "Escape"]) {
            equal(key(value), false, "Preserve an editing or navigation key: " + value);
        }
        for (const modifier of ["ctrlKey", "metaKey"]) {
            for (const value of ["a", "c", "v", "x", "z", "y"]) {
                equal(key(value, {[modifier]: true}), false, "Preserve keyboard shortcuts");
                equal(key(value.toUpperCase(), {[modifier]: true, shiftKey: true}), false, "Preserve shifted shortcuts");
            }
        }
        for (const value of ["2e3", "+2024", "-1", "20.24", " 2024", "2024 ", "20\n24", "２０２４", "٢٠٢٤", "2024年", "😀"]) {
            select(1, 3, "backward");
            equal(before(value), true, "Reject a nonnumeric beforeinput edit: " + value);
            equal(transfer("paste", value), true, "Reject an entire mixed paste: " + value);
            equal(transfer("drop", value), true, "Reject an entire mixed drop: " + value);
            equal(input.value, "2024", "Rejection never extracts a different numeric value");
            equal(selection(), [1, 3, "backward"], "Prevention retains the selected replacement range");
        }
        equal(before("99"), false, "Allow numeric beforeinput");
        equal(before(null, {inputType: "deleteContentBackward"}), false, "Allow deletion without data");
        equal(before(null, {inputType: "historyUndo"}), false, "Allow native undo");
        equal(before(null, {inputType: "historyRedo"}), false, "Allow native redo");
        equal(transfer("paste", "2030"), false, "Allow numeric paste through the browser");
        equal(transfer("drop", "2030"), false, "Allow numeric drop through the browser");

        select(1, 3, "backward");
        edit("2e3");
        equal(input.value, "2024", "Fallback input restores the last accepted draft instead of turning 2e3 into 23");
        equal(selection(), [1, 3, "backward"], "Fallback input restores the caret and selection direction");
        equal(before("bad", {cancelable: false}), false, "Noncancelable edits reach the fallback");
        edit("bad", "insertReplacementText");
        equal(input.value, "2024", "Noncancelable replacement is restored");
        edit("2030", "historyUndo");
        equal(input.value, "2030", "Numeric undo results are accepted");
        edit("2e3", "historyRedo");
        equal(input.value, "2030", "Fallback redo cannot reintroduce invalid text");

        for (const value of ["", "0", "0000", "275761", "9999999999999999999999999999999999999999"]) {
            edit(value);
            equal(input.value, value, "Numeric and empty drafts stay freely editable until commit");
            equal(controller.commit(), undefined, "Empty and out-of-range commits cannot navigate");
            equal(input.value, "2024", "Invalid commits restore the current visible year without an error");
        }
        currentYear = 2035;
        edit("");
        equal(controller.commit(), undefined, "Empty commit does not navigate");
        equal(input.value, "2035", "Restore reads the live current year rather than a stale initial year");
        for (const [value, expected] of [["1", 1], ["00001", 1], ["2026", 2026], ["275760", 275760]] as const) {
            edit(value);
            equal(controller.commit(), expected, "Commit a supported civil year");
            equal(input.value, String(expected), "Commit canonicalizes leading zeros");
        }
        for (const value of ["2e3", "+2024", "20.24", "２０２４", "Infinity", "NaN"]) {
            input.value = value;
            equal(controller.commit(), undefined, "Unannounced programmatic values cannot bypass commit validation");
            equal(input.value, "2035", "Invalid direct value restores the current year");
        }

        controller.setValue(2024);
        select(1, 3, "backward");
        input.dispatchEvent(new CompositionEvent("compositionstart"));
        equal(controller.isComposing(), true, "Composition state is exposed to blur and Enter owners");
        equal(key("e", {isComposing: true}), false, "IME keys are not intercepted");
        equal(key("Process", {keyCode: 229}), false, "Legacy IME keyboard events are not intercepted");
        equal(before("二", {isComposing: true, inputType: "insertCompositionText"}), false, "Composition text can be displayed");
        edit("2二4", "insertCompositionText", true);
        equal(input.value, "2二4", "An active IME draft is untouched");
        equal(controller.commit(), undefined, "Commit during composition does not navigate");
        controller.setValue(2040);
        equal(input.value, "2二4", "Rendering cannot interrupt active composition");
        input.dispatchEvent(new CompositionEvent("compositionend", {data: "二"}));
        equal(controller.isComposing(), false, "Composition ends before final validation");
        equal(input.value, "2024", "A nonnumeric composition is rejected as a whole");
        equal(selection(), [1, 3, "backward"], "Rejected composition restores its original replacement selection");
        edit(input.value, "insertCompositionText");
        equal(input.value, "2024", "A trailing noncomposing input event cannot corrupt the restored draft");
        for (const value of ["２０２４", "٢٠٢٤"]) {
            input.dispatchEvent(new CompositionEvent("compositionstart"));
            edit(value, "insertCompositionText", true);
            input.dispatchEvent(new CompositionEvent("compositionend", {data: value}));
            equal(input.value, "2024", "Non-ASCII decimal numerals are rejected rather than silently converted");
        }
        input.dispatchEvent(new CompositionEvent("compositionstart"));
        edit("2036", "insertCompositionText", true);
        input.dispatchEvent(new CompositionEvent("compositionend", {data: "2036"}));
        equal(input.value, "2036", "ASCII numeric composition is accepted");
        equal(controller.commit(), 2036, "Numeric composition can commit after finishing");
        input.dispatchEvent(new CompositionEvent("compositionstart"));
        input.dispatchEvent(new CompositionEvent("compositionend", {data: ""}));
        equal(input.value, "2036", "Canceled composition retains its draft");

        controller.destroy();
        equal(key("e"), false, "Destroy removes keyboard filtering");
        equal(before("e"), false, "Destroy removes beforeinput filtering");
        equal(transfer("paste", "2e3"), false, "Destroy removes paste filtering");
        equal(transfer("drop", "2e3"), false, "Destroy removes drop filtering");
        edit("2e3");
        equal(input.value, "2e3", "Destroy removes fallback filtering");
        input.dispatchEvent(new CompositionEvent("compositionstart"));
        equal(controller.isComposing(), false, "Destroy removes composition listeners");
        input.remove();
        return "Year input event coverage passed";
    }, sources);
    assert.match(result, /Year input event coverage passed/);
});

test("year input preserves Chromium native replacement, deletion, undo and redo", {
    timeout: 45000, skip: !canRunBrowser,
}, async () => {
    const sources = browserSources({yearInput: join(__dirname, "yearInput.ts")});
    const result = await runBrowserCase(async source => {
        const equal = (actual: unknown, expected: unknown, message: string) => {
            if (actual !== expected) { throw new Error(`${message}: ${actual} !== ${expected}`); }
        };
        const exports: Record<string, any> = {};
        new Function("exports", source.yearInput)(exports);
        const input = document.createElement("input");
        document.body.append(input);
        const controller = exports.createYearInputController(input, () => 2024);
        let trustedInputEvents = 0;
        input.addEventListener("input", event => { if (event.isTrusted) { trustedInputEvents++; } });
        input.focus();
        input.setSelectionRange(2, 4);
        document.execCommand("insertText", false, "99");
        equal(input.value, "2099", "Native insertion replaces the selection");
        equal(input.selectionStart, 4, "Native insertion leaves the caret after the inserted digits");
        document.execCommand("undo");
        equal(input.value, "2024", "Native undo restores the replaced digits");
        document.execCommand("redo");
        equal(input.value, "2099", "Native redo restores the accepted replacement");
        input.setSelectionRange(2, 2);
        document.execCommand("insertText", false, "3");
        equal(input.value, "20399", "Native typing inserts at the caret");
        equal(input.selectionStart, 3, "Native typing preserves the caret");
        document.execCommand("delete");
        equal(input.value, "2099", "Native backward deletion remains available");
        equal(input.selectionStart, 2, "Backward deletion preserves the expected caret");
        document.execCommand("forwardDelete");
        equal(input.value, "209", "Native forward deletion remains available");
        input.select();
        document.execCommand("delete");
        equal(input.value, "", "Native selection deletion can leave an empty draft");
        document.execCommand("insertText", false, "2037");
        equal(input.value, "2037", "An empty field accepts a replacement year");
        input.setSelectionRange(1, 3, "backward");
        input.dispatchEvent(new Event("select"));
        document.execCommand("insertText", false, "2e3");
        equal(input.value, "2037", "A native whole replacement rejects mixed text instead of keeping only digits");
        equal(input.selectionStart, 1, "Rejected native replacement restores selection start");
        equal(input.selectionEnd, 3, "Rejected native replacement restores selection end");
        if (trustedInputEvents < 9) { throw new Error("Expected browser-generated input events, got " + trustedInputEvents); }
        controller.destroy();
        return "Year input native editing passed";
    }, sources);
    assert.match(result, /Year input native editing passed/);
});
