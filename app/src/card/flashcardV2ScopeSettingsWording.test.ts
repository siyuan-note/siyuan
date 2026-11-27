import * as assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";

test("scope entry and dialog titles use the same complete phrase in every language", () => {
    const source = readFileSync("src/card/flashcardV2.ts", "utf8");
    const policy = source.slice(source.indexOf("const openFlashcardV2StudyPolicy ="));
    const title = policy.slice(policy.indexOf("title:"), policy.indexOf("width:"));
    const languages = readdirSync("appearance/langs").filter(name => name.endsWith(".json"));
    assert.ok(languages.includes("en.json"));
    for (const language of languages) {
        const strings = JSON.parse(readFileSync(`appearance/langs/${language}`, "utf8"));
        for (const scopeType of ["document", "notebook"]) {
            const key = scopeType === "document" ? "flashcardDocumentSettings" : "flashcardNotebookSettings";
            assert.ok(typeof strings[key] === "string" && strings[key].length > 0);
            const context = {window: {siyuan: {languages: strings}}, scopeType};
            const labelLine = source.split("\n").find(line => line.startsWith(`<span data-type="${scopeType}Policy"`));
            assert.ok(labelLine);
            const markup = runInNewContext(`\`${labelLine}\``, context) as string;
            assert.ok(markup.includes(`aria-label="${strings[key]}"`), `${language}: ${scopeType}`);
            assert.equal(runInNewContext(`({${title}}).title`, context), strings[key]);
            assert.doesNotMatch(markup, /undefined/);
        }
    }
    assert.doesNotMatch(source, /languages\.notebook\b/);
});
