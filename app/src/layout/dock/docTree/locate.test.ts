import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("DocTreeController.ts", readFileSync("src/layout/dock/docTree/DocTreeController.ts", "utf8"), ScriptTarget.Latest, true);
const methods = source.statements.find(isClassDeclaration).members.filter(member =>
    ["locate", "ensureRendered", "scrollElement", "getListStart"].includes(member.name?.getText(source)));
const Controller = new Function(transpileModule(`return class {${methods.map(method => method.getText(source)).join("\n")}}`, {
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

test("locating an offscreen document centers it while ordinary selection scrolls only as needed", async () => {
    const row = {occurrenceKey: "box/document", id: "document", notebookId: "box", kind: "document"};
    const element = {scrollTop: 0, clientHeight: 100};
    const controller = new Controller();
    Object.assign(controller, {
        options: {element}, rowHeight: 20, positionOf: () => 10, itemAt: async () => row,
        interaction: 0, operation: 0, generation: 0, navigationID: 0, expanding: new Map(),
        model: {roots: [row], directory: () => ({}), project() {}},
        async select(key: string, options: {scroll: boolean}) {
            assert.equal(key, row.occurrenceKey);
            assert.equal(options.scroll, false);
        },
        finishSelection() {}, evictPages() {}, render() {}, scheduleRender() {},
        getMountedElement: (): HTMLElement | undefined => undefined,
        trackRequest: (_key: string, _directory: unknown, pending: Promise<void>) => pending,
    });
    for (const initial of [0, 240]) {
        element.scrollTop = initial;
        await controller.locate("box", "document");
        assert.equal(element.scrollTop, 160);
    }
    element.scrollTop = 180;
    await controller.locate("box", "document");
    assert.equal(element.scrollTop, 180);
    element.scrollTop = 0;
    await controller.ensureRendered(row.occurrenceKey);
    assert.equal(element.scrollTop, 120);
});
