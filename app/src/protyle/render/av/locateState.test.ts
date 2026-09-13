import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {IAVLocateRequest, locateRequests, retainAVLocate} from "./locateState";
import {updateGroupFoldedStates, setGroupFoldedStates, getGroupFoldedStates} from "./groupFold";
import {getGroupTableRenderPlan} from "./groupTableVirtual";

const setup = () => {
    const block = {contains: (target: unknown) => target === block} as HTMLElement;
    const listeners: Record<string, (event: {target: unknown}) => void> = {};
    const editor = {
        querySelectorAll: () => [block],
        addEventListener: (name: string, listener: (event: {target: unknown}) => void) => {
            listeners[name] = listener;
        },
    } as unknown as HTMLElement;
    const request: IAVLocateRequest = {itemID: "row", scroll: true, highlight: true, select: true};
    locateRequests.set(block, request);
    retainAVLocate(editor, request, "view", "group");
    return {block, request, listeners};
};

describe("temporary located group expansion", () => {
    it("retains the target across renders without repeating navigation or changing the fold baseline", () => {
        const {block, request} = setup();
        const group = {id: "group", groupFolded: true, groupHidden: 0, rows: [{id: "row"}]} as IAVTable;
        setGroupFoldedStates(block, [group]);
        for (let render = 0; render < 2; render++) {
            assert.equal(locateRequests.get(block), request);
            const plan = getGroupTableRenderPlan([group], {
                [request.groupID]: {renderedStart: 0, renderedEnd: 0, topSpacerHeight: 0, locate: true},
            });
            assert.equal(plan.renderedRowCounts.group, 1);
        }
        assert.equal(request.scroll, false);
        assert.equal(request.highlight, false);
        assert.equal(request.select, false);
        assert.equal(request.persistView, false);
        assert.deepEqual(getGroupFoldedStates(block), {group: true});
    });

    it("stops retaining the target when its group is explicitly folded", () => {
        const {block} = setup();
        updateGroupFoldedStates(block, {other: true});
        assert.ok(locateRequests.has(block));
        updateGroupFoldedStates(block, {group: true});
        assert.equal(locateRequests.has(block), false);
        const group = {id: "group", groupFolded: true, groupHidden: 0, rows: [{id: "row"}]} as IAVTable;
        assert.equal(getGroupTableRenderPlan([group], {}).renderedRowCounts.group, undefined);
    });

    it("keeps editing inside the block and clears on navigation to another block", () => {
        const {block, listeners} = setup();
        listeners.pointerdown({target: block});
        assert.ok(locateRequests.has(block));
        listeners.focusin({target: {}});
        assert.equal(locateRequests.has(block), false);
    });
});
