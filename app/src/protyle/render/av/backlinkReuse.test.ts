import * as assert from "node:assert/strict";
import {test} from "node:test";
import {captureBacklinkAVSources, reuseBacklinkAVSources} from "./backlinkReuse";
import type {IBacklinkAVTarget} from "./backlink";

class ElementStub {
    attributes = new Map<string, string>([["data-node-id", "block"], ["data-av-id", "database"], ["updated", "1"]]);
    dataset = {nodeId: "block"};
    isConnected = true;
    scrollTop = 0;
    scrollLeft = 0;
    children: ElementStub[] = [];
    replacement?: ElementStub;
    innerHTML = "<div></div>";

    get outerHTML() {
        return JSON.stringify([...this.attributes]) + this.innerHTML;
    }

    getAttribute(name: string) {
        return this.attributes.get(name) ?? null;
    }

    setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
    }

    removeAttribute(name: string) {
        this.attributes.delete(name);
    }

    matches() {
        return true;
    }

    querySelectorAll() {
        return this.children;
    }

    cloneNode() {
        const clone = new ElementStub();
        clone.attributes = new Map(this.attributes);
        clone.innerHTML = this.innerHTML;
        return clone;
    }

    replaceWith(element: ElementStub) {
        this.replacement = element;
        [element, ...element.children].forEach(item => {
            item.scrollTop = 0;
            item.scrollLeft = 0;
        });
    }
}

const targets: IBacklinkAVTarget[] = [{
    blockID: "block",
    matches: [{itemID: "item", keyID: "key", valueID: "value", title: "title", keyName: "key", defIDs: ["definition"]}],
}];

test("backlink refresh reuses rendered databases and restores nested scrolling", () => {
    const previousHTMLElement = globalThis.HTMLElement;
    globalThis.HTMLElement = ElementStub as unknown as typeof HTMLElement;
    try {
        const old = new ElementStub();
        const oldSources = captureBacklinkAVSources([old as unknown as Node], targets);
        old.setAttribute("data-render", "true");
        old.innerHTML = "rendered rows and selection";
        old.scrollTop = 480;
        const body = new ElementStub();
        body.scrollLeft = 200;
        old.children.push(body);
        const next = new ElementStub();
        next.setAttribute("updated", "2");
        const nodes = [next as unknown as Node];
        const sources = captureBacklinkAVSources(nodes, targets);
        const restore = reuseBacklinkAVSources(nodes, sources, oldSources);
        restore();
        assert.equal(nodes[0], old);
        assert.equal(sources.get("block").element, old);
        assert.equal(old.innerHTML, "rendered rows and selection");
        assert.equal(old.scrollTop, 480);
        assert.equal(body.scrollLeft, 200);
        assert.equal(old.getAttribute("updated"), "2");
    } finally {
        globalThis.HTMLElement = previousHTMLElement;
    }
});

test("changed configuration, targets, missing or unrendered copies are rendered afresh", () => {
    const previousHTMLElement = globalThis.HTMLElement;
    globalThis.HTMLElement = ElementStub as unknown as typeof HTMLElement;
    try {
        for (const change of ["database", "view", "content", "target", "detached", "unrendered", "missing"]) {
            const old = new ElementStub();
            const oldSources = captureBacklinkAVSources([old as unknown as Node], targets);
            old.setAttribute("data-render", "true");
            const next = new ElementStub();
            const nextTargets = JSON.parse(JSON.stringify(targets)) as IBacklinkAVTarget[];
            if (change === "database") {
                next.setAttribute("data-av-id", "other");
            } else if (change === "view") {
                next.setAttribute("custom-sy-av-view", "other");
            } else if (change === "content") {
                next.innerHTML = "changed attributes";
            } else if (change === "target") {
                nextTargets[0].matches[0].itemID = "other";
            } else if (change === "detached") {
                old.isConnected = false;
            } else if (change === "unrendered") {
                old.removeAttribute("data-render");
            } else {
                oldSources.clear();
            }
            const nodes = [next as unknown as Node];
            reuseBacklinkAVSources(nodes, captureBacklinkAVSources(nodes, nextTargets), oldSources)();
            assert.equal(nodes[0], next, change);
            assert.equal(next.replacement, undefined, change);
        }
    } finally {
        globalThis.HTMLElement = previousHTMLElement;
    }
});
