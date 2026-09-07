import {before, describe, it} from "node:test";
import * as assert from "node:assert/strict";

let getHostVerticalTitleRegion: typeof import("./verticalRegion").getHostVerticalTitleRegion;

before(async () => {
    Object.assign(globalThis, {SIYUAN_VERSION: "test", NODE_ENV: "test"});
    ({getHostVerticalTitleRegion} = await import("./verticalRegion"));
});

class RegionElement {
    nodeType = 1;
    parentElement: RegionElement | null = null;
    title: RegionElement | null = null;
    content: RegionElement | null = null;
    constructor(private className: string) {}
    classList = {contains: (name: string) => this.className === name};
    querySelector(selector: string) {
        return selector.includes("title") ? this.title : this.content;
    }
    contains(node: RegionElement): boolean {
        return node === this || !!node.parentElement && this.contains(node.parentElement);
    }
}

const region = (name: string, parent?: RegionElement) => {
    const owner = new RegionElement(name);
    owner.parentElement = parent || null;
    owner.title = new RegionElement("callout-title");
    owner.title.parentElement = owner;
    owner.content = new RegionElement("content");
    owner.content.parentElement = owner;
    return owner;
};

describe("host vertical title ownership", () => {
    it("resolves each host title independently of shared title styling", () => {
        for (const name of ["callout", "tab-item", "av"]) {
            const owner = region(name);
            assert.equal(getHostVerticalTitleRegion(owner.title as unknown as Node)?.owner, owner);
        }
    });

    it("uses the tab item instead of an enclosing callout", () => {
        const callout = region("callout");
        const tab = region("tab-item", callout.content);
        assert.equal(getHostVerticalTitleRegion(tab.title as unknown as Node)?.owner, tab);
    });

    it("resolves a title through its paragraph wrapper and formatted text", () => {
        const tab = region("tab-item");
        const wrapper = new RegionElement("p");
        wrapper.parentElement = tab;
        tab.title.parentElement = wrapper;
        const text = {nodeType: 3, parentElement: tab.title};
        assert.equal(getHostVerticalTitleRegion(text as unknown as Node)?.owner, tab);
    });

    it("does not treat body content as a title", () => {
        const tab = region("tab-item", region("callout").content);
        assert.equal(getHostVerticalTitleRegion(tab.content as unknown as Node), undefined);
    });
});
