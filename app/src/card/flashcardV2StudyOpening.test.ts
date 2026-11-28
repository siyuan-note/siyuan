import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {createFlashcardReviewTabData, resolveFlashcardOpenMode} from "./flashcardOpenMode";

const compile = (source: string) => transpileModule(source, {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const routeSource = readFileSync("src/card/openFlashcardReviewTab.ts", "utf8");
const route = compile(routeSource.slice(routeSource.indexOf("export const openFlashcardReviewTab =")));
const flush = () => new Promise(resolve => setImmediate(resolve));

test("tab and split success notify separately from serializable review options; failures do not notify", async () => {
    for (const mode of [1, 2]) {
        for (const outcome of ["tab", "inactive", "hidden", "detached", "empty", "reject"]) {
            let opened = 0;
            let errors = 0;
            let resolve: (tab: unknown) => void;
            let reject: (error: Error) => void;
            let request: {position?: string, custom: {data: unknown}};
            const exports: Record<string, (...args: unknown[]) => unknown> = {};
            runInNewContext(route, {exports, createFlashcardReviewTabData, resolveFlashcardOpenMode,
                isMobile: () => false, isBrowser: () => false,
                console: {error: () => { errors++; }},
                window: {siyuan: {config: {flashcard: {openMode: mode}}, languages: {spaceRepetition: "Review"}}},
                openFile: (value: typeof request) => {
                    request = value;
                    return new Promise((yes, no) => { resolve = yes; reject = no; });
                },
            });
            const options = {reviewMode: "normal", cardIDs: ["qa-card"]};
            assert.equal(exports.openFlashcardReviewTab({}, "qa-set", "QA", options, () => { opened++; }), true);
            assert.equal(opened, 0);
            assert.equal(request.position, mode === 2 ? "right" : undefined);
            assert.deepEqual(JSON.parse(JSON.stringify(request.custom.data)), {
                cardType: "all", id: "", title: "QA", reviewSetID: "qa-set", review: options,
            });
            if (outcome === "reject") { reject(new Error("synthetic open failure")); }
            else {
                resolve(outcome === "empty" ? undefined : {
                    headElement: {classList: {contains: (name: string) => {
                        assert.equal(name, "item--focus");
                        return outcome !== "inactive";
                    }}},
                    panelElement: {isConnected: outcome !== "detached", classList: {contains: (name: string) => {
                        assert.equal(name, "fn__none");
                        return outcome === "hidden";
                    }}},
                });
            }
            await flush();
            assert.equal(opened, outcome === "tab" ? 1 : 0);
            assert.equal(errors, outcome === "reject" ? 1 : 0);
        }
    }
});

test("dialog routing does not open a tab or notify the originating management", () => {
    const exports: Record<string, (...args: unknown[]) => unknown> = {};
    runInNewContext(route, {exports, resolveFlashcardOpenMode, isMobile: () => false, isBrowser: () => false,
        window: {siyuan: {config: {flashcard: {openMode: 0}}}},
        openFile: () => assert.fail("dialog must not open a tab"),
    });
    assert.equal(exports.openFlashcardReviewTab({}, "", "QA", {}, () => assert.fail("must not notify")), false);
});

test("successful tab opening closes only the still-connected originating management dialog", () => {
    const source = readFileSync("src/card/flashcardV2.ts", "utf8");
    const start = source.indexOf('if (type === "study")');
    const end = source.indexOf('if (type === "pagePrevious"', start);
    const script = compile(`(() => { ${source.slice(start, end)} })();`);
    for (const state of ["active", "detached", "closing", "replaced"]) {
        let callback: () => void;
        const calls: string[] = [];
        const dialog = {element: {isConnected: state !== "detached", dataset: {
            dialogClosing: state === "closing" ? "true" : "false",
        }}, destroy: () => calls.push("destroy")};
        const owner = {dialog: state === "replaced" ? {} : dialog, view: {close: () => calls.push("close")}};
        runInNewContext(script, {type: "study", window: {siyuan: {ws: {app: {}}}}, name: "QA",
            reviewSetID: "qa-set", managementQuery: {}, cards: [{card: {id: "a"}}, {card: {id: "b"}}],
            selectedCardIDs: new Set(["a"]), owner, dialog,
            openFlashcardV2SubsetSession: (...args: unknown[]) => {
                assert.equal((args[4] as unknown[]).length, 1);
                callback = args[5] as () => void;
            },
        });
        assert.deepEqual(calls, []);
        callback();
        assert.deepEqual(calls, state === "active" ? ["close", "destroy"] : []);
    }
});

test("subset cancellation preserves management and confirmation passes the callback outside review options", () => {
    const source = readFileSync("src/card/flashcardV2Subset.ts", "utf8");
    const script = compile(source.slice(source.indexOf("export const openFlashcardV2SubsetSession =")));
    for (const confirm of [false, true]) {
        const handlers: Array<() => void> = [];
        let closed = 0;
        let started = 0;
        let notified = 0;
        const onTabOpened = () => { notified++; };
        const options = {reviewMode: "reinforcement", cardIDs: ["qa"], includeSuspended: true, includeBuried: false, includePaused: true};
        const controls: Record<string, unknown> = {
            scope: {value: "selected", addEventListener: () => {}},
            mode: {value: "normal", addEventListener: () => {}}, order: {value: "selected"},
            orderField: {classList: {toggle: () => {}}}, modeTip: {textContent: ""},
        };
        const exports: Record<string, (...args: unknown[]) => unknown> = {};
        runInNewContext(script, {exports, isMobile: () => false, escapeHtml: (value: string) => value,
            window: {siyuan: {languages: {flashcardStudySelection: "Selected ${count}"}}},
            Dialog: class {
                element = {querySelector: (selector: string) => controls[selector.match(/"([^"]+)"/)[1]],
                    querySelectorAll: () => [0, 1].map(index => ({addEventListener: (_event: string, fn: () => void) => {
                        handlers[index] = fn;
                    }}))};
                destroy() { closed++; }
            },
            orderFlashcardV2StudyCards: () => ["qa"],
            flashcardV2SubsetOptions: () => ({cardIDs: ["qa"]}),
            flashcardV2ReviewOptionsHTML: () => "",
            bindFlashcardV2ReviewOptions: () => () => ({reviewMode: "reinforcement",
                includeSuspended: true, includeBuried: false, includePaused: true}),
            openFlashcardV2ReviewSession: (...args: unknown[]) => {
                started++;
                assert.deepEqual({...args[3] as object}, options);
                assert.equal(args[4], undefined);
                assert.equal(args[5], onTabOpened);
            },
        });
        exports.openFlashcardV2SubsetSession({}, "QA", "", undefined, [{card: {id: "qa"}}], onTabOpened);
        handlers[confirm ? 1 : 0]();
        assert.equal(closed, 1);
        assert.equal(started, confirm ? 1 : 0);
        assert.equal(notified, 0);
    }
});
