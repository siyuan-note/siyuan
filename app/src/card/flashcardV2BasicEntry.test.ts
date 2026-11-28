import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";

test("card source menu omits quick creation and keeps the question-answer handler", () => {
    const source = readFileSync("src/card/makeCard.ts", "utf8");
    const snippet = source.slice(source.indexOf("export const flashcardSourceMenuItems"),
        source.indexOf("export const quickMakeCard")).replace("export const", "const");
    const code = transpileModule(snippet + "\nflashcardSourceMenuItems({}, ids);", {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    for (const ids of [[], ["a"], ["a", "b"], ["a", "b", "c"]]) {
        const calls: string[][] = [];
        const actions: IMenu[] = runInNewContext(code, {
            ids, window: {siyuan: {languages: {flashcardQA: "Question and answer"}}},
            openFlashcardV2BasicSource: (blockIDs: string[]) => { calls.push(blockIDs); },
        });
        assert.deepEqual(Array.from(actions, item => item.id),
            ["basic", "advanced", "reviewSets", "presets", "management", "statistics", "anki"]);
        const basic = actions.find(item => item.id === "basic");
        assert.equal(basic.ignore, ids.length < 2);
        assert.equal(actions.find(item => item.id === "advanced").ignore, ids.length === 0);
        if (!basic.ignore) {
            assert.equal(basic.label, "Question and answer");
            basic.click(null, null);
            assert.equal(calls[0], ids);
        }
    }
});

test("basic source dialog uses the entry title without changing direction defaults or submitted value", () => {
    const source = readFileSync("src/card/flashcardV2.ts", "utf8");
    const basic = source.slice(source.indexOf("export const openFlashcardV2BasicSource ="),
        source.indexOf("interface IFlashcardV2AdvancedGenerationConfig"));
    const start = basic.indexOf("title:");
    const title = basic.slice(start, basic.indexOf("width:", start));
    assert.equal(runInNewContext(`({${title}}).title`, {
        window: {siyuan: {languages: {flashcardQA: "Question and answer", riffCard: "Flashcards"}}},
    }), "Question and answer");
    const select = basic.slice(basic.indexOf('<select data-type="direction"'), basic.indexOf("</select>"));
    assert.deepEqual([...select.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]),
        ["forward", "reverse", "bidirectional", "closed"]);
    assert.doesNotMatch(select, /\sselected/);
    const extraction = basic.slice(basic.indexOf("const direction ="), basic.indexOf("const operation =", basic.indexOf("const direction =")));
    for (const direction of ["forward", "reverse", "bidirectional", "closed"]) {
        const payload = runInNewContext(transpileModule(extraction + "\npayload;", {
            compilerOptions: {target: ScriptTarget.ES2021},
        }).outputText, {dialog: {element: {querySelector: () => ({value: direction})}},
            sourceID: "source", blockIDs: ["question", "answer"], reviewSets: {selectedOptions: []}});
        assert.equal(payload.direction, direction);
    }
});
