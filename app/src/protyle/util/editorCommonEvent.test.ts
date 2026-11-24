import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";
import {isProtyleBlockDropAsReference, registerProtyleRuntimeCapabilities} from "../runtimeCapabilities";
import {isCopyBlockDrag, isFragmentBlockDrag, uniqueDragIds} from "./dragDocument";

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

const bindDropEvent = transpileModule(source.slice(source.indexOf("export const dropEvent"),
    source.indexOf("\nconst highlightByLevel")).replace("export const dropEvent", "const dropEvent") + "\ndropEvent;", {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

test("agent block drop uses source block IDs and the reference caret", async () => {
    const Constants = {
        SIYUAN_DROP_BLOCK: "application/siyuan-block",
        SIYUAN_DROP_BLOCK_REF: "application/siyuan-block-ref",
        SIYUAN_DROP_GUTTER: "application/siyuan-gutter",
        ZWSP: "\u200b",
    };
    const databaseID = "20261122000000-abcdefg";
    const listItemID = "20261122000001-hijklmn";
    const handlers = new Map<string, (event: object) => void | Promise<void>>();
    const target = {
        lastElementChild: {getBoundingClientRect: () => ({bottom: 50})},
        querySelectorAll: (): Element[] => [],
        addEventListener: (type: string, handler: (event: object) => void | Promise<void>) => handlers.set(type, handler),
    };
    const protyle = {
        lite: true,
        wysiwyg: {element: target},
        contentElement: {clientWidth: 100, getBoundingClientRect: () => ({left: 0})},
        lute: {Md2BlockDOM: (markdown: string) => markdown},
    } as unknown as IProtyle;
    registerProtyleRuntimeCapabilities(protyle, {blockDropAsReference: true});

    const range = {startContainer: {}};
    const refLookups: string[] = [];
    const inserted: string[] = [];
    const titles: string[] = [];
    const positions: number[][] = [];
    let focused = false;
    const dropEvent = runInNewContext(bindDropEvent, {
        Constants, isProtyleBlockDropAsReference, isCopyBlockDrag, isFragmentBlockDrag, uniqueDragIds,
        window: {siyuan: {
            config: {system: {workspaceDir: "D:/Workspace"}},
            dragElement: {closest: (): Element | null => null},
            languages: {dragTipRef: "reference"},
        }},
        document: {addEventListener: () => {}, elementFromPoint: () => target},
        createListDragTarget: () => {},
        cleanupDragIndicators: () => {},
        hideDragTip: () => {},
        showDragTip: (_title: string, action: string) => titles.push(action),
        hideCaretLine: () => {},
        showCaretLine: (...point: number[]) => positions.push(point),
        getRangeByPoint: () => range,
        getCaretRect: () => ({left: 30, top: 20, height: 10}),
        getComputedStyle: () => ({paddingLeft: "0px", paddingRight: "0px"}),
        hasClosestByClassName: () => false,
        hasClosestByTag: () => false,
        hasClosestBlock: () => false,
        hasClosestByAttribute: () => false,
        getContenteditableElement: () => false,
        isAttributeViewTitleTarget: () => false,
        isBlockRefDropTargetDisabled: () => false,
        focusByRange: (dropRange: typeof range) => {focused = dropRange === range;},
        fetchSyncPost: async (url: string, {id}: {id: string}) => {
            assert.equal(url, "/api/block/getRefText");
            refLookups.push(id);
            return {data: id === databaseID ? "Database" : "Item"};
        },
        insertHTML: (html: string) => inserted.push(html),
    });
    dropEvent(protyle, target);

    const gutter = (type: string, ids: string, workspace?: string) =>
        Constants.SIYUAN_DROP_GUTTER + [type, "", ids, ...(workspace ? [workspace] : [])].join(Constants.ZWSP);
    const fire = (gutterType: string) => {
        const dataTransfer = {types: [Constants.SIYUAN_DROP_BLOCK, gutterType], dropEffect: "move", getData: () => ""};
        const event = {dataTransfer, target, clientX: 30, clientY: 20, y: 20, preventDefault: () => {}, stopPropagation: () => {}};
        return {dataTransfer, event};
    };

    const {dataTransfer, event} = fire(gutter("nodeattributeview", `${databaseID},${listItemID},${databaseID}`, "d:/workspace"));
    await handlers.get("dragover")(event);
    assert.equal(dataTransfer.dropEffect, "copy");
    assert.deepEqual(titles, ["reference"]);
    assert.deepEqual(positions, [[30, 20, 10]]);
    await handlers.get("drop")(event);
    assert.ok(focused);
    assert.deepEqual(refLookups, [databaseID, listItemID]);
    assert.deepEqual(inserted, [`- ((${databaseID} 'Database'))\n- ((${listItemID} 'Item'))`]);

    await handlers.get("drop")(fire(gutter("nodelistitem", listItemID)).event);
    assert.equal(inserted[1], `((${listItemID} 'Item'))`);

    await handlers.get("drop")(fire(gutter("nodeparagraph", databaseID, "d:/another-workspace")).event);
    assert.equal(inserted.length, 2);
    assert.deepEqual(refLookups, [databaseID, listItemID, listItemID]);
});
