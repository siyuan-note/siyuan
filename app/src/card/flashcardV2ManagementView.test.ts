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

test("management starts ungrouped and saves explicit grouping choices without changing other layout state", () => {
    const source = readFileSync("src/card/flashcardV2.ts", "utf8");
    const start = source.indexOf("const openFlashcardV2ReviewSetCards =");
    const body = source.indexOf("    const isCurrent = owner.view.request", start);
    const toggle = source.indexOf('if (type === "group")', body);
    const nextHandler = source.indexOf('if (type === "selectPage")', toggle);
    const script = transpileModule(`${source.slice(start, body)}
            return grouped;
        };
        const toggleGrouping = (target: HTMLInputElement) => {
            const type = "group";
            const owner = {view: new FlashcardV2ManagementView()};
            const reviewSetID = "", name = "Manage", filters = {}, managementOptions = undefined;
            ${source.slice(toggle, nextHandler)}
        };
        [openFlashcardV2ReviewSetCards, toggleGrouping];`, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const storage: Record<string, {fullscreen: boolean, groupBySource?: boolean}> = {card: {fullscreen: true}};
    const writes: boolean[] = [];
    const [open, toggleGrouping] = runInNewContext(script, {
        FlashcardV2ManagementView, Constants: {LOCAL_FLASHCARD: "card"}, window: {siyuan: {storage}},
        setStorageVal: (key: string, value: typeof storage.card) => {
            assert.equal(key, "card");
            assert.equal(value, storage.card);
            assert.equal(value.fullscreen, true);
            writes.push(value.groupBySource);
        },
    });
    assert.equal(open("", "Manage"), false);
    toggleGrouping({checked: true});
    assert.equal(open("", "Manage"), true);
    toggleGrouping({checked: false});
    assert.equal(open("", "Manage"), false);
    assert.deepEqual(writes, [true, false]);
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

test("review set pages stay scoped and use one card per source to load missing titles", () => {
    const source = readFileSync("src/card/flashcardV2.ts", "utf8");
    const start = source.indexOf("        const cardsWithoutSource =");
    const end = source.indexOf("export const openFlashcardV2Management =", start);
    const script = transpileModule(`const open = () => {
        const queryCards = (cardIDs?: string[], total?: number, resolvedCards?: unknown[]) => {
        ${source.slice(start, end)}
        open();`, {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021}}).outputText;
    const members = ["first", "second"].map((id) => ({card: {id, sourceID: "shared"}}));
    const summary = {sourceBlockID: "block", sourceTitle: "Title"};
    const listQuery = {version: 1, root: {operator: "predicate", field: "generationStatus", comparator: "notEqual", value: "deleted"}};
    const pages: {total: number, cardIDs: string[] | null, cards?: typeof members}[] = [
        {total: 0, cardIDs: null}, {total: 0, cardIDs: []},
        {total: 2, cardIDs: ["first", "second"], cards: members},
    ];
    for (const grouped of [false, true]) {
        for (const page of pages) {
            const requests: string[] = [];
            let rendered: unknown[];
            runInNewContext(script, {
                reviewSetID: "review-set", listQuery, now: 1000, grouped, offset: 0,
                flashcardV2ManagementPageSize: 50, sort: grouped ? undefined : {sortBy: "due", sortDescending: true},
                renderCards: (cards: unknown[]) => { rendered = Array.from(cards); },
                fetchPost: (route: string, payload: {query?: {root: {value: string[]}}, options: {sortBy?: string}},
                    callback: (response: {data: unknown}) => void) => {
                    requests.push(route);
                    if (route === "/api/flashcard/previewReviewSet") {
                        assert.equal(payload.query, listQuery);
                        assert.equal(payload.options.sortBy, grouped ? undefined : "due");
                        callback({data: structuredClone(page)});
                    } else {
                        assert.equal(payload.options.sortBy, undefined);
                        assert.deepEqual(Array.from(payload.query.root.value), ["second"]);
                        callback({data: {cards: [{...members[1], ...summary}]}});
                    }
                    return Promise.resolve();
                },
            });
            assert.deepEqual(requests, page.cards ? ["/api/flashcard/previewReviewSet", "/api/flashcard/queryCards"] :
                ["/api/flashcard/previewReviewSet"]);
            assert.deepEqual(rendered, page.cards?.map((card) => ({...card, ...summary})) ?? []);
        }
    }
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
    assert.match(management, /if \(action === "reset"\) \{\s*confirmDialog\(\{\s*title: window\.siyuan\.languages\.reset,/);
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
        owner: {}, listenerOptions: {signal: {aborted: false}},
        dialog: {element: {isConnected: true, dataset: {}}},
        createFlashcardV2Operation: () => () => ({operationID: "operation", changedAt: 1000}),
        selectedCardIDs: new Set(["selected", "not-on-page"]),
        cards: [{card: {id: "selected"}}, {card: {id: "not-selected"}}],
        window: {siyuan: {languages: {reset: "Reset", resetCardTip: "Reset ${x}"}}},
        genUUID: () => "operation", reloadPage: (): void => {},
        confirmDialog: (options: {text: string, confirm: () => void}) => {
            assert.equal(options.text, "Reset 1");
            confirm = options.confirm;
        },
        withFetchTimeout: (request: () => Promise<unknown>) => request(),
        fetchSyncPost: async (_url: string, payload: unknown) => { requests.push(payload); return {code: 0}; },
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

test("the source preview ignores a superseded request and a response after the management page closes", async () => {
    const source = readFileSync("src/card/flashcardV2.ts", "utf8");
    const start = source.indexOf("let sourcePreviewRequest = 0");
    const end = source.indexOf("if (grouped) {", start);
    const script = transpileModule(source.slice(start, end) + "\nshowSourcePreview;", {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const controller = new AbortController();
    const requests: Array<{id: string; complete: (dom: string) => void}> = [];
    let sanitized = "";
    const body = {
        textContent: "",
        childElementCount: 0,
        set innerHTML(value: string) {
            this.textContent = value;
            this.childElementCount = value ? 1 : 0;
        },
    };
    const open = runInNewContext(script, {
        sourcePreview: {classList: {remove: () => {}}}, sourcePreviewBody: body,
        listenerOptions: {signal: controller.signal},
        window: {siyuan: {languages: {loading: "Loading", emptyContent: "Empty"}},
            DOMPurify: {sanitize: (value: string) => { sanitized = value; return value; }}},
        fetchPost: (_url: string, {id}: {id: string}, callback: (response: {data: {dom: string}}) => void) =>
            new Promise<void>(resolve => requests.push({id, complete: dom => { callback({data: {dom}}); resolve(); }})),
    });
    open("first");
    open("second");
    requests[0].complete("out of date");
    requests[1].complete("current");
    await Promise.resolve();
    assert.equal(body.textContent, "current");
    assert.equal(sanitized, "current");

    open("third");
    controller.abort();
    requests[2].complete("after close");
    await Promise.resolve();
    assert.equal(body.textContent, "Loading");
    assert.equal(sanitized, "current");
});

test("state shortcuts stay compact and wide table rows reserve the same columns as their header", () => {
    const source = readFileSync("src/card/flashcardV2.ts", "utf8");
    const css = readFileSync("src/assets/scss/business/_card.scss", "utf8");
    assert.match(source, /class="card__v2-management-tools card__v2-management-tools--states">\$\{managementStateShortcuts/);
    assert.match(css, /&--states \{\s*flex: 0 0 auto;/);
    assert.match(css, /container: flashcard-management-list \/ inline-size;/);
    assert.match(css, /@container flashcard-management-list \(min-width: 680px\) \{\s*&__v2-managed-header \{/);
    assert.match(source, /grouped \? "" : " card__v2-managed-card--table"/);
    assert.match(css, /&__v2-managed-header,\s*&__v2-managed-card--table \{\s*> \.card__v2-managed-leading \{\s*inline-size: 43px;/);
    assert.match(css, /&__v2-managed-card--table\.card__v2-managed-card\.b3-list-item--hide-action \{\s*> \[data-type="suspend"\],\s*> \[data-type="previewFull"\],\s*> \[data-type="more"\] \{\s*display: flex;\s*opacity: 0;/);
    assert.match(css, /&:hover,\s*&:focus-within \{\s*> \[data-type="suspend"\],\s*> \[data-type="previewFull"\],\s*> \[data-type="more"\] \{\s*opacity: 1;/);
});
