import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/wysiwyg/tabsBoundary.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = (sideIDs: string[], text = "", media = false) => {
    const content = {};
    const block = (id: string, parentElement: unknown) => ({
        parentElement,
        hasAttribute: (name: string) => name === "data-node-id",
        getAttribute: (name: string) => name === "data-node-id" ? id : null,
    });
    const list = block("list", content);
    const item = block("item", list);
    const paragraph = block("paragraph", item);
    const editable = {
        nodeType: 1,
        parentElement: paragraph,
        closest: (selector: string) => selector === ".tab-item-content" ? content : null,
        hasAttribute: () => false,
    };
    const fragment = {
        innerHTML: "",
        textContent: text,
        append: (): void => undefined,
        querySelectorAll: (selector: string) => selector === "[data-node-id]" ?
            sideIDs.map(id => block(id, null)) : [],
        querySelector: () => media ? {} : null,
    };
    const directions: string[] = [];
    const exports: any = {};
    runInNewContext(compiled, {
        exports,
        require: () => ({visibleTabsSelectionHTML: (html: string) => html}),
        Node: {ELEMENT_NODE: 1},
        document: {
            createElement: () => fragment,
            createRange: () => ({
                selectNodeContents: (): void => undefined,
                setEnd: () => directions.push("backward"),
                setStart: () => directions.push("forward"),
                cloneContents: () => fragment,
            }),
        },
    });
    const range = {collapsed: true, startContainer: editable, endContainer: editable, startOffset: 0, endOffset: 0};
    return {range, editable, directions, boundary: (backward: boolean) => exports.isTabTextBoundary(range, backward)};
};

for (const backward of [true, false]) {
    test(`${backward ? "退格" : "删除"}允许处理页签内的相邻空段落和空列表项`, () => {
        for (const siblingID of ["empty-paragraph", "empty-item", "empty-list"]) {
            const f = fixture(["list", "item", "paragraph", siblingID]);
            assert.equal(f.boundary(backward), false);
            assert.deepEqual(f.directions, [backward ? "backward" : "forward"]);
        }
    });

    test(`${backward ? "退格" : "删除"}仍保护仅包含光标祖先的页签正文边界`, () => {
        assert.equal(fixture(["list", "item", "paragraph"]).boundary(backward), true);
        assert.equal(fixture(["list", "item", "paragraph"], "\u200b").boundary(backward), true);
        assert.equal(fixture(["list", "item", "paragraph"], "text").boundary(backward), false);
        assert.equal(fixture(["list", "item", "paragraph"], "", true).boundary(backward), false);
    });
}

test("非折叠选区和页签外的正文不触发页签边界保护", () => {
    const selection = fixture([]);
    selection.range.collapsed = false;
    assert.equal(selection.boundary(true), false);
    const outside = fixture([]);
    outside.editable.closest = () => null;
    assert.equal(outside.boundary(true), false);
});
