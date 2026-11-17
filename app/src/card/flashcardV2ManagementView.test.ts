import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {FlashcardV2ManagementView} from "./flashcardV2ManagementView";

const surface = (inside = true) => {
    let focused = "";
    const list = {scrollTop: 140, focus: () => { focused = "list"; }};
    const row = {dataset: {id: "card-a"}};
    const action = {dataset: {type: "suspend"}, closest: () => row,
        matches: () => false, focus: () => { focused = "suspend"; }};
    const element = {ownerDocument: {activeElement: action}, contains: () => inside,
        querySelector: () => list, querySelectorAll: () => [action]};
    return {element: element as unknown as HTMLElement, list, focused: () => focused};
};

test("pending-edit entry keeps a stable management title while retaining its initial filter", () => {
    const source = readFileSync("src/card/flashcardV2.ts", "utf8");
    const snippet = source.slice(source.indexOf("export const openFlashcardV2PendingEdits ="),
        source.indexOf("export const openFlashcardV2ManagementByNotebook =")).replace("export const", "const");
    let args: unknown[];
    runInNewContext(transpileModule(`${snippet}\nopenFlashcardV2PendingEdits();`, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {
        window: {siyuan: {languages: {manage: "Manage", flashcardPendingEdits: "Pending edits"}}},
        ensureFlashcardV2: (callback: () => void) => callback(),
        openFlashcardV2ReviewSetCards: (...values: unknown[]) => { args = values; },
    });
    assert.equal(args[1], "Manage");
    assert.equal((args[3] as {editLater: string}).editLater, "true");
    assert.equal(args[5], false);
});

test("batch labels distinguish configuration steps from direct actions", () => {
    const source = readFileSync("src/card/flashcardV2.ts", "utf8");
    const start = source.indexOf("batchApply.textContent =");
    const snippet = source.slice(start, source.indexOf(";", start) + 1);
    for (const reviewSetID of ["", "set"]) {
        for (const batchAction of ["", "tags", "setDue", "membership", "suspend", "reset", "setFlag:1"]) {
            const batchApply = {textContent: ""};
            runInNewContext(snippet, {batchApply, batchAction, reviewSetID,
                window: {siyuan: {languages: {next: "Next", confirm: "Confirm"}}}});
            const configures = ["tags", "setDue"].includes(batchAction) ||
                (batchAction === "membership" && reviewSetID === "");
            assert.equal(batchApply.textContent, configures ? "Next" : "Confirm");
        }
    }
});

test("new requests invalidate older responses and closure permanently prevents revival", () => {
    const view = new FlashcardV2ManagementView();
    const first = view.request();
    assert.ok(first());
    const retry = view.request();
    assert.equal(first(), false);
    assert.ok(retry());
    const listener = view.bind();
    view.close();
    assert.ok(listener.signal.aborted);
    assert.equal(retry(), false);
    assert.equal(view.request()(), false);
});

test("rebinding replaces old listeners while failed requests leave the current page interactive", () => {
    const view = new FlashcardV2ManagementView();
    const first = view.bind();
    view.request();
    view.request();
    assert.equal(first.signal.aborted, false);
    const second = view.bind();
    assert.ok(first.signal.aborted);
    assert.equal(second.signal.aborted, false);
});

test("an older mutation refreshes the latest navigation intent, including after a failed request", () => {
    const view = new FlashcardV2ManagementView();
    const calls: string[] = [];
    view.request(() => calls.push("old-page"));
    const finishOldMutation = () => view.refresh();
    view.request(() => calls.push("new-page-and-filter"));
    finishOldMutation();
    view.refresh();
    assert.deepEqual(calls, ["new-page-and-filter", "new-page-and-filter"]);
    view.setRefresh(() => calls.push("preserve-rendered-page"));
    const oldListener = view.bind();
    view.bind();
    assert.ok(oldListener.signal.aborted);
    finishOldMutation();
    assert.equal(calls.at(-1), "preserve-rendered-page");
    view.close();
    view.refresh();
    assert.equal(calls.length, 3);
});

test("same-page refresh preserves surviving selections, scroll and the exact card action", () => {
    const view = new FlashcardV2ManagementView();
    const ui = surface();
    view.selected.add("card-a");
    view.selected.add("removed");
    view.capture(ui.element, true);
    view.reconcile(["card-a", "card-b"]);
    ui.list.scrollTop = 0;
    view.restore(ui.element);
    assert.deepEqual([...view.selected], ["card-a"]);
    assert.equal(ui.list.scrollTop, 140);
    assert.equal(ui.focused(), "suspend");
});

test("changing page or filter clears page selection and returns to the top", () => {
    const view = new FlashcardV2ManagementView();
    const ui = surface();
    view.selected.add("card-a");
    view.capture(ui.element, false);
    view.restore(ui.element);
    assert.equal(view.selected.size, 0);
    assert.equal(ui.list.scrollTop, 0);
    assert.equal(ui.focused(), "list");
});

test("refresh does not steal focus from another dialog", () => {
    const view = new FlashcardV2ManagementView();
    const ui = surface(false);
    view.capture(ui.element, true);
    view.restore(ui.element);
    assert.equal(ui.focused(), "");
});

test("management reuses its dialog and keeps grouped actions behind the explicit apply step", () => {
    const source = readFileSync("src/card/flashcardV2.ts", "utf8");
    const management = source.slice(source.indexOf("const openFlashcardV2ReviewSetCards ="),
        source.indexOf("export const openFlashcardV2Management ="));
    const studyStart = management.indexOf('if (type === "study")');
    const studyEnd = management.indexOf('if (type === "pagePrevious"', studyStart);
    assert.ok(studyStart >= 0 && studyEnd > studyStart);
    // Opening a review tab may close the source modal; ordinary refresh still reuses it.
    assert.doesNotMatch(management.slice(0, studyStart) + management.slice(studyEnd), /dialog\.destroy\(\)/);
    assert.match(management, /owner\.dialog\.element\.querySelector\("\.card__v2-management"\)\.outerHTML = content/);
    assert.match(management, /if \(!isCurrent\(\)\) \{ return; \}/);
    const reload = management.slice(management.indexOf("const reloadPage ="),
        management.indexOf("owner.membershipSubmission ||=", management.indexOf("const reloadPage =")));
    assert.match(reload, /owner\.view\.refresh\(\)/);
    assert.doesNotMatch(reload, /signal\.aborted/);
    assert.doesNotMatch(management, /<select data-type="batchAction"/);
    assert.match(management, /label: lang\.flashcardReviewState, submenu:/);
    assert.match(management, /label: lang\.flashcardPreset, submenu:/);
    assert.match(management, /if \(action === "reset"\) \{\s*confirmDialog\(window\.siyuan\.languages\.reset,/);
});

test("batch reset waits for confirmation and only submits cards selected on the current page", () => {
    const source = readFileSync("src/card/flashcardV2.ts", "utf8");
    const start = source.indexOf('if (type === "batchApply")');
    const end = source.indexOf("                if (!item)", start);
    const script = transpileModule(`(() => {${source.slice(start, end)}})();`, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    let confirm: () => void;
    const requests: unknown[] = [];
    runInNewContext(script, {
        type: "batchApply", batchAction: "reset",
        selectedCardIDs: new Set(["selected", "not-on-page"]),
        cards: [{card: {id: "selected"}}, {card: {id: "not-selected"}}],
        window: {siyuan: {languages: {reset: "Reset", resetCardTip: "Reset ${x}"}}},
        genUUID: () => "operation", reloadPage: (): void => {},
        confirmDialog: (_title: string, message: string, callback: () => void) => {
            assert.equal(message, "Reset 1");
            confirm = callback;
        },
        fetchPost: (_url: string, payload: unknown) => { requests.push(payload); },
    });
    assert.equal(requests.length, 0);
    assert.ok(confirm);
    confirm();
    assert.equal(requests.length, 1);
    const request = requests[0] as {cardIDs: string[], action: string};
    assert.deepEqual(Array.from(request.cardIDs), ["selected"]);
    assert.equal(request.action, "reset");
});

test("an open batch menu cannot mutate controls after its page has been replaced", () => {
    const source = readFileSync("src/card/flashcardV2.ts", "utf8");
    const start = source.indexOf("const option = (value: string, label: string): IMenu");
    const end = source.indexOf("                    toggleMenu(", start);
    const script = transpileModule(`let batchAction = ""; ${source.slice(start, end)}\noption("reset", "Reset");`, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const controller = new AbortController();
    const target = {textContent: "Manage"};
    let refreshes = 0;
    const option = runInNewContext(script, {
        target, listenerOptions: {signal: controller.signal},
        refreshSelection: () => { refreshes++; },
    }) as {click: () => void};
    controller.abort();
    option.click();
    assert.equal(target.textContent, "Manage");
    assert.equal(refreshes, 0);
});


test("notebook entry keeps its initial scope but uses the stable management title", () => {
    const source = readFileSync("src/card/flashcardV2.ts", "utf8");
    const snippet = source.slice(source.indexOf("export const openFlashcardV2ManagementByNotebook ="),
        source.indexOf("export const openFlashcardV2ManagementByBlocks =")).replace("export const", "const");
    let args: unknown[];
    runInNewContext(transpileModule(`${snippet}\nopenFlashcardV2ManagementByNotebook("notebook-a");`, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {
        window: {siyuan: {languages: {manage: "Manage"}}},
        ensureFlashcardV2: (callback: () => void) => callback(),
        openFlashcardV2ReviewSetCards: (...values: unknown[]) => { args = values; },
    });
    assert.equal(args[1], "Manage");
    assert.equal((args[3] as {notebookID: string}).notebookID, "notebook-a");
});
