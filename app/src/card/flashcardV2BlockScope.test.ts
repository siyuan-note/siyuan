import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";
import {flashcardV2DocumentTreeQuery} from "./flashcardV2Query";

test("block review scopes include folded children and exclude rendered query results", async () => {
    const source = readFileSync("src/card/flashcardV2BlockScope.ts", "utf8");
    const code = source.slice(source.indexOf("export const")).replace("export const", "const");
    const script = transpileModule(code + "\ngetFlashcardV2BlockScope(id, type);", {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const embed = {dataset: {nodeId: "embed"}, closest: () => embed};
    const block = (id: string, withinEmbed = false) => ({
        dataset: {nodeId: id}, closest: () => withinEmbed ? embed : null,
    });
    const elements = [block("selected"), block("folded"), embed, block("outside", true)];
    for (const type of ["NodeHeading", "NodeListItem"]) {
        const requests: string[] = [];
        const dom = "loaded";
        const result = await runInNewContext(script, {
            id: "selected", type,
            fetchSyncPost: async (url: string) => {
                requests.push(url);
                return {code: 0, data: type === "NodeHeading" ? dom : {dom}};
            },
            document: {
                createElement: () => ({content: {querySelectorAll: () => elements}}),
            },
        });
        assert.deepEqual(requests, [type === "NodeHeading" ? "/api/block/getHeadingChildrenDOM" : "/api/block/getBlockDOM"]);
        assert.deepEqual(Array.from(result), ["selected", "folded", "embed"]);
    }
    assert.equal(await runInNewContext(script, {
        id: "selected", type: "NodeHeading", fetchSyncPost: async () => ({code: -1}),
    }), undefined);
});

test("a document scope covers its exact root and child paths in the same notebook", () => {
    const query = flashcardV2DocumentTreeQuery("doc", "book", "/parent/doc.sy");
    assert.deepEqual(query.root.children, [
        {operator: "predicate", field: "notebookID", comparator: "equal", value: "book"},
        {operator: "or", children: [
            {operator: "predicate", field: "rootID", comparator: "equal", value: "doc"},
            {operator: "predicate", field: "path", comparator: "startsWith", value: "/parent/doc/"},
        ]},
    ]);
});
