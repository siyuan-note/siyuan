import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const harness = (id: string) => {
    const source = readFileSync("src/card/flashcardV2Session.ts", "utf8");
    const position = source.indexOf(`id: "${id}"`);
    const start = source.lastIndexOf("menu.addItem(", position);
    const end = source.indexOf("menu.addItem(", position);
    const script = transpileModule(source.slice(start, end), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    let item: {click: () => void};
    let confirm: () => void;
    let query: (response: unknown) => void;
    let queryData: {query: {root: {field: string, value: string}}};
    let message = "";
    const mutations: Array<{ids: string[], action: string}> = [];
    const current = {card: {id: "card", sourceID: "source"}};
    const state = {
        current, queue: [current], index: 0, sessionFinished: false, requestPending: false,
        dialog: {element: {isConnected: true}},
        window: {siyuan: {languages: {reset: "Reset", resetCardTip: "Reset ${x}",
            flashcardSuspendSource: "Suspend source", flashcardSourceActionTip: "All cards from this source", riffCard: "Cards"}}},
        menu: {addItem: (value: typeof item) => { item = value; }},
        confirmDialog: (options: {text: string, confirm: () => void}) => {
            message = options.text;
            confirm = options.confirm;
        },
        manageAndSkip: (ids: string[], action: string) => mutations.push({ids, action}),
        fetchPost: (_url: string, payload: typeof queryData, callback: typeof query) => {
            queryData = payload; query = callback; return Promise.resolve();
        },
    };
    runInNewContext(script, state);
    return {state, mutations, click: () => item.click(), confirm: () => confirm(), message: () => message,
        query: (cards: string[]) => query({data: {cards: cards.map(id => ({card: {id}}))}}), queryData: () => queryData};
};

test("review reset requires confirmation and refuses a stale card or ended session", () => {
    for (const stale of [false, true]) {
        const h = harness("flashcardV2Reset");
        h.click();
        assert.equal(h.message(), "Reset 1");
        assert.equal(h.mutations.length, 0);
        if (stale) { h.state.sessionFinished = true; }
        h.confirm();
        assert.equal(h.mutations.length, stale ? 0 : 1);
    }
    const h = harness("flashcardV2Reset");
    h.click();
    h.state.queue = [{card: {id: "another", sourceID: "source"}}];
    h.confirm();
    assert.equal(h.mutations.length, 0);
});

test("source suspension shows actual queried scope and waits for confirmation", () => {
    const h = harness("flashcardV2SuspendSource");
    h.click();
    assert.equal(h.queryData().query.root.field, "sourceID");
    assert.equal(h.queryData().query.root.value, "source");
    h.query(["card", "sibling-outside-current-deck"]);
    assert.match(h.message(), /All cards from this source/);
    assert.match(h.message(), /Cards 2/);
    assert.equal(h.mutations.length, 0);
    h.confirm();
    assert.deepEqual(Array.from(h.mutations[0].ids), ["card", "sibling-outside-current-deck"]);
});

test("late source lookup cannot act after switching cards or closing the session", () => {
    const h = harness("flashcardV2SuspendSource");
    h.click();
    h.state.dialog.element.isConnected = false;
    h.query(["card"]);
    assert.equal(h.message(), "");
    assert.equal(h.state.requestPending, false);
    assert.equal(h.mutations.length, 0);
    const stale = harness("flashcardV2SuspendSource");
    stale.click();
    stale.query(["card"]);
    stale.state.queue = [{card: {id: "another", sourceID: "source"}}];
    stale.confirm();
    assert.equal(stale.mutations.length, 0);
});
