import * as assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";

const source = readFileSync("src/card/flashcardV2.ts", "utf8");
const directionSource = source.slice(source.indexOf("const basicSourceDirection ="),
    source.indexOf("const openFlashcardV2CardHistory ="));

test("direction entry, settings title and creation field share a complete translated label", () => {
    const entry = source.split("\n").find(line => line.includes('${result.sourceType === "qa" ? `<span data-type="direction"'));
    const creation = source.slice(source.indexOf("export const openFlashcardV2BasicSource ="));
    const field = creation.split("\n").find(line => line.includes('class="b3-label__text"'));
    const title = directionSource.slice(directionSource.indexOf("title:"), directionSource.indexOf("width:"));
    for (const file of readdirSync("appearance/langs").filter(name => name.endsWith(".json"))) {
        const languages = JSON.parse(readFileSync(`appearance/langs/${file}`, "utf8"));
        const context = {window: {siyuan: {languages}}, result: {sourceType: "qa"}};
        const label = languages.flashcardDirectionSettings;
        assert.ok(typeof label === "string" && label.length > 0);
        const markup = runInNewContext(`\`${entry}\``, context);
        assert.ok(markup.includes(`aria-label="${label}"`));
        assert.equal(runInNewContext(`({${title}}).title`, context), label);
        assert.ok(runInNewContext(`\`${field}\``, context).includes(`>${label}</div>`));
    }
});

test("direction settings retain current direction, option order and exact submitted choice", () => {
    const code = transpileModule(directionSource + '\nopenFlashcardV2Direction("original-source", cards, () => {});', {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    for (const current of ["forward", "reverse", "bidirectional", "closed"]) {
        for (const chosen of ["forward", "reverse", "bidirectional", "closed"]) {
            const cards = ["forward", "reverse"].map(variantKey => ({card: {variantKey,
                generationStatus: current === variantKey || current === "bidirectional" ? "active" : "disabledByTemplate"}}));
            const select = {value: ""};
            let submit: () => void;
            let content = "";
            let request: {url: string, data: {sourceID: string, direction: string}};
            const buttons = [{addEventListener: () => {}}, {addEventListener: (_event: string, callback: () => void) => { submit = callback; }}];
            runInNewContext(code, {cards, window: {siyuan: {languages: {}}}, isMobile: () => false,
                genUUID: () => "operation",
                Dialog: class {
                    constructor(options: {content: string}) { content = options.content; }
                    element = {querySelector: () => select, querySelectorAll: () => buttons};
                    destroy() {}
                },
                fetchPost: (url: string, data: {sourceID: string, direction: string}) => { request = {url, data}; },
            });
            assert.equal(select.value, current);
            assert.deepEqual([...content.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]),
                ["forward", "reverse", "bidirectional", "closed"]);
            select.value = chosen;
            submit();
            assert.equal(request.url, "/api/flashcard/updateBasicDirection");
            assert.equal(request.data.sourceID, "original-source");
            assert.equal(request.data.direction, chosen);
        }
    }
});
