import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {getFlashcardLocateBlockID, isCurrentFlashcardLocateTarget, setFlashcardLocateBlockID} from "./flashcardLocate";
import {escapeHtml} from "../util/escape";

const loadSurface = (globals: Record<string, unknown>, name = "createSessionSurface") => {
    const path = "src/card/flashcardV2Session.ts";
    const source = createSourceFile(path, readFileSync(path, "utf8"), ScriptTarget.ES2021, true);
    const declaration = source.statements.find(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => item.name.getText(source) === name));
    assert.ok(declaration);
    const compiled = transpileModule(`${declaration.getText(source)}\nexports.create = ${name};`, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const exports: any = {};
    runInNewContext(compiled, {exports, queueMicrotask, ...globals});
    return exports.create;
};

test("moving a session retires the old host without destroying state", async () => {
    const titleClasses = new Set<string>();
    const content = {className: "", innerHTML: "", dataset: {}, isConnected: true, focus() {}, remove() {},
        querySelector: () => ({classList: {toggle: (name: string, enabled: boolean) =>
            enabled ? titleClasses.add(name) : titleClasses.delete(name)}})};
    const events: string[] = [];
    const root = {
        setAttribute() {},
        querySelector: () => ({setAttribute: (attribute: string, value: string) => {
            assert.equal(attribute, "aria-label");
            assert.equal(value, "Review");
        }, appendChild: (element: typeof content) => assert.equal(element, content)}),
        firstElementChild: {addEventListener() {}},
    };
    const create = loadSurface({
        Constants: {DIALOG_OPENCARD: "cards"},
        document: {createElement: () => content},
        Dialog: class {
            element = root;
            constructor(private options: {destroyCallback: () => void}) {}
            destroy() { events.push("close-dialog"); this.options.destroyCallback(); }
        },
    }, "createMovableSessionSurface");
    const surface = create({title: "Review", content: "active review", destroyCallback: () => events.push("end-session")});
    assert.deepEqual([...titleClasses], ["resize__move"]);
    const controller = new AbortController();
    const mount = {signal: controller.signal,
        element: {replaceChildren: (element: typeof content) => assert.equal(element, content)},
        close: () => { events.push("close-tab"); controller.abort(); }};
    assert.equal(surface.move(mount), true);
    assert.deepEqual([...titleClasses], ["fn__none"]);
    assert.deepEqual(events, ["close-dialog"]);
    assert.equal(surface.mount, mount);
    assert.equal(surface.move(), true);
    assert.deepEqual([...titleClasses], ["resize__move"]);
    assert.equal(surface.element, content);
    assert.deepEqual(events, ["close-dialog", "close-tab"]);
    assert.equal(surface.mount, undefined);
    surface.destroy();
    await Promise.resolve();
    assert.deepEqual(events, ["close-dialog", "close-tab", "close-dialog", "end-session"]);
});

test("another practice round waits for the dialog closing lifecycle to finish", async () => {
    const calls: string[] = [];
    let finishClosing: () => void;
    const create = loadSurface({Dialog: class {
        element = {};
        constructor(options: {destroyCallback: () => void}) {
            finishClosing = () => {
                options.destroyCallback();
                calls.push("removed-from-dialogs");
            };
        }
        destroy() { calls.push("closing"); }
    }});
    const surface = create({destroyCallback: () => calls.push("cleanup")});
    surface.dispose(() => calls.push("start-practice"));
    assert.deepEqual(calls, ["closing"]);
    finishClosing();
    assert.deepEqual(calls, ["closing", "cleanup", "removed-from-dialogs"]);
    await Promise.resolve();
    assert.deepEqual(calls, ["closing", "cleanup", "removed-from-dialogs", "start-practice"]);
});

test("practice replaces a mounted session without closing its tab or leaving abort listeners", () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const create = loadSurface({document: {
        createElement: () => ({style: {}, remove: () => calls.push("remove-surface")}),
    }});
    const mount = {
        element: {replaceChildren: () => calls.push("mount")},
        signal: controller.signal,
        close: () => { calls.push("close-tab"); controller.abort(); },
    };
    const first = create({content: "first", destroyCallback: () => calls.push("cleanup-first")}, mount);
    let second: ReturnType<typeof create>;
    first.dispose(() => {
        second = create({content: "second", destroyCallback: () => calls.push("cleanup-second")}, mount);
    });
    assert.deepEqual(calls, ["mount", "cleanup-first", "remove-surface", "mount"]);
    assert.equal(controller.signal.aborted, false);
    second.destroy();
    assert.deepEqual(calls, ["mount", "cleanup-first", "remove-surface", "mount", "close-tab",
        "cleanup-second", "remove-surface"]);
});

