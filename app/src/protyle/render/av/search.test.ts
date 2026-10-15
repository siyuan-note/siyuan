import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const setup = (text = "before after") => {
    type TText = {textContent: string};
    const restored: unknown[][] = [];
    const selection = {
        rangeCount: 1,
        anchorNode: null as unknown,
        anchorOffset: 0,
        focusNode: null as unknown,
        focusOffset: 0,
        setBaseAndExtent(...args: unknown[]) { restored.push(args); },
    };
    const document = {
        activeElement: null as unknown,
        createRange: () => {
            let input: ReturnType<typeof createInput>;
            let end: unknown;
            let offset = 0;
            return {
                selectNodeContents(element: typeof input) { input = element; },
                setEnd(node: unknown, position: number) { end = node; offset = position; },
                toString: () => end === input ? input.childNodes.slice(0, offset).map(node => node.textContent).join("") :
                    input.childNodes.slice(0, input.childNodes.indexOf(end as TText)).map(node => node.textContent).join("") +
                    (end as TText).textContent.slice(0, offset),
            };
        },
    };
    const createInput = () => {
        const handlers: Record<string, (event: unknown) => void> = {};
        return {
            handlers,
            childNodes: [] as TText[],
            isConnected: true,
            style: {},
            get textContent(): string { return this.childNodes.map((node: TText) => node.textContent).join(""); },
            set textContent(value: string) { this.childNodes = value ? [{textContent: value}] : []; },
            get firstChild() { return this.childNodes[0] || null; },
            contains(node: unknown): boolean { return node === this || this.childNodes.includes(node as TText); },
            focus() { document.activeElement = this; },
            addEventListener(type: string, handler: (event: unknown) => void) { handlers[type] = handler; },
        };
    };
    let input = createInput();
    let changed = 0;
    const timers: (() => void)[] = [];
    const modules: Record<string, unknown> = {
        "../../../util/addClearButton": {addClearButton() {}},
        "../../util/selection": {focusBlock() {}},
        "../../undo": {electronUndo() {}},
    };
    const api = {} as typeof import("./search");
    runInNewContext(transpileModule(readFileSync(join(__dirname, "search.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText, {
        exports: api, require: (name: string) => modules[name] || {}, document,
        getSelection: () => selection, setTimeout: (callback: () => void) => timers.push(callback),
    });
    const blockElement = {querySelector: (selector: string) => selector === ".av__views" ?
        {classList: {add() {}, remove() {}}} : input} as unknown as HTMLElement;
    const bind = (query: string, isSearching = true, saved?: ReturnType<typeof api.captureAvSearchSelection>) => {
        api.bindAvSearch({blockElement, query, isSearching, selection: saved, onChange: () => changed++});
    };
    const replace = () => {
        const query = input.textContent;
        const isSearching = document.activeElement === input;
        const saved = api.captureAvSearchSelection(input as unknown as HTMLElement);
        input.isConnected = false;
        input = createInput();
        bind(query, isSearching, saved);
    };
    bind(text);
    const select = (anchor: unknown, anchorOffset: number, focus = anchor, focusOffset = anchorOffset) => {
        Object.assign(selection, {anchorNode: anchor, anchorOffset, focusNode: focus, focusOffset});
    };
    const dispatch = (name: string, isComposing = false) => input.handlers[name]({isComposing, stopPropagation() {}});
    return {api, bind, replace, select, dispatch, restored, document, selection, timers,
        input: () => input, changed: () => changed};
};

test("database search restores beginning, middle, end and directional selections after replacement", () => {
    for (const [anchor, focus] of [[0, 0], [7, 7], [12, 12], [2, 9], [9, 2]]) {
        const f = setup();
        f.select(f.input().firstChild, anchor, f.input().firstChild, focus);
        f.replace();
        assert.deepEqual(f.restored, [[f.input().firstChild, anchor, f.input().firstChild, focus]]);
        assert.equal(f.document.activeElement, f.input());
        assert.equal(f.input().textContent, "before after");
    }
});

test("database search captures split text, Unicode, element boundaries and an empty query", () => {
    const f = setup();
    f.input().childNodes = [{textContent: "前😀"}, {textContent: "选中后"}];
    f.select(f.input().childNodes[1], 2, f.input().childNodes[0], 1);
    f.replace();
    assert.deepEqual(f.restored.pop(), [f.input().firstChild, 5, f.input().firstChild, 1]);
    f.input().childNodes = [{textContent: "前😀"}, {textContent: "后"}];
    f.select(f.input(), 1);
    f.replace();
    assert.deepEqual(f.restored.pop(), [f.input().firstChild, 3, f.input().firstChild, 3]);
    f.input().textContent = "";
    f.select(f.input(), 0);
    f.replace();
    assert.deepEqual(f.restored.pop(), [f.input(), 0, f.input(), 0]);
});

test("database search does not capture an outside selection or restore focus after blur", () => {
    const f = setup();
    f.select(f.input().firstChild, 2, {}, 0);
    assert.equal(f.api.captureAvSearchSelection(f.input() as unknown as HTMLElement), undefined);
    f.select(f.input().firstChild, 2);
    f.selection.rangeCount = 0;
    assert.equal(f.api.captureAvSearchSelection(f.input() as unknown as HTMLElement), undefined);
    f.selection.rangeCount = 1;
    const outside = {};
    f.document.activeElement = outside;
    f.replace();
    assert.equal(f.document.activeElement, outside);
    assert.deepEqual(f.restored, []);
});

test("database search defers the latest render until composition and its final input finish", () => {
    const f = setup("前后");
    const original = f.input();
    let rendered = "";
    f.dispatch("compositionstart");
    for (const composing of [true, false]) {
        f.dispatch("input", composing);
    }
    assert.equal(f.changed(), 0);
    assert.equal(f.api.deferAvSearchRender(original as unknown as HTMLElement, () => { rendered = "old"; }), true);
    assert.equal(f.api.deferAvSearchRender(original as unknown as HTMLElement, () => {
        rendered = "latest";
        f.replace();
    }), true);
    original.textContent = "前你好后";
    f.dispatch("compositionend");
    assert.equal(f.changed(), 1);
    assert.equal(rendered, "");
    assert.equal(f.input(), original);
    f.select(original.firstChild, 3);
    f.dispatch("input");
    f.timers.shift()();
    assert.equal(rendered, "latest");
    assert.equal(f.input().textContent, "前你好后");
    assert.deepEqual(f.restored, [[f.input().firstChild, 3, f.input().firstChild, 3]]);
    assert.equal(f.api.deferAvSearchRender(f.input() as unknown as HTMLElement, () => {}), false);
});

test("database search cancels a deferred render when its input has already been replaced or removed", () => {
    const f = setup();
    let rendered = false;
    f.dispatch("compositionstart");
    f.api.deferAvSearchRender(f.input() as unknown as HTMLElement, () => { rendered = true; });
    f.dispatch("compositionend");
    f.input().isConnected = false;
    f.timers.shift()();
    assert.equal(rendered, false);
});
