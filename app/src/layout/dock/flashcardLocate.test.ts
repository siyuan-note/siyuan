import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {transpileModule, ScriptTarget} from "typescript";
import {getFlashcardLocateBlockID, isCurrentFlashcardLocateTarget} from "../../card/flashcardLocate";

const element = (key = "review") => ({
    isConnected: true,
    classes: new Set<string>(),
    blockID: "block-a",
    get classList() { return {contains: (value: string) => this.classes.has(value)}; },
    getAttribute(name: string) { return name === "data-key" ? key : this.blockID; },
    querySelector: (): null => null,
});

const harness = () => {
    const first = element();
    const second = element();
    const makeWnd = (panel: ReturnType<typeof element>) => ({children: [{
        headElement: {classList: {contains: () => true}}, panelElement: panel,
    }]});
    const wnds = [makeWnd(first), makeWnd(second)];
    let active: number | undefined = 0;
    let recent = 0;
    let respond: (value: unknown) => void;
    let finishSelection: (() => void) | undefined;
    let delaySelection = false;
    const selections: unknown[] = [];
    let toggles = 0;
    const files = {
        element: {querySelector: () => "selected"}, lastSelectedElement: undefined as string | undefined,
        selectItem: async (...args: unknown[]) => {
            selections.push(args);
            if (delaySelection) {
                await new Promise<void>((resolve) => { finishSelection = resolve; });
            }
        },
    };
    const source = readFileSync("src/layout/dock/util.ts", "utf8");
    const start = source.indexOf("const getCurrentFlashcardElement =");
    assert.ok(start > 0);
    const script = transpileModule(source.slice(start).replace("export const selectOpenTab", "const selectOpenTab") +
        "\n({getCurrentFlashcardElement, selectOpenTab});", {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const api = runInNewContext(script, {
        Constants: {DIALOG_OPENCARD: "review"}, window: {siyuan: {dialogs: [], layout: {centerLayout: {}}}},
        document: {querySelector: () => active === undefined ? null : {getAttribute: () => String(active)}},
        getInstanceById: (id: string) => wnds[Number(id)], getWndByLayout: () => wnds[recent],
        getDockByType: () => ({data: {file: files}, toggleModel: () => { toggles++; active = undefined; }}),
        fetchSyncPost: () => new Promise((resolve) => { respond = resolve; }),
        getFlashcardLocateBlockID, isCurrentFlashcardLocateTarget,
    });
    return {api, first, second, wnds, selections, files,
        focus: (value?: number) => { active = value; }, recent: (value: number) => { recent = value; },
        resolve: (code = 0) => respond({code, data: code === 0 ? {box: "box", path: "/doc.sy"} : null}),
        toggles: () => toggles, delaySelection: () => { delaySelection = true; },
        finishSelection: () => finishSelection?.(),
    };
};

test("file dock focus resolves only the most recent window's selected tab and supports repeated locate", async () => {
    const h = harness();
    h.focus();
    h.recent(1);
    assert.equal(h.api.getCurrentFlashcardElement(), h.second);
    for (let index = 0; index < 2; index++) {
        const pending = h.api.selectOpenTab();
        h.resolve();
        await pending;
    }
    assert.equal(h.selections.length, 2);
    assert.equal(h.toggles(), 2);
    h.wnds[1].children[0].panelElement = element("editor");
    assert.equal(h.api.getCurrentFlashcardElement(), null);
    h.focus(0);
    assert.equal(h.api.getCurrentFlashcardElement(), h.first);
});

test("late locate rejects changed card, selected tab, active pane, closed panel and failed response", async () => {
    for (const change of ["card", "tab", "pane", "closed", "hidden", "failed"]) {
        const h = harness();
        const pending = h.api.selectOpenTab();
        if (change === "card") { h.first.blockID = "block-b"; }
        if (change === "tab") { h.wnds[0].children[0].panelElement = element("editor"); }
        if (change === "pane") { h.focus(1); }
        if (change === "closed") { h.first.isConnected = false; }
        if (change === "hidden") { h.first.classes.add("fn__none"); }
        h.resolve(change === "failed" ? -1 : 0);
        await pending;
        assert.equal(h.selections.length, 0, change);
        assert.equal(h.toggles(), 0, change);
    }
});

test("blank tabs are skipped and a window without a focused header has no review target", () => {
    const h = harness();
    const selected = h.wnds[0].children[0];
    Object.defineProperty(h.wnds[0], "children", {value: [
        {headElement: undefined, panelElement: element()}, selected,
    ]});
    assert.equal(h.api.getCurrentFlashcardElement(), h.first);
    selected.headElement.classList.contains = () => false;
    assert.equal(h.api.getCurrentFlashcardElement(), undefined);
});

test("changing target while tree selection loads does not reclaim panel focus", async () => {
    const h = harness();
    h.delaySelection();
    const pending = h.api.selectOpenTab();
    h.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(h.selections.length, 1);
    h.focus(1);
    h.finishSelection();
    await pending;
    assert.equal(h.toggles(), 0);
    assert.equal(h.files.lastSelectedElement, undefined);
});

test("file tree locate action leaves focus changes to the asynchronous locator", () => {
    const source = readFileSync("src/layout/dock/Files.ts", "utf8");
    const start = source.indexOf('} else if (type === "focus") {');
    const end = source.indexOf('} else if (type === "more")', start);
    assert.ok(start > 0 && end > start);
    assert.match(source.slice(start, end), /isFocus = false;\s+selectOpenTab\(\);/);
});
