import {before, describe, it} from "node:test";
import * as assert from "node:assert/strict";

let isBlockRefDropTargetDisabled: typeof import("./blockRefDrop").isBlockRefDropTargetDisabled;

before(async () => {
    Object.assign(globalThis, {NODE_ENV: "test", SIYUAN_VERSION: ""});
    ({isBlockRefDropTargetDisabled} = await import("./blockRefDrop"));
});

const createElement = (type?: string, parentElement: Element = null, classNames: string[] = []) => ({
    nodeType: 1,
    tagName: "DIV",
    parentElement,
    classList: {
        contains: (className: string) => classNames.includes(className),
    },
    getAttribute: (name: string) => name === "data-node-id" && type?.startsWith("Node") ? "block-id" :
        (name === "data-type" ? type || null : null),
    hasAttribute: (name: string) => name === "data-node-id" && Boolean(type?.startsWith("Node")),
    querySelectorAll: (): Element[] => [],
}) as unknown as Element;

const createTextNode = (parentElement: Element) => ({
    nodeType: 3,
    parentElement,
}) as unknown as Node;

describe("isBlockRefDropTargetDisabled", () => {
    it("rejects content in non-editable blocks", () => {
        [
            "NodeMathBlock",
            "NodeHTMLBlock",
            "NodeThematicBreak",
            "NodeIFrame",
            "NodeWidget",
            "NodeVideo",
            "NodeAudio",
        ].forEach(type => {
            const blockElement = createElement(type);
            assert.equal(isBlockRefDropTargetDisabled([createElement(undefined, blockElement)]), true);
        });
        const renderedCodeBlock = createElement("NodeCodeBlock", null, ["render-node"]);
        assert.equal(isBlockRefDropTargetDisabled([createElement(undefined, renderedCodeBlock)]), true);
    });

    it("rejects editable render results inside a query embed", () => {
        const queryEmbed = createElement("NodeBlockQueryEmbed");
        const paragraph = createElement("NodeParagraph", queryEmbed);

        assert.equal(isBlockRefDropTargetDisabled([createTextNode(paragraph)]), true);
    });

    it("rejects rendered content inside inline math", () => {
        const paragraph = createElement("NodeParagraph");
        const inlineMath = createElement("inline-math", paragraph);
        const renderedContent = createElement(undefined, inlineMath);

        assert.equal(isBlockRefDropTargetDisabled([renderedContent]), true);
    });

    it("allows editable paragraph content", () => {
        const paragraph = createElement("NodeParagraph");

        assert.equal(isBlockRefDropTargetDisabled([createTextNode(paragraph)]), false);
    });

    it("ignores missing targets", () => {
        assert.equal(isBlockRefDropTargetDisabled([null, undefined]), false);
    });
});
