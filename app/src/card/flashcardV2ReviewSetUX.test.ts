import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = readFileSync("src/card/flashcardV2.ts", "utf8");

test("membership labels describe adding existing cards without changing operation values", () => {
    const membership = source.slice(source.indexOf("const openFlashcardV2Membership ="),
        source.indexOf("const basicSourceDirection ="));
    assert.match(membership, /<option value="include">\$\{window\.siyuan\.languages\.addDeck\}/);
    assert.match(membership, /<option value="exclude">\$\{window\.siyuan\.languages\.removeDeck\}/);
    assert.match(membership, /<option value="automatic">/);
    assert.match(membership, /submission\.submit\(reviewSetID, cardIDs, mode,/);
    assert.doesNotMatch(membership, /<option value="include">\$\{window\.siyuan\.languages\.new\}/);
});
const render = (summary?: {cards: number, due: number, included: number, excluded: number}) => {
    const snippet = source.slice(source.indexOf("const renderReviewSet ="),
        source.indexOf("const loadFlashcardV2ReviewSetSummaries ="));
    const script = transpileModule(`${snippet}\nrenderReviewSet(revision, summary);`, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    return runInNewContext(script, {
        window: {siyuan: {languages: new Proxy({}, {get: (_, key) => String(key)})}},
        escapeAttr: (value: string) => value,
        escapeHtml: (value: string) => value.replace(/</g, "&lt;"),
        revision: {entityID: "set", revisionID: "revision", payload: {name: "<Set>", defaultReviewMode: "normal"}},
        summary,
    }) as string;
};

test("review-set counts have visible labels rather than ambiguous added/removed numbers", () => {
    const html = render({cards: 42, due: 7, included: 111, excluded: 222});
    assert.match(html, />riffCard 42<\/span>/);
    assert.match(html, />flashcardDueCard 7<\/span>/);
    assert.doesNotMatch(html, /111|222/);
    assert.doesNotMatch(render(), />riffCard \d/);
});

test("review-set actions remain visible and use native keyboard-activatable buttons", () => {
    const html = render();
    for (const action of ["cards", "review", "statistics", "edit", "delete"]) {
        assert.match(html, new RegExp(`<button type="button" data-type="${action}"`));
    }
    assert.doesNotMatch(html, /b3-list-item--hide-action/);
    assert.match(html, /&lt;Set>/);
    assert.match(source, /type === "cards" \|\|/);
    const css = readFileSync("src/assets/scss/business/_card.scss", "utf8");
    assert.match(css, /\.card__v2-review-set\s*\{\s*flex-wrap: wrap;/);
    assert.match(css, /> button:focus-visible\s*\{\s*outline: 2px solid var\(--b3-theme-primary\)/);
});

test("summary refresh restores the focused action without stealing focus outside the row", () => {
    const snippet = source.slice(source.indexOf("const refreshReviewSet ="),
        source.indexOf("const refreshReviewSetSummary ="));
    const script = transpileModule(`${snippet}\nrefreshReviewSet(revision);`, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    for (const inside of [true, false]) {
        let focused = "";
        let replaced = false;
        const oldItem = {
            dataset: {id: "set"}, contains: () => inside,
            set outerHTML(_value: string) { replaced = true; },
        };
        const newItem = {
            dataset: {id: "set"},
            querySelector: (selector: string) => ({focus: () => { focused = selector; }}),
        };
        runInNewContext(script, {
            document: {activeElement: {dataset: {type: "review"}}},
            dialog: {element: {querySelectorAll: () => [replaced ? newItem : oldItem]}},
            revision: {entityID: "set"}, summaries: {}, renderReviewSet: () => "row",
        });
        assert.ok(replaced);
        assert.equal(focused, inside ? '[data-type="review"]' : "");
    }
});

test("advanced source choices reuse keyboard-accessible picker controls", () => {
    const picker = source.slice(source.indexOf("const openFlashcardV2AdvancedSourcePicker ="),
        source.indexOf("export const openFlashcardV2AdvancedSource ="));
    assert.match(picker, /card__v2-review-picker/);
    assert.match(picker, /<li><button type="button" data-type="newAdvancedSource"/);
    assert.match(picker, /<li><button type="button" data-candidate-index=/);
    assert.doesNotMatch(picker, /<li data-(?:type|candidate-index)=/);
    assert.match(picker, /closest<HTMLElement>\("\[data-type='newAdvancedSource'\], \[data-candidate-index\]"\)/);
});

test("empty membership shows a cancellable create path without assigning cards automatically", () => {
    const snippet = source.slice(source.indexOf("const openFlashcardV2Membership ="),
        source.indexOf("const basicSourceDirection ="));
    for (const create of [false, true]) {
        const requests: string[] = [];
        const dialogs: Array<{content: string, closed: boolean, clicks: Array<() => void>}> = [];
        let saved: (revision: unknown, canContinue: boolean) => void;
        let refreshed = false;
        runInNewContext(transpileModule(`${snippet}\nopenFlashcardV2Membership(["card"], () => refreshed());`, {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText, {
            window: {siyuan: {languages: new Proxy({}, {get: (_, key) => String(key)})}},
            isMobile: () => false,
            createFlashcardV2MembershipSubmission: () => ({}),
            readFlashcardV2Revision: (revision: unknown) => revision,
            isFlashcardReviewSet: () => true,
            escapeAttr: (value: string) => value,
            escapeHtml: (value: string) => value,
            fetchPost: (url: string, _data: unknown, callback: (response: unknown) => void) => {
                requests.push(url);
                callback({data: {entities: requests.length === 1 ? [] : [{entityID: "new-set", payload: {name: "New deck"}}]}});
            },
            Dialog: class {
                readonly state: typeof dialogs[number];
                readonly element: {querySelectorAll: () => unknown[], querySelector: () => unknown};
                constructor(options: {content: string}) {
                    this.state = {content: options.content, closed: false, clicks: []};
                    dialogs.push(this.state);
                    this.element = {querySelector: () => ({value: "include", addEventListener: () => {}, classList: {toggle: () => {}}}),
                        querySelectorAll: () => [0, 1].map((index) => ({
                        addEventListener: (_event: string, click: () => void) => { this.state.clicks[index] = click; },
                    }))};
                }
                destroy() { this.state.closed = true; }
            },
            openFlashcardV2ReviewSetEditor: (revision: unknown, callback: (revision: unknown, canContinue: boolean) => void) => {
                assert.equal(revision, undefined);
                saved = callback;
            },
            refreshed: () => { refreshed = true; },
        });
        assert.match(dialogs[0].content, /emptyContent/);
        assert.match(dialogs[0].content, />new<\/button>/);
        dialogs[0].clicks[create ? 1 : 0]();
        assert.equal(dialogs[0].closed, true);
        assert.equal(requests.length, 1);
        assert.equal(Boolean(saved), create);
        if (create) {
            const firstSave = saved;
            dialogs[0].clicks[1]();
            assert.strictEqual(saved, firstSave);
            saved({}, false);
            assert.equal(dialogs.length, 1);
            saved({}, true);
            assert.equal(dialogs.length, 2);
            assert.match(dialogs[1].content, /New deck/);
            assert.match(dialogs[1].content, />confirm<\/button>/);
            assert.equal(requests.length, 2);
        }
        assert.ok(requests.every(url => url === "/api/flashcard/listEntities"));
        assert.equal(refreshed, false);
    }
});


test("a late review-set save still refreshes data but cannot continue closed UI", () => {
    const start = source.indexOf("}, (mutationResponse) => {");
    const snippet = source.slice(start + "}, (mutationResponse) => {".length, source.indexOf("\n                });", start));
    for (const state of [{isConnected: true, closing: false}, {isConnected: true, closing: true}, {isConnected: false, closing: false}]) {
        let callbacks = 0;
        let mayContinue: boolean;
        let closed = 0;
        const scope = {
            saved: false,
            mutationResponse: {data: {revisions: [{}]}},
            readFlashcardV2Revision: (revision: unknown) => revision,
            isFlashcardReviewSet: () => true,
            callback: (_revision: unknown, canContinue: boolean) => { callbacks++; mayContinue = canContinue; },
            dialog: {element: {isConnected: state.isConnected, dataset: {dialogClosing: state.closing ? "true" : undefined}}, destroy: () => { closed++; }},
        };
        runInNewContext(snippet, scope);
        assert.equal(scope.saved, true);
        assert.equal(callbacks, 1);
        assert.equal(mayContinue, state.isConnected && !state.closing);
        assert.equal(closed, mayContinue ? 1 : 0);
    }
});
