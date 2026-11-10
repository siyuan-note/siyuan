import * as assert from "node:assert/strict";
import {test} from "node:test";
import {HistoryGroups} from "./historyGroups";

class ElementStub {
    classes = new Set<string>();
    classList = {
        add: (name: string) => this.classes.add(name),
        contains: (name: string) => this.classes.has(name),
        toggle: (name: string, force?: boolean) => {
            const present = force ?? !this.classes.has(name);
            if (present) this.classes.add(name); else this.classes.delete(name);
            return present;
        },
    };
    dataset = {created: "123"};
    isConnected = true;
    textContent = "";
    disabled = false;
    className = "";
    type = "";
    children: ElementStub[] = [];
    inserted: string[] = [];
    afterElement: ElementStub;
    listeners = new Map<string, () => void>();
    top = 1000;
    bottom = 1032;
    addEventListener(name: string, listener: () => void) { this.listeners.set(name, listener); }
    removeEventListener(name: string) { this.listeners.delete(name); }
    append(child: ElementStub) { this.children.push(child); }
    after(child: ElementStub) { this.afterElement = child; }
    querySelector() { return this; }
    insertAdjacentHTML(_position: string, html: string) { this.inserted.push(html); }
    getBoundingClientRect() { return {top: this.top, bottom: this.bottom}; }
    getClientRects() { return [{}]; }
}

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const setup = (loader?: ConstructorParameters<typeof HistoryGroups>[2]["load"]) => {
    const root = new ElementStub();
    root.top = 0;
    root.bottom = 300;
    const row = new ElementStub();
    const calls: {page: number, created: string, op?: string}[] = [];
    const groups = new HistoryGroups(root as unknown as HTMLElement, {op: "delete", type: 0}, {
        more: "More", retry: "Retry",
        render: items => items.map(item => item.id).join(","),
        load: loader || (async request => {
            calls.push(request);
            return {items: Array.from({length: Math.min(32, 100 - (request.page - 1) * 32)}, (_, i) => ({
                id: String((request.page - 1) * 32 + i), title: "", notebook: "", path: "", op: "delete",
            })), totalCount: 100, pageCount: 4};
        }),
    });
    return {root, row, groups, calls};
};

test("history groups scroll through 100 items without duplicates and reuse collapsed pages", async () => {
    const original = globalThis.document;
    globalThis.document = {createElement: () => new ElementStub()} as unknown as Document;
    try {
        const {root, row, groups, calls} = setup();
        groups.toggle(row as unknown as HTMLElement);
        groups.toggle(row as unknown as HTMLElement);
        await tick();
        assert.equal(calls.length, 1);
        groups.toggle(row as unknown as HTMLElement);
        assert.equal(calls.length, 1);
        const tail = row.afterElement.children[0];
        tail.top = 280;
        tail.bottom = 310;
        root.listeners.get("scroll")();
        root.listeners.get("scroll")();
        await tick();
        assert.deepEqual(calls.map(call => call.page), [1, 2, 3, 4]);
        assert.ok(calls.every(call => call.created === "123" && call.op === "delete"));
        assert.deepEqual(tail.inserted.join(",").split(","), Array.from({length: 100}, (_, i) => String(i)));
        assert.equal(row.textContent, "100");
        assert.equal(tail.classList.contains("fn__none"), true);
        groups.destroy();
        assert.equal(root.listeners.has("scroll"), false);
    } finally {
        globalThis.document = original;
    }
});

test("history requests are ignored after filter reset or dialog close", async () => {
    const original = globalThis.document;
    globalThis.document = {createElement: () => new ElementStub()} as unknown as Document;
    try {
        let finish: (value: {items: [], totalCount: number, pageCount: number}) => void;
        let signal: AbortSignal;
        const {row, groups} = setup((_request, abort) => {
            signal = abort;
            return new Promise(resolve => { finish = resolve; });
        });
        groups.toggle(row as unknown as HTMLElement);
        const tail = row.afterElement.children[0];
        groups.destroy();
        assert.equal(signal.aborted, true);
        finish({items: [], totalCount: 0, pageCount: 0});
        await tick();
        assert.deepEqual(tail.inserted, []);
    } finally {
        globalThis.document = original;
    }
});

test("failed history pages stop automatic retries and reopen retries the same page", async () => {
    const original = globalThis.document;
    globalThis.document = {createElement: () => new ElementStub()} as unknown as Document;
    try {
        const pages: number[] = [];
        const {root, row, groups} = setup(async request => {
            pages.push(request.page);
            if (pages.length === 1) throw new Error("offline");
            return {items: [], totalCount: 0, pageCount: 0};
        });
        groups.toggle(row as unknown as HTMLElement);
        await tick();
        const tail = row.afterElement.children[0];
        assert.equal(tail.children[0].textContent, "Retry");
        root.listeners.get("scroll")();
        assert.deepEqual(pages, [1]);
        groups.toggle(row as unknown as HTMLElement);
        groups.toggle(row as unknown as HTMLElement);
        await tick();
        assert.deepEqual(pages, [1, 1]);
        groups.destroy();
    } finally {
        globalThis.document = original;
    }
});
