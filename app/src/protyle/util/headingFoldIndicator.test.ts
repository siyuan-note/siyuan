import * as assert from "node:assert/strict";
import {afterEach, describe, it} from "node:test";
import {bindHeadingFoldIndicators, refreshHeadingFoldIndicators} from "./headingFoldIndicator";

class Heading {
    attributes = new Map<string, string>();
    constructor(id: string) {
        this.attributes.set("data-node-id", id);
        this.attributes.set("fold", "1");
    }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    hasAttribute(name: string) { return this.attributes.has(name); }
    querySelector(): Element | null { return null; }
}

const originalGlobals = ["window", "MutationObserver", "Element"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
afterEach(() => {
    originalGlobals.forEach(([key, descriptor]) => {
        if (descriptor) {
            Object.defineProperty(globalThis, key, descriptor);
        } else {
            Reflect.deleteProperty(globalThis, key);
        }
    });
});

const fixture = () => {
    const timers = new Map<number, () => void>();
    let timerID = 0;
    let onMutation: (records: any[]) => void;
    let disconnected = false;
    Object.assign(globalThis, {
        Element: Heading,
        window: {
            setTimeout: (callback: () => void) => { timers.set(++timerID, callback); return timerID; },
            clearTimeout: (id: number) => timers.delete(id),
        },
        MutationObserver: class {
            constructor(callback: typeof onMutation) { onMutation = callback; }
            observe() { /* 记录回调以模拟块结构变化。 */ }
            disconnect() { disconnected = true; }
        },
    });
    const headings = [new Heading("empty"), new Heading("full"), new Heading("empty")];
    const root = {
        isConnected: true,
        querySelectorAll: () => headings.filter(heading => heading.getAttribute("fold") === "1"),
        contains: (heading: Heading) => headings.includes(heading),
    };
    const protyle = {block: {rootID: "doc"}, notebookId: "notebook"} as IProtyle;
    const requests: {ids: string[], notebook: string, done: (info: any) => void}[] = [];
    const dispose = bindHeadingFoldIndicators(protyle, root as unknown as HTMLElement, (ids, notebook, done) => {
        requests.push({ids, notebook, done});
    });
    const flush = () => {
        const callbacks = Array.from(timers.values());
        timers.clear();
        callbacks.forEach(callback => callback());
    };
    return {headings, root, protyle, requests, dispose, flush, mutate: (records: any[]) => onMutation(records),
        disconnected: () => disconnected};
};

describe("heading fold indicators", () => {
    it("uses authoritative children instead of the visible sibling layout and preserves folding", () => {
        const f = fixture();
        f.flush();
        assert.deepEqual(f.requests[0].ids, ["empty", "full"]);
        assert.equal(f.requests[0].notebook, "notebook");
        f.requests[0].done({empty: {headingChildren: false}, full: {headingChildren: true}});
        assert.equal(f.headings[0].getAttribute("data-heading-empty"), "true");
        assert.equal(f.headings[2].getAttribute("data-heading-empty"), "true");
        assert.equal(f.headings[1].getAttribute("data-heading-empty"), null);
        assert.ok(f.headings.every(heading => heading.getAttribute("fold") === "1"));
        f.dispose();
    });

    it("refreshes after transactions and removes the empty marker when children are added", () => {
        const f = fixture();
        f.flush();
        f.requests[0].done({empty: {headingChildren: false}});
        refreshHeadingFoldIndicators(f.protyle);
        refreshHeadingFoldIndicators(f.protyle);
        f.flush();
        assert.equal(f.requests.length, 2);
        f.requests[1].done({empty: {headingChildren: true}});
        assert.equal(f.headings[0].getAttribute("data-heading-empty"), null);
        f.dispose();
    });

    it("ignores obsolete responses, replaced headings and a changed document", () => {
        const f = fixture();
        f.flush();
        refreshHeadingFoldIndicators(f.protyle);
        f.requests[0].done({empty: {headingChildren: false}});
        assert.equal(f.headings[0].getAttribute("data-heading-empty"), null);
        f.flush();
        const removed = f.headings.shift();
        f.protyle.block.rootID = "other";
        f.requests[1].done({empty: {headingChildren: false}});
        assert.equal(removed.getAttribute("data-heading-empty"), null);
        assert.equal(f.headings[1].getAttribute("data-heading-empty"), null);
        f.dispose();
    });

    it("does not infer emptiness from failures, missing fields or unfolded headings", () => {
        const f = fixture();
        f.flush();
        f.requests[0].done(null);
        assert.equal(f.headings[0].getAttribute("data-heading-empty"), null);
        f.headings[0].setAttribute("data-heading-empty", "true");
        f.headings[1].removeAttribute("fold");
        f.requests[0].done({empty: {}, full: {headingChildren: false}});
        assert.equal(f.headings[0].getAttribute("data-heading-empty"), null);
        assert.equal(f.headings[1].getAttribute("data-heading-empty"), null);
        f.dispose();
    });

    it("observes block changes, skips inline changes, and disposes pending work", () => {
        const f = fixture();
        f.flush();
        f.mutate([{type: "childList", addedNodes: [{}], removedNodes: []}]);
        f.flush();
        assert.equal(f.requests.length, 1);
        f.mutate([{type: "childList", addedNodes: [new Heading("new")], removedNodes: []}]);
        f.flush();
        assert.equal(f.requests.length, 2);
        f.mutate([{type: "attributes"}]);
        f.dispose();
        f.flush();
        f.requests[1].done({empty: {headingChildren: false}});
        assert.equal(f.requests.length, 2);
        assert.equal(f.headings[0].getAttribute("data-heading-empty"), null);
        assert.equal(f.disconnected(), true);
    });
});
