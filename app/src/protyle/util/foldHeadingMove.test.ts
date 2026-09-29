import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {transpileModule, ScriptTarget} from "typescript";
import {isFoldedHeading, shouldUnfoldMovedHeading} from "./foldHeadingMove";

class TestBlockElement {
    constructor(private attributes: Record<string, string>) {
    }

    getAttribute(name: string) {
        return this.attributes[name] ?? null;
    }
}

const asElement = (attributes: Record<string, string>) =>
    new TestBlockElement(attributes) as unknown as Element;

describe("folded heading moves", () => {
    const foldedHeading = asElement({"data-type": "NodeHeading", "data-subtype": "h2", fold: "1"});

    it("recognizes folded headings", () => {
        assert.equal(isFoldedHeading(foldedHeading), true);
        assert.equal(isFoldedHeading(asElement({"data-type": "NodeHeading", "data-subtype": "h2"})), false);
    });

    it("unfolds when the destination contributes a new heading child", () => {
        assert.equal(shouldUnfoldMovedHeading(foldedHeading, asElement({"data-type": "NodeParagraph"})), true);
        assert.equal(shouldUnfoldMovedHeading(
            foldedHeading,
            asElement({"data-type": "NodeHeading", "data-subtype": "h3"}),
        ), true);
    });

    it("preserves folding at a heading boundary or the end of a container", () => {
        assert.equal(shouldUnfoldMovedHeading(
            foldedHeading,
            asElement({"data-type": "NodeHeading", "data-subtype": "h2"}),
        ), false);
        assert.equal(shouldUnfoldMovedHeading(
            foldedHeading,
            asElement({"data-type": "NodeHeading", "data-subtype": "h1"}),
        ), false);
        assert.equal(shouldUnfoldMovedHeading(foldedHeading), false);
    });
});

it("unfolds the heading preceding a top drop before moved blocks replace that neighbor", async () => {
    const source = readFileSync(join(__dirname, "editorCommonEvent.ts"), "utf8");
    const body = source.slice(source.indexOf("const dragSame ="), source.indexOf("export const dropEvent ="));
    for (const isBottom of [false, true]) {
        const parent = {children: [] as Element[], classList: {contains: () => false}};
        const block = (id: string, type: string, folded = false) => ({
            getAttribute: (name: string) => ({"data-node-id": id, "data-type": type, fold: folded ? "1" : null}[name]),
            hasAttribute: (name: string) => name === "data-node-id",
            classList: {contains: () => false},
            closest: (): Element => null,
            parentElement: parent,
        }) as unknown as Element;
        const heading = block("heading", "NodeHeading", true);
        const target = block("target", "NodeHeading");
        const moving = block("moving", "NodeParagraph");
        parent.children = [heading, target, moving];
        let submitted: {doOperations: IOperation[], undoOperations: IOperation[]};
        const dependencies = {
            isDragTargetInSource: () => false,
            isSameSiblingMove: () => false,
            isSameDragEditor: () => true,
            isFoldedHeading,
            shouldUnfoldMovedHeading,
            getPreviousBlockSibling: (element: Element) => parent.children[parent.children.indexOf(element) - 1],
            getNextBlockSibling: (element: Element) => parent.children[parent.children.indexOf(element) + 1],
            moveTo: async () => {
                parent.children = [heading, moving, target];
                return {newSourceElements: [moving], doOperations: [{action: "move", id: "moving", previousID: "heading"}],
                    undoOperations: [{action: "move", id: "moving", previousID: "target"}]};
            },
            setFold: (_protyle: IProtyle, element: Element) => {
                assert.equal(element, heading);
                return {doOperations: [{action: "unfoldHeading", id: "heading"}],
                    undoOperations: [{action: "foldHeading", id: "heading"}]};
            },
            transaction: (_protyle: IProtyle, doOperations: IOperation[], undoOperations: IOperation[]) => {
                submitted = {doOperations, undoOperations};
            },
            document: {contains: () => true},
            focusBlock: (): void => undefined,
        };
        const dragSame = new Function(...Object.keys(dependencies), transpileModule(body, {
            compilerOptions: {target: ScriptTarget.ES2021},
        }).outputText + "\nreturn dragSame;")(...Object.values(dependencies));
        await dragSame({wysiwyg: {element: parent}}, [moving], isBottom ? heading : target, isBottom, false);
        assert.deepEqual(submitted.doOperations.map(operation => operation.action), ["move", "unfoldHeading"]);
        assert.deepEqual(submitted.undoOperations.map(operation => operation.action), ["move", "foldHeading"]);
        assert.equal(submitted.doOperations[1].context.focusId, "moving");
    }
});