test("mobile review uses an expanded drawer with title, progress and actions in its header", () => {
    const source = readFileSync("src/card/flashcardV2Session.ts", "utf8");
    const start = source.indexOf("const flashcardSessionTitle =");
    const end = source.indexOf("const renderFlashcardV2Card =", start);
    const render = runInNewContext(transpileModule(`${source.slice(start, end)}
        ({mobile: sessionContent(true, "Review <cards>"), desktop: sessionContent(false, "Review <cards>")});`, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText, {escapeHtml, flashcardV2ReviewCounterHTML: () => "<button data-flashcard-count></button>",
        window: {siyuan: {languages: {}}}});
    for (const markup of [render.mobile, render.desktop]) {
        assert.match(markup, /card__v2-session-header[\s\S]*#iconRiffCard[\s\S]*Review &lt;cards>[\s\S]*data-flashcard-count[\s\S]*data-type="flag"/);
    }

    const sheet = {initiallyExpanded: true};
    const create = loadSurface({AdaptiveDialog: class {
        element = {};
        constructor(options: {mobileSheet: typeof sheet}) {
            assert.equal(options.mobileSheet, sheet);
        }
    }});
    assert.ok(create({mobileSheet: sheet}).element);
});

test("review displays the breadcrumb in the toolbar and filters source, answer and stale responses", () => {
    const source = readFileSync("src/card/flashcardV2Session.ts", "utf8");
    const contextStart = source.indexOf("const renderFlashcardV2Context =");
    const contextEnd = source.indexOf("const flashcardV2SpeechText =", contextStart);
    const toolbarStart = source.indexOf("const sessionContent =");
    const toolbarEnd = source.indexOf("</div>", toolbarStart);
    assert.match(source.slice(toolbarStart, toolbarEnd), /data-flashcard-path class="card__v2-session-path ft__on-surface"/);
    const script = transpileModule(`${source.slice(contextStart, contextEnd)}
        renderFlashcardV2Context(model, "source", [], ["Hidden answer"], {}, body, path, isCurrent);`, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    let current = true;
    let breadcrumb: (response: {data: {id: string, name: string}[]}) => void;
    const path = {textContent: "", title: ""};
    runInNewContext(script, {
        model: {template: {contextPolicy: {breadcrumb: true, documentTitle: true}}},
        body: {insertAdjacentHTML: () => assert.fail("breadcrumb must stay in the toolbar")},
        path, isCurrent: () => current,
        flashcardV2PlainText: (text: string) => text.toLowerCase(),
        fetchPost: (url: string, _payload: unknown, callback: typeof breadcrumb) => {
            assert.equal(url, "/api/block/getBlockBreadcrumb");
            breadcrumb = callback;
        },
    });
    breadcrumb({data: [{id: "doc", name: "Notebook"}, {id: "answer", name: "Hidden answer"},
        {id: "parent", name: " Topic "}, {id: "source", name: "Question"}]});
    assert.deepEqual(path, {textContent: "Notebook / Topic", title: "Notebook / Topic"});
    current = false;
    breadcrumb({data: [{id: "doc", name: "Obsolete"}]});
    assert.equal(path.textContent, "Notebook / Topic");
});

test("review shows toolbar controls without hover and keeps rating intervals with their buttons", () => {
    const source = readFileSync("src/card/flashcardV2Session.ts", "utf8");
    const markup = source.slice(source.indexOf("const flashcardSessionTitle ="), source.indexOf("const renderFlashcardV2Card ="));
    const script = transpileModule(`${markup}\nsessionContent();`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const html = runInNewContext(script, {
        flashcardV2ReviewCounterHTML: () => "", escapeHtml,
        window: {speechSynthesis: {}, siyuan: {languages: {flashcardFlag: "Flag", skip: "Skip"}}},
    }) as string;
    const toolbar = html.slice(html.indexOf("data-flashcard-toolbar"), html.indexOf("card__v2-session-body"));
    assert.match(toolbar, /<button data-type="flag"[^>]*block__icon--show[^>]*aria-label="Flag" aria-haspopup="menu"/);
    assert.match(toolbar, /<button data-type="skip"[^>]*block__icon--show[^>]*aria-label="Skip"/);
    for (const action of ["read-aloud", "edit-source", "more", "undo-review"]) {
        assert.match(toolbar, new RegExp(`<button data-type="${action}" class="block__icon block__icon--show ariaLabel`));
    }
    assert.doesNotMatch(html, /data-type="toggle-outline"|data-flashcard-outline/);
    assert.match(toolbar, /<button data-type="undo-review"[^>]*class="[^"]*fn__none/);
    const withoutSpeech = runInNewContext(script,
        {flashcardV2ReviewCounterHTML: () => "", escapeHtml, window: {siyuan: {languages: {}}}});
    assert.match(withoutSpeech, /<button data-type="read-aloud"[^>]*class="[^"]*fn__none/);
    for (const rating of ["again", "hard", "good", "easy"]) {
        assert.match(html, new RegExp(`<button data-rating="${rating}"[^\\n]*<span class="card__v2-rating-label">[^<]*</span><span[^>]*data-rating-interval[^>]*></span></button>`));
    }
});

test("review footer and toolbar adapt to the panel rather than clipping inside a split", () => {
    const styles = readFileSync("src/assets/scss/business/_card.scss", "utf8");
    assert.match(styles, /&__v2-session\s*\{\s*container: flashcard-review \/ inline-size;/);
    assert.match(styles, /@container flashcard-review \(max-width: 480px\)\s*\{\s*\.card__v2-session-actions\s*\{\s*flex-wrap: wrap;[\s\S]*?flex-basis: calc\(50% - 4px\)/);
    assert.match(styles, /@container flashcard-review \(max-width: 350px\)\s*\{\s*\.card__v2-session-toolbar\s*\{\s*flex-wrap: wrap;/);
    assert.match(styles, /&__v2-rating-label,\s*&__v2-rating-interval\s*\{\s*display: block;/);
});

test("waiting text stays outside the empty-state icon rule and actions share one row", () => {
    const source = readFileSync("src/card/flashcardV2Session.ts", "utf8");
    const snippet = source.slice(source.indexOf("const showWaiting ="),
        source.indexOf("const refreshQueueAfterFailedReview ="));
    const script = transpileModule(`${snippet}\nshowWaiting(due);`, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    for (const lastReview of [undefined, {}]) {
        for (const due of [0, 61000]) {
            const label = {textContent: ""};
            let action = "";
            const front = {
                innerHTML: "",
                querySelector: (selector: string) => selector === "[data-flashcard-wait]" ? label : {
                    insertAdjacentHTML: (position: string, html: string) => {
                        assert.equal(selector, ".card__v2-completion-actions");
                        assert.equal(position, "afterbegin");
                        action = html;
                    },
                },
            };
            runInNewContext(script, {
                due, lastReview, queue: [], completedPending: true, renderPending: false, index: 0,
                requestPending: false, waitingTimer: undefined,
                showCompletion: () => {}, nextCard: () => assert.fail("not due yet"),
                Date: {now: () => 1000},
                dialog: {element: {querySelector: () => front}},
                window: {setInterval: () => 1, siyuan: {languages: {
                    flashcardFinishSession: "Finish", undo: "Undo", loading: "Loading",
                    flashcardWaitingDue: "Next in ${time}",
                }}},
            });
            assert.match(front.innerHTML, /<span data-flashcard-wait><\/span>/);
            assert.doesNotMatch(front.innerHTML, /<div data-flashcard-wait/);
            assert.match(front.innerHTML, /card__v2-completion-actions/);
            assert.match(front.innerHTML, /data-type="finish"/);
            assert.equal(label.textContent, due ? "Next in 1:00" : "Loading");
            assert.equal(action.includes('data-type="undo-review"'), Boolean(lastReview));
        }
    }
});

test("real waiting completion chain clears the previous locate target and invalidates its pending response", () => {
    const source = readFileSync("src/card/flashcardV2Session.ts", "utf8");
    const completion = source.slice(source.indexOf("const showCompletion ="), source.indexOf("const nextCard ="));
    const waiting = source.slice(source.indexOf("const showWaiting ="),
        source.indexOf("const refreshQueueAfterFailedReview ="));
    assert.ok(completion.includes("setFlashcardLocateBlockID(dialog.element)"));
    const script = transpileModule(`${completion}\n${waiting}\nshowWaiting(due);`, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    for (const due of [0, 61000]) {
        const attributes = new Map<string, string>();
        const label = {textContent: ""};
        const hidden = {classList: {add: () => {}}};
        const front = {innerHTML: "", className: "", querySelector: () => label};
        const content = {querySelector: (selector: string) =>
            selector === "[data-flashcard-front]" ? front : hidden};
        const element = {
            getAttribute: (name: string) => attributes.get(name) || null,
            setAttribute: (name: string, value: string) => attributes.set(name, value),
            removeAttribute: (name: string) => attributes.delete(name),
            querySelector: (selector: string) => selector === ".card__block" ? content :
                selector === "[data-flashcard-front]" ? front :
                    selector === "[data-flashcard-count]" ? {textContent: ""} :
                        selector === ".card__v2-session-host" ? null : hidden,
        };
        const previousBlock = "synthetic-previous-source";
        setFlashcardLocateBlockID(element, previousBlock);
        assert.equal(isCurrentFlashcardLocateTarget(element, previousBlock, element), true);
        let outlineResets = 0;
        let waitingClears = 0;
        const globals: Record<string, unknown> = {
            due, queue: [{}], index: 0, completedPending: false, renderPending: false, renderGeneration: 7,
            options: {reviewMode: "normal"},
            requestPending: false, waitingTimer: undefined, lastReview: undefined,
            dialog: {element}, setFlashcardLocateBlockID, revealController: undefined,
            outline: {update: () => { outlineResets++; }}, clearWaiting: () => { waitingClears++; },
            setReviewActionsEnabled: () => {}, reviewProgress: () => ({}), reviewCounter: {update: () => {}},
            sessionCompletionContent: () => "Completed", weakCards: {cards: (): unknown[] => []},
            nextCard: () => assert.fail("not due yet"), Date: {now: () => 1000},
            window: {setInterval: () => 1, siyuan: {languages: {
                flashcardFinishSession: "Finish", loading: "Loading", flashcardWaitingDue: "Next in ${time}",
            }}},
        };
        runInNewContext(script, globals);
        assert.equal(getFlashcardLocateBlockID(element), "");
        assert.equal(isCurrentFlashcardLocateTarget(element, previousBlock, element), false);
        assert.equal(outlineResets, 1);
        assert.equal(waitingClears, 1);
        assert.equal(globals.renderGeneration, 8);
        assert.equal(globals.completedPending, false);
        assert.equal(globals.renderPending, true);
        assert.equal(globals.index, 1);
        assert.equal(label.textContent, due ? "Next in 1:00" : "Loading");
    }
});

test("v2 completion explains normal eligibility without changing buttons or claiming all cards learned", () => {
    const source = readFileSync("src/card/flashcardV2Session.ts", "utf8");
    const start = source.indexOf("const sessionCompletionContent =");
    const end = source.indexOf("const sessionContent =", start);
    assert.ok(start > 0 && end > start);
    const script = transpileModule(`${source.slice(start, end)}\nsessionCompletionContent(canUndo, mode, weakCount);`, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    for (const mode of ["normal", "reinforcement"]) {
        for (const canUndo of [false, true]) {
            for (const weakCount of [0, 2]) {
                const html = runInNewContext(script, {mode, canUndo, weakCount, escapeHtml,
                    window: {siyuan: {languages: {
                        noDueCard: "OLD_ALL_DONE", flashcardNoEligibleCards: "No cards <now>",
                        flashcardNoEligibleCardsTip: "Eligibility <rules>", flashcardReviewReinforcementTip: "Practice tip",
                        flashcardRetryWeak: "Retry ${count}", flashcardPendingEdits: "Pending",
                        flashcardFinishSession: "Finish", undo: "Undo",
                    }}},
                }) as string;
                assert.ok(html.includes(escapeHtml("No cards <now>")));
                assert.equal(html.includes(escapeHtml("Eligibility <rules>")), mode === "normal");
                assert.doesNotMatch(html, /OLD_ALL_DONE/);
                assert.match(html, /data-type="pending-edits"/);
                assert.match(html, /data-type="finish"/);
                assert.equal(html.includes('data-type="undo-review"'), canUndo);
                assert.equal(html.includes('data-type="practice-weak"'), weakCount > 0);
                assert.equal(html.includes("Practice tip"), weakCount > 0);
            }
        }
    }
    assert.match(source, /sessionCompletionContent\(false, options.reviewMode\)/);
    assert.match(source, /sessionCompletionContent\(Boolean\(lastReview\), options.reviewMode,/);
});
