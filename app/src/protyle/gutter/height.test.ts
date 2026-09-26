import * as assert from "node:assert/strict";
import test from "node:test";

test("height controls preserve each block's storage target and clear legacy iframe height", async () => {
    const globals = ["SIYUAN_VERSION", "NODE_ENV"].map(name => ({name,
        descriptor: Object.getOwnPropertyDescriptor(globalThis, name)}));
    globals.forEach(({name}) => Object.defineProperty(globalThis, name, {configurable: true, value: "test"}));
    try {
        const {getBlockHeightTarget, setBlockHeight} = await import("./height");
        for (const type of ["NodeCodeBlock", "NodeMindmap", "NodeIFrame", "NodeWidget", "NodeVideo"]) {
            const media = {style: {height: "320px", width: "640px"}, removeAttribute: (): void => undefined};
            const block = {dataset: {type}, style: {height: "", maxHeight: ""},
                querySelector: (selector: string) => ["iframe", "video"].includes(selector) ? media : null} as unknown as HTMLElement;
            setBlockHeight(block, "50vh");
            const target = getBlockHeightTarget(block);
            assert.equal(target.element.style[target.property], "50vh", type);
            assert.equal(target.element, type === "NodeVideo" ? media : block);
            assert.equal(target.property, type === "NodeCodeBlock" ? "maxHeight" : "height");
            assert.equal(media.style.width, "640px");
            if (["NodeIFrame", "NodeWidget"].includes(type)) {
                assert.equal(media.style.height, "");
            }
            setBlockHeight(block, "");
            assert.equal(target.element.style[target.property], "");
        }
        for (const type of ["NodeParagraph", "NodeAudio", "NodeTable"]) {
            assert.equal(getBlockHeightTarget({dataset: {type}} as unknown as HTMLElement), undefined);
        }
        assert.equal(getBlockHeightTarget({dataset: {type: "NodeCodeBlock", subtype: "mermaid"}} as unknown as HTMLElement), undefined);
        assert.equal(getBlockHeightTarget({dataset: {type: "NodeCodeBlock", subtype: "echarts"}} as unknown as HTMLElement).property, "height");
    } finally {
        globals.forEach(({name, descriptor}) => {
            if (descriptor) {
                Object.defineProperty(globalThis, name, descriptor);
            } else {
                Reflect.deleteProperty(globalThis, name);
            }
        });
    }
});
