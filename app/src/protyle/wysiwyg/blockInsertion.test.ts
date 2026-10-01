import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {getBlockInsertionContext} from "./blockInsertion";

class TestElement {
    nodeType = 1;
    tagName = "DIV";
    selected: TestElement[] = [];
    classList = {contains: (name: string) => name === "protyle-wysiwyg" && this.type === "editor"};

    constructor(public type: string, public parentElement?: TestElement) {}

    getAttribute(name: string) {
        return name === "data-type" ? this.type : null;
    }

    querySelectorAll() {
        return this.selected;
    }

    querySelector(): null {
        return null;
    }
}

const asElement = (element: TestElement) => element as unknown as Element;
const keydownSource = readFileSync("src/protyle/wysiwyg/keydown.ts", "utf8");
const shortcutSource = keydownSource.slice(
    keydownSource.indexOf("        if (matchHotKey(window.siyuan.config.keymap.editor.general.insertBefore, event))"),
    keydownSource.indexOf("        if (matchHotKey(window.siyuan.config.keymap.editor.general.insertSuperBlockLeft, event)"));

for (const position of ["beforebegin", "afterend"] as const) {
    test(`${position} shortcut dispatch passes the checked target exactly once`, () => {
        const editor = new TestElement("editor");
        const embed = new TestElement("NodeBlockQueryEmbed", editor);
        const inner = new TestElement("NodeParagraph", embed);
        const key = position === "beforebegin" ? "insertBefore" : "insertAfter";
        for (const selected of [embed, inner]) {
            editor.selected = [selected];
            const calls: Array<{position: string; target: TestElement}> = [];
            let prevented = 0;
            runInNewContext(`(function () {${shortcutSource}})()`, {
                editorElement: editor,
                nodeElement: inner,
                blockSelectionModeElement: undefined,
                protyle: {},
                window: {siyuan: {config: {keymap: {editor: {general: {insertBefore: "insertBefore", insertAfter: "insertAfter"}}}}}},
                event: {preventDefault: () => prevented++, stopPropagation: () => {}},
                matchHotKey: (hotkey: string) => hotkey === key,
                getBlockInsertionContext,
                insertEmptyBlock: (_protyle: unknown, insertionPosition: string, target: TestElement) => {
                    calls.push({position: insertionPosition, target});
                },
            });
            assert.equal(prevented, selected === embed ? 1 : 0);
            assert.equal(calls.length, selected === embed ? 1 : 0);
            if (selected === embed) {
                assert.equal(calls[0].target, embed);
                assert.equal(calls[0].position, position);
            }
        }
    });

    test(`${position} uses selected outer embed instead of its inner caret`, () => {
        const editor = new TestElement("editor");
        const embed = new TestElement("NodeBlockQueryEmbed", editor);
        const inner = new TestElement("NodeParagraph", embed);
        editor.selected = [embed];
        const context = getBlockInsertionContext(asElement(editor), asElement(inner), position);
        assert.equal(context.target, embed);
        assert.equal(context.allowed, true);
    });

    test(`${position} preserves embedded-content protection`, () => {
        const editor = new TestElement("editor");
        const embed = new TestElement("NodeBlockQueryEmbed", editor);
        const inner = new TestElement("NodeParagraph", embed);
        const nested = new TestElement("NodeBlockQueryEmbed", embed);
        for (const selected of [[], [inner], [nested]]) {
            editor.selected = selected;
            assert.equal(getBlockInsertionContext(asElement(editor), asElement(inner), position).allowed, false);
        }
    });

    test(`${position} chooses the selection boundary before selection-mode focus`, () => {
        const editor = new TestElement("editor");
        const first = new TestElement("NodeParagraph", editor);
        const last = new TestElement("NodeBlockQueryEmbed", editor);
        const inner = new TestElement("NodeParagraph", last);
        editor.selected = [first, last];
        for (const active of [first, last]) {
            const context = getBlockInsertionContext(asElement(editor), asElement(inner), position, asElement(active));
            assert.equal(context.target, position === "beforebegin" ? first : last);
            assert.equal(context.allowed, true);
        }
    });

    test(`${position} supports selection mode without changing ordinary caret fallback`, () => {
        const editor = new TestElement("editor");
        const embed = new TestElement("NodeBlockQueryEmbed", editor);
        const inner = new TestElement("NodeParagraph", embed);
        const normal = new TestElement("NodeParagraph", editor);
        const selected = getBlockInsertionContext(asElement(editor), asElement(inner), position, asElement(embed));
        assert.equal(selected.target, embed);
        assert.equal(selected.allowed, true);
        const editing = getBlockInsertionContext(asElement(editor), asElement(normal), position);
        assert.equal(editing.target, undefined);
        assert.equal(editing.allowed, true);
        assert.equal(getBlockInsertionContext(asElement(editor), asElement(embed), position).allowed, true);
        assert.equal(getBlockInsertionContext(asElement(editor), asElement(normal), position, asElement(inner)).allowed, false);
    });
}
