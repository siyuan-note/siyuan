import * as assert from "node:assert/strict";
import {test} from "node:test";
import dayjs from "dayjs";
import {compileModule, evaluateModule} from "../../../testSupport/loadModule";
import {DOMFixture} from "./testDOM";

const compiled = compileModule("src/protyle/render/av/relation.ts");

for (const configured of [false, true]) {
    for (const twoWay of [false, true]) {
        test(`relation confirmation saves the staged table atomically and restores its previous state (${configured}, ${twoWay})`, () => {
            const document = new DOMFixture();
            const menu = document.createElement("div");
            menu.innerHTML = `<div class="b3-menu__item" data-col-id="relation"></div>
<input data-type="name" value="Related">
<button class="b3-menu__item" data-type="goSearchAV" data-av-id="new-target"></button>
<input data-type="colName" value="Back" data-old-value="Previous back">
<input class="b3-switch" data-type="backRelation">`;
            Object.assign(menu.querySelector(".b3-switch"), {checked: twoWay});
            const prior = configured ? {spec: 1 as const, enabled: true, viewID: "previous"} : undefined;
            const field = {id: "relation", name: "Related", type: "relation", relation: configured ? {
                avID: "previous-target", isTwoWay: true, backKeyID: "previous-back", detailView: prior,
            } : undefined} as IAVColumn;
            const staged = {spec: 1 as const, enabled: true, viewID: "selected"};
            const operations: Array<{forward: IOperation[]; undo: IOperation[]}> = [];
            const api = evaluateModule<typeof import("./relation")>(compiled, {
                Lute: {NewNodeID: () => "new-back"}, structuredClone,
                require: (id: string) => ({
                    "dayjs": dayjs,
                    "./relatedViewConfig": {getPendingRelatedViewConfig: () => staged},
                    "../../wysiwyg/transaction": {transaction: (_editor: IProtyle, forward: IOperation[], undo: IOperation[]) => {
                        operations.push(JSON.parse(JSON.stringify({forward, undo})));
                    }},
                    "./action": {updateAttrViewCellAnimation() {}},
                    "../../util/selection": {focusBlock() {}},
                }[id] || {}),
            });
            api.updateRelation({protyle: {} as IProtyle, avID: "source", avElement: menu as unknown as Element,
                colsData: [field], blockElement: {getAttribute: () => "carrier", querySelector: (): null => null} as unknown as Element});
            assert.equal(operations.length, 1);
            const {forward, undo} = operations[0];
            assert.equal(forward[0].action, "updateAttrViewColRelation");
            assert.equal(forward[0].id, "new-target");
            assert.equal(forward[0].isTwoWay, twoWay);
            assert.deepEqual(forward.find(operation => operation.action === "setAttrViewRelationDetail"), {
                action: "setAttrViewRelationDetail", avID: "source", keyID: "relation", blockID: "carrier", data: staged,
            });
            assert.equal(undo[0].action, "updateAttrViewColRelation");
            assert.deepEqual(undo.find(operation => operation.action === "setAttrViewRelationDetail")?.data, prior || null);
        });
    }
}
