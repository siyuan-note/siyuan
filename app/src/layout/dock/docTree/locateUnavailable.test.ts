import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("DocTreeController.ts", readFileSync("src/layout/dock/docTree/DocTreeController.ts", "utf8"), ScriptTarget.Latest, true);
const method = source.statements.find(isClassDeclaration).members.find(member => member.name?.getText(source) === "locate");
const Controller = new Function(transpileModule(`return class {${method.getText(source)}}`, {
    compilerOptions: {target: ScriptTarget.ES2022},
}).outputText)();

test("automatic locate preserves selection when its document is unavailable and keeps manual errors enabled", async () => {
    for (const [options, ignored] of [
        [{}, false], [{ignoreUnavailable: true}, true], [{select: false, scroll: false}, true],
    ] as const) {
        const controller = new Controller();
        const selected = new Set(["existing"]);
        const root = {occurrenceKey: "notebook:box", notebookId: "box", kind: "notebook"};
        let requested = false;
        Object.assign(controller, {
            interaction: 0, operation: 0, generation: 0, navigationID: 0, expanding: new Map(),
            model: {roots: [root], directory: () => ({}), selected},
            source: {locate: async (_request: unknown, actual: {ignoreUnavailable: boolean}) => {
                assert.equal(actual.ignoreUnavailable, ignored);
                requested = true;
                throw new Error("document tree item is unavailable");
            }},
            finishSelection() {}, scheduleRender() {},
            trackRequest: (_key: string, _directory: unknown, pending: Promise<void>) => pending,
        });
        assert.equal(await controller.locate("box", "hidden", options), undefined);
        assert.equal(requested, true);
        assert.deepEqual([...selected], ["existing"]);
    }
});
