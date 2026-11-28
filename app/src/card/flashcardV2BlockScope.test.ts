import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";

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
