import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    cloneCommandRange,
    collectCommandFileTreeMetadata,
    createCommandContextSnapshot,
    isBottomBacklinkEditorContext,
    resolveCommandFocus,
} from "./contextCore";
import type {ICommandContextSnapshot} from "./types";

describe("command context core", () => {
    it("clones a range exactly once", () => {
        let clones = 0;
        const snapshot = {value: "snapshot", cloneRange: () => snapshot};
        const source = {cloneRange: () => {
            clones++;
            return snapshot;
        }};

        assert.equal(cloneCommandRange(source), snapshot);
        assert.equal(clones, 1);
        assert.equal(cloneCommandRange(undefined), undefined);
    });

    it("uses the stable focus precedence", () => {
        const base = {
            explicitEditor: false,
            explicitFileTree: false,
            dialogEditor: false,
            fileTree: false,
            dock: false,
            editor: false,
        };

        assert.equal(resolveCommandFocus({...base, explicitEditor: true, fileTree: true}), "editor");
        assert.equal(resolveCommandFocus({...base, explicitFileTree: true, dialogEditor: true}), "fileTree");
        assert.equal(resolveCommandFocus({...base, dialogEditor: true, fileTree: true}), "editor");
        assert.equal(resolveCommandFocus({...base, fileTree: true, dock: true}), "fileTree");
        assert.equal(resolveCommandFocus({...base, dock: true, editor: true}), "dock");
        assert.equal(resolveCommandFocus({...base, editor: true}), "editor");
        assert.equal(resolveCommandFocus(base), "global");
    });

    it("collects stable file tree identifiers", () => {
        const elements = [
            {getAttribute: (name: string) => name === "data-node-id" ? "first" : "/first.sy"},
            {getAttribute: (name: string) => name === "data-node-id" ? null : "/second.sy"},
        ];

        assert.deepEqual(collectCommandFileTreeMetadata(elements), {
            ids: ["first"],
            paths: ["/first.sy", "/second.sy"],
        });
    });

    it("distinguishes a bottom backlink editor from its owner editor", () => {
        const ownerProtyle = {} as Element;
        const nestedProtyle = {} as Element;
        const bottomBacklink = {
            contains: (element: Node | null) => element === nestedProtyle,
        } as Pick<Element, "contains">;

        assert.equal(isBottomBacklinkEditorContext(bottomBacklink, ownerProtyle), false);
        assert.equal(isBottomBacklinkEditorContext(bottomBacklink, nestedProtyle), true);
        assert.equal(isBottomBacklinkEditorContext(bottomBacklink, false), false);
    });

    it("copies the resolved context collections into a snapshot", () => {
        const blockElement = {} as HTMLElement;
        const tableCellElement = {} as HTMLTableCellElement;
        const fileElement = {} as Element;
        const dockElement = {} as HTMLElement;
        const source: ICommandContextSnapshot = {
            app: {},
            source: "commandPanel",
            environment: "desktop",
            focus: "editor",
            range: {} as Range,
            protyle: {} as IProtyle,
            document: {id: "document", rootId: "root", notebookId: "notebook", path: "/document.sy"},
            block: {id: "block", element: blockElement},
            selectedBlocks: [{id: "selected", element: blockElement}],
            tableCell: {element: tableCellElement, row: 2, column: 3},
            fileTree: {model: {}, elements: [fileElement], ids: ["file"], paths: ["/file.sy"]},
            activeTab: {id: "tab", model: {}, element: dockElement},
            dock: {type: "outline", element: dockElement},
        };
        const snapshot = createCommandContextSnapshot(source);

        source.document.id = "changed";
        source.selectedBlocks.length = 0;
        source.fileTree.ids.length = 0;
        assert.equal(snapshot.document?.id, "document");
        assert.deepEqual(snapshot.selectedBlocks.map(item => item.id), ["selected"]);
        assert.deepEqual(snapshot.fileTree?.ids, ["file"]);
        assert.equal(snapshot.tableCell?.row, 2);
        assert.equal(snapshot.activeTab?.id, "tab");
        assert.equal(snapshot.dock?.type, "outline");
        assert.equal(snapshot.range, source.range);
    });
});
