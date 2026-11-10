import * as assert from "node:assert/strict";
import {test} from "node:test";
import {createAVRichTextEditorLute, configureAVRichTextEditorLute} from "./richTextEditorLute";
import {configureAVRichTextLute} from "./richTextValue";

test("database input follows global inline syntax without changing stored rich text", () => {
    require("../../../../stage/protyle/js/lute/lute.min.js");
    const originalWindow = globalThis.window;
    const markdown = {
        inlineAsterisk: false, inlineUnderscore: false, inlineSup: false, inlineSub: false,
        inlineTag: false, inlineMath: false, inlineStrikethrough: false,
        inlineFullWidthStrikethrough: false, inlineMark: false,
    };
    globalThis.window = {siyuan: {config: {editor: {markdown}}}} as unknown as Window & typeof globalThis;
    try {
        const storage = configureAVRichTextLute(Lute.New());
        storage.SetTextMark(true);
        const editor = createAVRichTextEditorLute();
        assert.doesNotMatch(editor.Md2BlockDOM("*text*"), /data-type="em"/);
        const input = `<div data-node-id="20261105120000-abcdefg" data-type="NodeParagraph"><div contenteditable="true">*text*${Lute.Caret}</div></div>`;
        assert.doesNotMatch(editor.SpinBlockDOM(input), /data-type="em"/);
        assert.match(storage.Md2BlockDOM("*text*"), /data-type="em"/);
        markdown.inlineAsterisk = true;
        configureAVRichTextEditorLute(editor);
        assert.match(editor.Md2BlockDOM("*text*"), /data-type="em"/);
        assert.match(editor.SpinBlockDOM(input), /data-type="em"/);
        markdown.inlineAsterisk = false;
        configureAVRichTextEditorLute(editor);
        assert.doesNotMatch(editor.Md2BlockDOM("*text*"), /data-type="em"/);
        assert.notEqual(createAVRichTextEditorLute(), editor);
        const calls = new Map<string, boolean>();
        const lute = new Proxy({}, {get: (_target, key) => (value: boolean) => calls.set(String(key), value)}) as Lute;
        configureAVRichTextEditorLute(lute);
        for (const setter of ["SetInlineAsterisk", "SetInlineUnderscore", "SetSup", "SetSub", "SetTag",
            "SetInlineMath", "SetGFMStrikethrough", "SetFullWidthStrikethrough", "SetMark"]) {
            assert.equal(calls.get(setter), false, setter);
        }
    } finally {
        globalThis.window = originalWindow;
    }
});
