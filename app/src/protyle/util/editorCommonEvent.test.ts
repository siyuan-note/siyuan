import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";

const source = readFileSync("src/protyle/util/editorCommonEvent.ts", "utf8");
const fileTreeDrop = source.indexOf("const ids = event.dataTransfer.getData(Constants.SIYUAN_DROP_FILE)");
const start = source.indexOf("const avID =", fileTreeDrop);
const end = source.indexOf('blockElement.setAttribute("updated", newUpdated);', start);
assert.ok(fileTreeDrop > 0 && start > fileTreeDrop && end > start);
const compiled = transpileModule(source.slice(start, end), {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

for (const count of [1, 3]) {
    test(`file tree drop: undo and redo ${count} document entries without removing existing entries`, () => {
        const ids = Array.from({length: count}, (_, index) => `document-${index}`);
        let nextID = 0;
        let operations: IOperation[];
        let inverse: IOperation[];
        const blockElement = {
            dataset: {nodeId: "database-block"},
            getAttribute: (name: string) => name === "data-av-id" ? "database" : "20261028000000",
        };
        runInNewContext(compiled, {
            ids, blockElement, protyle: {}, previousID: "previous",
            bodyElement: {getAttribute: () => "group"},
            Lute: {NewNodeID: () => `item-${++nextID}`},
            dayjs: () => ({format: () => "20261028010000"}),
            getAVViewID: () => "view",
            getAVFilteredTipContext: () => ({}),
            insertAttrViewBlockAnimation: () => {},
            transaction: (_protyle: IProtyle, forward: IOperation[], backward: IOperation[]) => {
                operations = forward;
                inverse = backward;
            },
        });
        assert.deepEqual(Array.from(operations[0].srcs, src => src.id), ids);
        assert.ok(operations[0].srcs.every(src => !src.isDetached && !ids.includes(src.itemID)));
        assert.equal(operations[0].previousID, "previous");
        assert.equal(operations[0].groupID, "group");
        assert.equal(operations[0].viewID, "view");
        const entries = new Map([["existing-item", ids[0]]]);
        const apply = (items: IOperation[]) => items.forEach(operation => {
            if (operation.action === "insertAttrViewBlock") {
                operation.srcs.forEach(src => entries.set(src.itemID, src.id));
            } else if (operation.action === "removeAttrViewBlock") {
                operation.srcIDs.forEach(id => entries.delete(id));
            }
        });
        for (let cycle = 0; cycle < 2; cycle++) {
            apply(operations);
            assert.equal(entries.size, count + 1);
            apply(inverse);
            assert.deepEqual([...entries], [["existing-item", ids[0]]]);
        }
    });
}
