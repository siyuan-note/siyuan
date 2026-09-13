import {afterEach, describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {captureMenuKeyboard} from "./menuKeyboard";

class TestElement {
    public isConnected = true;
    public visible = true;

    constructor(public parentElement?: TestElement) {
    }

    public contains(node: TestElement) {
        while (node) {
            if (node === this) {
                return true;
            }
            node = node.parentElement;
        }
        return false;
    }

    public getClientRects() {
        return this.visible ? [{}] : [];
    }
}

const originalDocument = globalThis.document;
afterEach(() => {
    globalThis.document = originalDocument;
});

const setup = () => {
    const body = new TestElement();
    const editor = new TestElement(body);
    const text = new TestElement(editor);
    const menu = new TestElement(body);
    const input = new TestElement(menu);
    const range = {
        startContainer: text,
        endContainer: text,
        startOffset: 2,
        endOffset: 4,
        cloneRange() {
            return {...this};
        },
    };
    const state = {
        activeElement: editor,
        rangeCount: 1,
        current: true,
        dialogs: [] as TestElement[],
        restored: [] as Range[],
    };
    globalThis.document = {
        body,
        get activeElement() { return state.activeElement; },
        getSelection: () => ({rangeCount: state.rangeCount, getRangeAt: () => range}),
        getElementById: () => menu,
        querySelectorAll: () => state.dialogs,
    } as unknown as Document;
    const protyle = {
        wysiwyg: {element: editor},
        block: {rootID: "doc-a"},
        toolbar: {range: undefined},
        disabled: false,
    } as unknown as IProtyle;
    const capture = (keyboardOpen = true) => captureMenuKeyboard({
        protyle,
        keyboardOpen,
        isCurrent: () => state.current,
        restore: saved => state.restored.push(saved),
    });
    return {body, editor, text, menu, input, range, state, protyle, capture};
};

describe("mobile menu keyboard restoration", () => {
    it("restores the captured selection once after keyboard dismissal clears the live selection", () => {
        const {body, state, protyle, capture} = setup();
        const restore = capture();
        state.activeElement = body;
        state.rangeCount = 0;
        restore();
        restore();
        assert.equal(state.restored.length, 1);
        assert.equal(state.restored[0].startOffset, 2);
        assert.equal(state.restored[0].endOffset, 4);
        assert.equal(protyle.toolbar.range, state.restored[0]);
    });

    it("does not open a previously closed keyboard or use an unfocused editor's stale selection", () => {
        const {body, state, capture} = setup();
        assert.equal(capture(false), undefined);
        state.activeElement = new TestElement(body);
        assert.equal(capture(), undefined);
    });

    it("does not capture a selection outside the editor", () => {
        const {body, range, capture} = setup();
        range.endContainer = new TestElement(body);
        assert.equal(capture(), undefined);
    });

    it("allows dismissal of a menu input without stealing focus from another input", () => {
        for (const inMenu of [true, false]) {
            const {body, input, state, capture} = setup();
            const restore = capture();
            state.activeElement = inMenu ? input : new TestElement(body);
            restore();
            assert.equal(state.restored.length, inMenu ? 1 : 0);
        }
    });

    it("cancels restoration after navigation, editor replacement, readonly mode, hiding or deletion", () => {
        const changes = [
            (test: ReturnType<typeof setup>) => { test.protyle.block.rootID = "doc-b"; },
            (test: ReturnType<typeof setup>) => { test.state.current = false; },
            (test: ReturnType<typeof setup>) => { test.protyle.disabled = true; },
            (test: ReturnType<typeof setup>) => { test.editor.visible = false; },
            (test: ReturnType<typeof setup>) => { test.editor.isConnected = false; },
            (test: ReturnType<typeof setup>) => { test.text.isConnected = false; },
            (test: ReturnType<typeof setup>) => { test.text.parentElement = test.body; },
        ];
        for (const change of changes) {
            const test = setup();
            const restore = test.capture();
            change(test);
            restore();
            assert.equal(test.state.restored.length, 0);
        }
    });

    it("does not restore a live Range that was retargeted when its source node was removed", () => {
        const test = setup();
        let saved: typeof test.range;
        test.range.cloneRange = () => {
            saved = {...test.range};
            return saved;
        };
        const restore = test.capture();
        saved.startContainer = test.editor;
        saved.endContainer = test.editor;
        restore();
        assert.equal(test.state.restored.length, 0);
    });

    it("does not steal focus when an action opens a new dialog", () => {
        const {body, state, capture} = setup();
        const restore = capture();
        state.activeElement = body;
        state.dialogs.push(new TestElement(body));
        restore();
        assert.equal(state.restored.length, 0);
    });
});
