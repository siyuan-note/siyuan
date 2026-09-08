import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {isContainerGutterBridge} from "./container";

const setup = (type = "NodeBlockquote") => {
    const block = {
        getBoundingClientRect: () => ({left: 140, top: 100, bottom: 150}),
    } as Element;
    const container = {
        dataset: {type},
        contains: (element: Element) => element === block,
    } as unknown as HTMLElement;
    const button = {dataset: {type: "NodeParagraph"}} as unknown as HTMLElement;
    const gutter = {
        classList: {contains: () => false},
        getBoundingClientRect: () => ({left: 100, top: 110, bottom: 134}),
        querySelectorAll: () => [button],
    } as unknown as HTMLElement;
    const target = {closest: (): HTMLElement => null} as unknown as HTMLElement;
    const hit = (x = 130, y = 120, currentBlock = block) =>
        isContainerGutterBridge(gutter, container, target, x, y, () => currentBlock);
    return {block, container, button, gutter, target, hit};
};

describe("isContainerGutterBridge", () => {
    it("preserves a child gutter while crossing nested container padding", () => {
        ["NodeBlockquote", "NodeCallout", "NodeSuperBlock"].forEach(type => {
            assert.equal(setup(type).hit(), true);
        });
    });

    it("does not retain a gutter outside the path to its block", () => {
        const {hit} = setup();
        [[99, 120], [141, 120], [130, 99], [130, 151]].forEach(([x, y]) => {
            assert.equal(hit(x, y), false);
        });
    });

    it("allows switching to unrelated blocks and the container itself", () => {
        const {hit, container} = setup();
        assert.equal(hit(130, 120, {} as Element), false);
        assert.equal(hit(130, 120, container), false);
        assert.equal(hit(130, 120, null), false);
        assert.equal(setup("NodeParagraph").hit(), false);
    });

    it("does not restore hidden gutters or use folding controls as anchors", () => {
        const hidden = setup();
        hidden.gutter.classList.contains = () => true;
        assert.equal(hidden.hit(), false);
        const fold = setup();
        fold.button.dataset.type = "fold";
        assert.equal(fold.hit(), false);
    });

    it("keeps callout titles directly accessible", () => {
        const {target, hit} = setup("NodeCallout");
        target.closest = () => ({} as HTMLElement);
        assert.equal(hit(), false);
    });
});
