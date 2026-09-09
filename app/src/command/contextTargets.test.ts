import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getCommandBlocks, getCommandDocument, hasCommandEditorTarget} from "./contextTargets";
import type {ICommandContextSnapshot} from "./types";

const createEditorContext = () => {
    const first = {isConnected: true, getAttribute: () => "first"} as unknown as HTMLElement;
    const second = {isConnected: true, getAttribute: () => "second"} as unknown as HTMLElement;
    const state = {selected: [] as HTMLElement[], nodes: [first, second]};
    const element = {
        isConnected: true,
        contains: (node: HTMLElement) => state.nodes.includes(node),
        querySelectorAll: () => state.selected,
    } as unknown as HTMLElement;
    const context: ICommandContextSnapshot = {
        app: {}, source: "commandPanel", environment: "desktop", focus: "editor",
        selectedBlocks: [], block: {id: "first", element: first},
        range: {startContainer: first, endContainer: first} as unknown as Range,
        document: {rootId: "doc", notebookId: "box", path: "/doc.sy"},
        protyle: {
            element, wysiwyg: {element}, block: {rootID: "doc"}, notebookId: "box", path: "/doc.sy",
        } as unknown as IProtyle,
    };
    return {context, state, first, second};
};

describe("context command targets", () => {
    it("prioritizes selected blocks over the current block", () => {
        const {context, state, second} = createEditorContext();
        context.selectedBlocks = [{id: "second", element: second}];
        state.selected = [second];
        assert.equal(hasCommandEditorTarget(context), true);
        assert.deepEqual(getCommandBlocks(context), context.selectedBlocks);
        context.selectedBlocks = [];
        state.selected = [];
        assert.deepEqual(getCommandBlocks(context), [context.block]);
    });

    it("retains the captured editor target after palette focus changes", () => {
        const {context} = createEditorContext();
        context.activeElement = {} as HTMLElement;
        assert.equal(hasCommandEditorTarget(context), true);
        assert.deepEqual(getCommandDocument(context), {id: "doc", notebookId: "box", path: "/doc.sy"});
        assert.deepEqual(getCommandBlocks(context), [context.block]);
    });

    it("does not fall back to an editor when the file tree or dock owns focus", () => {
        const {context} = createEditorContext();
        for (const focus of ["fileTree", "dock", "global"] as const) {
            context.focus = focus;
            assert.equal(hasCommandEditorTarget(context), false);
            assert.equal(getCommandDocument(context), undefined);
        }
    });

    it("rejects detached, replaced, or cross-editor targets", () => {
        const {context, state, second} = createEditorContext();
        state.nodes = [second];
        assert.equal(hasCommandEditorTarget(context), false);
        state.nodes = [context.block.element, second];
        context.block.id = "replacement";
        assert.equal(hasCommandEditorTarget(context), false);
        context.block.id = "first";
        context.range = {startContainer: context.block.element, endContainer: {}} as unknown as Range;
        assert.equal(hasCommandEditorTarget(context), false);
    });

    it("requires the entire captured block selection to remain unchanged", () => {
        const {context, state, first, second} = createEditorContext();
        context.selectedBlocks = [{id: "first", element: first}, {id: "second", element: second}];
        state.selected = [first, second];
        assert.equal(hasCommandEditorTarget(context), true);
        assert.deepEqual(getCommandBlocks(context), context.selectedBlocks);
        state.selected = [first];
        assert.equal(hasCommandEditorTarget(context), false);
        context.selectedBlocks = [];
        assert.equal(hasCommandEditorTarget(context), false);
    });

    it("rejects an editor that has navigated to another document", () => {
        const {context} = createEditorContext();
        context.protyle.block.rootID = "other";
        assert.equal(hasCommandEditorTarget(context), false);
        assert.equal(getCommandDocument(context), undefined);
        context.protyle.block.rootID = "doc";
        context.protyle.path = "/moved/doc.sy";
        assert.equal(getCommandDocument(context), undefined);
    });

    it("uses only a single unchanged document tree item", () => {
        const {context} = createEditorContext();
        const attrs: Record<string, string> = {
            "data-type": "navigation-file", "data-node-id": "tree-doc",
            "data-path": "/tree-doc.sy", "data-notebook-id": "tree-box",
        };
        const item = {isConnected: true, getAttribute: (key: string) => attrs[key]} as unknown as HTMLElement;
        context.focus = "fileTree";
        context.fileTree = {elements: [item], ids: ["tree-doc"], paths: ["/tree-doc.sy"]};
        assert.deepEqual(getCommandDocument(context), {id: "tree-doc", path: "/tree-doc.sy", notebookId: "tree-box"});
        context.fileTree.elements.push(item);
        assert.equal(getCommandDocument(context), undefined);
        context.fileTree.elements.pop();
        attrs["data-path"] = "/moved.sy";
        assert.equal(getCommandDocument(context), undefined);
        attrs["data-path"] = "/tree-doc.sy";
        attrs["data-type"] = "navigation-root";
        assert.equal(getCommandDocument(context), undefined);
    });
});
