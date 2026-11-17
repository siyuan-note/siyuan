import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";

test("question-answer entry requires two blocks and keeps its original creation handler", () => {
    const source = readFileSync("src/card/makeCard.ts", "utf8");
    const snippet = source.slice(source.indexOf("const sourceActions ="), source.indexOf("const dialog =", source.indexOf("const sourceActions =")));
    for (const ids of [[], ["a"], ["a", "b"], ["a", "b", "c"]]) {
        const actions: Array<{type: string, label: string}> = [];
        runInNewContext(snippet, {ids, window: {siyuan: {languages: {flashcardQA: "Question and answer"}}},
            actionHTML: (type: string, _icon: string, label: string) => { actions.push({type, label}); return ""; }});
        assert.equal(actions.some(item => item.type === "basic"), ids.length >= 2);
        if (ids.length >= 2) { assert.equal(actions.find(item => item.type === "basic").label, "Question and answer"); }
    }
    const action = source.slice(source.indexOf('} else if (type === "basic")') + "} else ".length,
        source.indexOf('} else if (type === "advanced")')) + "}";
    let closed = false;
    let received: string[];
    const ids = ["question", "answer"];
    runInNewContext(action, {type: "basic", ids, dialog: {destroy: () => { closed = true; }},
        openFlashcardV2BasicSource: (blockIDs: string[]) => { received = blockIDs; }});
    assert.equal(closed, true);
    assert.equal(received, ids);
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
