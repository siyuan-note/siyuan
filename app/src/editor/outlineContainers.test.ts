import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";

for (const path of ["src/layout/dock/Outline.ts", "src/mobile/dock/MobileOutline.ts"]) {
    const source = createSourceFile(path, readFileSync(path, "utf8"), ScriptTarget.ES2021, true);
    const method = source.statements.find(isClassDeclaration).members.find(member =>
        member.name?.getText(source) === "setCurrent");
    const compiled = transpileModule(`class Harness {
        currentRequestID = 0; blockId = "doc"; highlights = [];
        setCurrentById(id) { this.highlights.push(id); }
        ${method.getText(source)}
    }
    globalThis.Harness = Harness;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

    for (const container of ["bq", "callout-content", "tab-item"]) {
        for (const caret of ["heading", "paragraph"]) {
            test(`${path}: ${caret} inside ${container} highlights the preceding outer heading`, async () => {
                const outer = {id: "outer", type: "NodeHeading", container: "", previous: undefined as {id: string} | undefined};
                const inner = {id: "inner", type: "NodeHeading", container, previous: outer};
                const paragraph = {id: "paragraph", type: "NodeParagraph", container, previous: inner};
                const nodes = [outer, inner, paragraph].map(node => ({
                    ...node,
                    getAttribute: (name: string) => name === "data-type" ? node.type : node.id,
                }));
                const context: any = {
                    hasClosestByClassName: (node: typeof inner, className: string) => node.container === className,
                    getPreviousBlock: (node: typeof inner) => nodes.find(item => item.id === node.previous?.id),
                    fetchPost: () => assert.fail("an available outer heading must not require a breadcrumb request"),
                };
                runInNewContext(compiled, context);
                const outline = new context.Harness();
                await outline.setCurrent(nodes[caret === "heading" ? 1 : 2]);
                assert.deepEqual(Array.from(outline.highlights), ["outer"]);
            });
        }
    }

    test(`${path}: headings outside excluded containers retain direct highlighting`, async () => {
        const context: any = {
            hasClosestByClassName: () => false,
            getPreviousBlock: () => assert.fail("a regular heading must be highlighted directly"),
        };
        runInNewContext(compiled, context);
        const outline = new context.Harness();
        await outline.setCurrent({getAttribute: (name: string) => name === "data-type" ? "NodeHeading" : "heading"});
        assert.deepEqual(Array.from(outline.highlights), ["heading"]);
    });
}
