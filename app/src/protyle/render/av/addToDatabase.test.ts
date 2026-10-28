import * as assert from "node:assert/strict";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {loadModule} from "../../../testSupport/loadModule";

test("adding graph documents to a database preserves explicit positioning and undo transaction context", () => {
    const searches: {target: HTMLElement, position: IPosition, callback: (row: unknown) => void}[] = [];
    const operations: IOperation[][] = [];
    const exports = loadModule<typeof import("./addToDatabase")>("src/protyle/render/av/addToDatabase.ts", {
        Lute: {NewNodeID: () => "item"},
        require: (name: string) => {
            if (name === "./relation") { return {openSearchAV: (options: typeof searches[number]) => searches.push(options)}; }
            if (name === "../../wysiwyg/transaction") { return {
                transaction: (_protyle: unknown, data: IOperation[]) => operations.push(data)}; }
            if (name === "./filteredTip") { return {getAVFilteredTipContext: (scope: string) => ({scope})}; }
            if (name === "dayjs") { return () => ({format: () => "20261006123456"}); }
            return {};
        },
    }, ScriptTarget.ES2021);
    const target = {} as HTMLElement;
    const position = {x: 60, y: 90};
    exports.addBlocksToDatabase(["document"], target, position);
    assert.equal(searches[0].target, target);
    assert.equal(searches[0].position, position);
    searches[0].callback({dataset: {avId: "database", viewId: "view", blockId: "database-block"}});
    assert.equal(operations[0][0].action, "insertAttrViewBlock");
    assert.equal(operations[0][0].viewID, "view");
    assert.equal(operations[0][0].ignoreDefaultFill, false);
    assert.equal(JSON.stringify(operations[0][0].srcs), '[{"itemID":"item","id":"document","isDetached":false}]');
    assert.equal(operations[0][1].action, "doUpdateUpdated");
    exports.addFilesToDatabase([]);
    assert.equal(searches.length, 1);
    const row = {getAttribute: () => "tree-document"} as unknown as Element;
    exports.addFilesToDatabase([row]);
    assert.equal(searches[1].target, row);
    assert.equal(searches[1].position, undefined);
});
