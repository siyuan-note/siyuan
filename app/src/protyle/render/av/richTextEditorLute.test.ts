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

test("primary input preserves blocks without document title presentation", () => {
    require("../../../../stage/protyle/js/lute/lute.min.js");
    const originalWindow = globalThis.window;
    const markdown = {inlineAsterisk: true, inlineUnderscore: true, inlineSup: true, inlineSub: true,
        inlineTag: true, inlineMath: true, inlineStrikethrough: true,
        inlineFullWidthStrikethrough: true, inlineMark: true};
    globalThis.window = {siyuan: {config: {editor: {markdown}}}} as unknown as Window & typeof globalThis;
    try {
        let editor = createAVRichTextEditorLute();
        const input = (text: string) => `<div data-node-id="20261105120000-abcdefg" data-type="NodeParagraph"><div contenteditable="true">${text}${Lute.Caret}</div></div>`;
        const blocks = editor.SpinBlockDOM(input("first") + input("second"));
        assert.equal((blocks.match(/data-type="NodeParagraph"/g) || []).length, 2);
        assert.doesNotMatch(blocks, /protyle-title__input/);
        assert.match(editor.SpinBlockDOM(input("# Heading")), /data-type="NodeHeading"/);
        // 原生解析器的富文本结果不经过需要浏览器 DOM 的光标边界保护层。
        editor = configureAVRichTextEditorLute(Lute.New());
        editor.SetTextMark(true);
        editor.SetProtyleWYSIWYG(true);
        assert.match(editor.SpinBlockDOM(input("**bold** and `code`")), /data-type="strong"/);
        assert.match(editor.SpinBlockDOM(input("**bold** and `code`")), /data-type="code"/);
        for (const enabled of [false, true, false]) {
            markdown.inlineAsterisk = enabled;
            editor = configureAVRichTextEditorLute(editor);
            const result = editor.SpinBlockDOM(input("**bold**"));
            assert.equal(result.includes('data-type="strong"'), enabled);
            assert.doesNotMatch(result, /protyle-title__input/);
        }
        const softBreak = editor.SpinBlockDOM(input('<span data-type="strong">Bold</span><br />Next'));
        assert.match(softBreak, /data-type="strong"/);
        assert.match(softBreak, /Bold<\/span>\nNext/);
        assert.equal((softBreak.match(/data-type="NodeParagraph"/g) || []).length, 1);
        assert.match(createAVRichTextEditorLute().SpinBlockDOM(input("# Heading")), /data-type="NodeHeading"/);
    } finally {
        globalThis.window = originalWindow;
    }
});
