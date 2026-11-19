import * as assert from "node:assert/strict";
import {test} from "node:test";
import {bindSearchInput, normalizeSearchInput} from "./input";

test("only SQL keeps multiline queries, including pasted and restored text", () => {
    for (const method of [0, 1, 2, 3, 4]) {
        const input = {
            value: "one\r\ntwo\rthree\nfour", selectionStart: 5, selectionEnd: 15, selectionDirection: "backward",
            setSelectionRange(start: number, end: number, direction: string) {
                this.selectionStart = start;
                this.selectionEnd = end;
                this.selectionDirection = direction;
            },
        };
        normalizeSearchInput(input as HTMLTextAreaElement, method);
        assert.equal(input.value, method === 2 ? "one\r\ntwo\rthree\nfour" : "one two three four");
        assert.equal(input.selectionStart, method === 2 ? 5 : 4);
        assert.equal(input.selectionEnd, method === 2 ? 15 : 14);
        assert.equal(input.selectionDirection, "backward");
        normalizeSearchInput(input as HTMLTextAreaElement, method);
        assert.equal(input.selectionEnd, method === 2 ? 15 : 14, "normalizing again preserves the caret");
    }
});

test("desktop and mobile newline guards follow the current method without disrupting IME confirmation", () => {
    const input = new EventTarget();
    let method = 0;
    bindSearchInput(input as HTMLTextAreaElement, () => method);
    const dispatch = (type: string, fields: object) => {
        const event = new Event(type, {cancelable: true});
        Object.assign(event, fields);
        input.dispatchEvent(event);
        return event.defaultPrevented;
    };
    for (method of [0, 1, 2, 3, 4]) {
        for (const shiftKey of [false, true]) {
            assert.equal(dispatch("keydown", {key: "Enter", shiftKey}), false, "result navigation keeps receiving Enter");
        }
        for (const inputType of ["insertLineBreak", "insertParagraph"]) {
            assert.equal(dispatch("beforeinput", {inputType}), method !== 2);
        }
        assert.equal(dispatch("keydown", {key: "Enter", isComposing: true}), false);
        assert.equal(dispatch("keydown", {key: "Enter", keyCode: 229}), false);
        assert.equal(dispatch("beforeinput", {inputType: "insertCompositionText"}), false);
        assert.equal(dispatch("keydown", {key: "ArrowDown"}), false);
    }
});
