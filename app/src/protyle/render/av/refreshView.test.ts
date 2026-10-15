import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {DOMFixture} from "./testDOM";

const compiled = transpileModule(readFileSync("src/protyle/render/av/render.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

test("switching one database carrier refreshes only its copies and preserves other carriers", () => {
    const document = new DOMFixture();
    const root = document.createElement("div");
    document.body.append(root);
    root.innerHTML = ["carrier", "mirror", "carrier"].map(id =>
        `<div class="av" data-av-id="database" data-node-id="${id}" data-render="true"><div class="av__header" data-view-pages="pages"></div><div class="av__body" data-page-size="100"></div></div>`).join("");
    const blocks = root.children;
    const rendered: unknown[] = [];
    const exports: any = {};
    runInNewContext(compiled, {exports, require: () => ({
        getAVViewPageSize: (_pages: string, id: string) => id === "limited" ? "50" : undefined,
    }), window: {setTimeout: () => assert.fail("Carrier-only view changes must not schedule a database-wide refresh")}});
    exports.avRender = (block: unknown) => { rendered.push(block); };
    const protyle = {wysiwyg: {element: root}};
    exports.refreshAV(protyle, {action: "setAttrViewBlockView", avID: "database", blockID: "carrier", id: "limited"});
    assert.deepEqual(rendered, [blocks[0], blocks[2]]);
    assert.equal(blocks[1].getAttribute("data-render"), "true");
    assert.equal(blocks[1].querySelector(".av__body").dataset.pageSize, "100");
    for (const block of [blocks[0], blocks[2]]) {
        assert.equal(block.getAttribute("data-render"), null);
        assert.equal(block.querySelector(".av__body").dataset.pageSize, "50");
    }
    rendered.length = 0;
    exports.refreshAV(protyle, {action: "setAttrViewBlockView", avID: "database", blockID: "carrier", id: "unlimited"});
    assert.deepEqual(rendered, [blocks[0], blocks[2]]);
    assert.equal(blocks[0].querySelector(".av__body").hasAttribute("data-page-size"), false);
    assert.equal(blocks[1].querySelector(".av__body").dataset.pageSize, "100");
});
