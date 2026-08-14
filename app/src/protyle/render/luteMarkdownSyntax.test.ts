import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {applyLuteMarkdownSyntax} from "./luteMarkdownSyntax";

describe("applyLuteMarkdownSyntax", () => {
    it("applies every Markdown syntax setting to an existing Lute instance", () => {
        const calls: Array<[string, boolean]> = [];
        const lute = new Proxy({}, {
            get: (_target, property) => (value: boolean) => calls.push([String(property), value]),
        }) as Lute;
        const markdown: Config.IMarkdown = {
            inlineAsterisk: true,
            inlineUnderscore: false,
            inlineSup: true,
            inlineSub: false,
            inlineTag: true,
            inlineMath: false,
            inlineStrikethrough: true,
            inlineFullWidthStrikethrough: true,
            blockFullWidthTaskList: true,
            inlineMark: false,
            codeBlockMiddleDot: true,
        };

        applyLuteMarkdownSyntax(lute, markdown);

        assert.deepEqual(calls, [
            ["SetInlineAsterisk", true],
            ["SetInlineUnderscore", false],
            ["SetSup", true],
            ["SetSub", false],
            ["SetTag", true],
            ["SetInlineMath", false],
            ["SetGFMStrikethrough1", false],
            ["SetGFMStrikethrough", true],
            ["SetFullWidthStrikethrough", true],
            ["SetMark", false],
        ]);
    });
});
