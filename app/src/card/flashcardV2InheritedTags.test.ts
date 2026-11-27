import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";
const source = readFileSync("src/card/flashcardV2.ts", "utf8");
const script = source.slice(source.indexOf("const flashcardTagPath ="), source.indexOf("const renderFlashcardTagChoices =")) +
    source.slice(source.indexOf("const renderFlashcardInheritedTags ="), source.indexOf("const openFlashcardV2Tags ="));
const context: Record<string, any> = {
    escapeHtml: (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    window: {siyuan: {languages: {flashcardDirectTagsTip: "Direct tags only", flashcardInheritedTags: "Inherited", empty: "Empty"}}},
};
runInNewContext(transpileModule(`${script}\nthis.render = renderFlashcardInheritedTags;`, {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText, context);
test("inherited tags stay read-only and preserve unknown names without mutation", () => {
    const tags = [{id: "parent", name: "Parent"}, {id: "child", name: "<child>", parentID: "parent"}];
    const ids = ["child", "unknown<id>", "child"];
    const before = JSON.stringify({tags, ids});
    const html = context.render(tags, ids);
    assert.match(html, /Parent \/ &lt;child&gt;/);
    assert.match(html, /unknown&lt;id&gt;/);
    assert.equal((html.match(/&lt;child&gt;/g) || []).length, 1);
    assert.doesNotMatch(html, /<input|<button|data-id=/);
    assert.equal(JSON.stringify({tags, ids}), before);
    tags[0].name = "Renamed";
    assert.match(context.render(tags, ids), /Renamed \/ &lt;child&gt;/);
    assert.match(context.render([], Array.from({length: 1001}, (_, index) => `tag-${index}`)), /tag-1000/);
    assert.match(context.render([], []), /Inherited: Empty/);
});
test("only single-card editor receives source tags while assignments remain direct", () => {
    assert.match(source, /selectedCard\.cardTagIDs \|\| \[\], reloadPage, undefined,\s*selectedCard\.sourceTagIDs \|\| \[\]/);
    assert.match(source, /openFlashcardV2Tags\("card", selected, selection\.selected, reloadPage, assignments\)/);
    assert.match(source, /inheritedTagIDs === undefined \? "" :/);
    const save = source.slice(source.indexOf("const openFlashcardV2Tags ="), source.indexOf("const openFlashcardV2FlagDefinitions ="));
    assert.match(save, /initialAssignments\[id\] \|\| \[\] : selectedTagIDs/);
    assert.doesNotMatch(save, /effectiveTagIDs/);
});
