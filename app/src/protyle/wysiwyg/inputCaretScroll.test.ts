import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {ScriptTarget, transpileModule} from "typescript";

test("input reserves cursor context after line breaks, not ordinary typing or composition", async () => {
    const source = readFileSync(join(__dirname, "input.ts"), "utf8");
    const body = source.slice(source.indexOf("export const input ="), source.indexOf("const updateInput ="));
    for (const inputType of [undefined, "insertText", "insertCompositionText", "deleteContentBackward",
        "insertParagraph", "insertLineBreak"]) {
        for (const isComposing of [false, true]) {
            for (const typewriterMode of [false, true]) {
                const events: string[] = [];
                const protyle = {wysiwyg: {element: {}}, options: {typewriterMode}};
                const input = new Function("inputBlock", "suspendLongTextRuns", "scheduleCaretScroll",
                    transpileModule(body.replace("export const", "const"), {
                        compilerOptions: {target: ScriptTarget.ES2021},
                    }).outputText + "\nreturn input;")(
                    async () => { events.push("input"); },
                    () => () => { events.push("resume"); },
                    (owner: unknown, direction: string) => {
                        assert.equal(owner, protyle);
                        assert.equal(direction, "down");
                        events.push("scroll");
                    });
                await input(protyle, {}, {}, true, inputType ? {inputType, isComposing} : undefined);
                const shouldScroll = typewriterMode && !isComposing &&
                    ["insertParagraph", "insertLineBreak"].includes(inputType);
                assert.deepEqual(events, ["input", "resume", ...(shouldScroll ? ["scroll"] : [])]);
            }
        }
    }
});
