import * as assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";

const source = readFileSync("src/card/flashcardV2.ts", "utf8");
test("deleted sources use a dedicated restore label in all languages", () => {
    const line = source.split("\n").find(value => value.startsWith('<span data-type="sourceLifecycle"'));
    for (const file of readdirSync("appearance/langs").filter(name => name.endsWith(".json"))) {
        const languages = JSON.parse(readFileSync(`appearance/langs/${file}`, "utf8"));
        for (const deleted of [true, false]) {
            const html = runInNewContext(`\`${line}\``, {window: {siyuan: {languages}}, deleted});
            const label = deleted ? languages.flashcardRestoreSource : languages.delete;
            assert.ok(typeof label === "string" && label.length > 0);
            assert.ok(html.includes(`aria-label="${label}"`));
            assert.ok(html.includes(deleted ? "#iconUndo" : "#iconTrashcan"));
        }
    }
    assert.doesNotMatch(line, /languages\.(restore|flashcardSourceRestore)\b/);
});

test("source restoration keeps the original source identity and lifecycle endpoint", () => {
    const snippet = source.slice(source.indexOf('if (type === "sourceLifecycle" && item.dataset.sourceId)'),
        source.indexOf('if (type === "editSource" && item.dataset.sourceId)'));
    const requests: Array<{url: string, data: {sourceID: string, action: string}}> = [];
    runInNewContext(transpileModule(`(() => {${snippet}})();`, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText, {type: "sourceLifecycle", item: {dataset: {sourceId: "original-source"}},
        cards: [{card: {sourceID: "original-source"}, sourceStatus: "deleted"}],
        genUUID: () => "operation", reloadPage: () => {},
        fetchPost: (url: string, data: {sourceID: string, action: string}) => requests.push({url, data}),
        confirmDialog: () => assert.fail("Restoration must not gain a new confirmation flow"),
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/api/flashcard/manageSourceLifecycle");
    assert.equal(requests[0].data.sourceID, "original-source");
    assert.equal(requests[0].data.action, "restore");
});
