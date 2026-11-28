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

test("a closing sole review tab anchors relocation on a neighboring live pane", async () => {
    const start = routeSource.indexOf("const findReviewRelocationAnchor");
    const move = compile(routeSource.slice(start, routeSource.indexOf("export const openFlashcardReviewTab", start)));
    const pane = (id: string, connected = true, count = 1) => ({
        id, element: {isConnected: connected},
        children: Array.from({length: count}, () => ({headElement: {}})),
    });
    const left = pane("left"), right = pane("right"), detached = pane("detached", false), source = pane("review");
    type Pane = typeof source;

    const run = async (position: "tab" | "right" | "bottom", panes: Pane[], sourceID?: string, abort = false,
                       fail = false, accepts = true) => {
        const wrappers = {exports: {} as Record<string, (...args: unknown[]) => unknown>};
        const layout = {panes};
        const events: string[] = [];
        const controller = new AbortController();
        if (abort) { controller.abort(); }
        let open: {options: Record<string, unknown>, anchor?: Pane};
        let handoff: (target: object) => boolean;
        const destination = {};
        runInNewContext(move, {...wrappers, window: {siyuan: {layout: {centerLayout: layout},
            languages: {spaceRepetition: "Study"}}},
        getAllWnds: (parent: typeof layout, result: Pane[]) => result.push(...parent.panes),
        genUUID: () => "transfer-id", createFlashcardReviewTabData: () => ({sameSession: true}),
        registerFlashcardSurfaceTransfer: (id: string, attach: typeof handoff) => {
            assert.equal(id, "transfer-id");
            handoff = attach;
            return () => { events.push("release"); };
        },
        openFile: async (options: Record<string, unknown>, anchor?: Pane) => {
            open = {options, anchor};
            if (fail) { throw new Error("open failed"); }
            handoff(destination);
        }});
        const moved = wrappers.exports.moveFlashcardReviewToTab({}, "set", "Review", {reviewMode: "normal"},
            position, (mount: object) => {
                events.push("attach");
                assert.equal(mount, destination);
                return accepts;
            }, sourceID ? {signal: controller.signal, element: {closest: () => ({dataset: {id: sourceID}})}} : undefined);
        if (fail) {
            await assert.rejects(moved as Promise<boolean>, /open failed/);
            assert.deepEqual(events, ["release"]);
        } else {
            assert.equal(await moved, !abort && accepts);
            assert.deepEqual(events, abort ? [] : ["attach", "release"]);
        }
        return open;
    };

    const samePanel = await run("tab", [left, detached, source, right], "review");
    assert.equal(samePanel.anchor, right);
    assert.equal(samePanel.options.position, undefined);
    assert.equal((await run("bottom", [left, source], "review")).anchor, left);
    assert.equal((await run("right", [source, right], "review")).options.position, "right");
    assert.equal((await run("bottom", [left, pane("review", true, 2)], "review")).anchor, undefined);
    assert.equal((await run("bottom", [left, source])).anchor, undefined);
    assert.equal((await run("bottom", [source], "review")).anchor, undefined);
    assert.equal(await run("right", [left, source], "review", true), undefined);
    await run("bottom", [left, source], "review", false, true);
    await run("bottom", [left, source], "review", false, false, false);

    const editor = readFileSync("src/editor/util.ts", "utf8");
    assert.match(editor, /let wnd = anchor\?\.element\.isConnected && anchor\.children\.length \? anchor : undefined;[\s\S]*?if \(!wnd && element\)/);
});
