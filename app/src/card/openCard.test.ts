import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as flashcardMode from "./flashcardMode";

const classList = () => {
    const values = new Set<string>();
    return {add: (...names: string[]) => names.forEach(name => values.add(name)),
        remove: (...names: string[]) => names.forEach(name => values.delete(name)), contains: (name: string) => values.has(name)};
};

const createReview = async () => {
    const requests: Array<{url: string, payload: Record<string, unknown>, callback: (response: unknown) => void}> = [];
    const renders: Array<() => void> = [];
    let click: (event: unknown) => void;
    const button = {setAttribute: () => {}, removeAttribute: () => {}, previousElementSibling: {textContent: ""}};
    const actions = [0, 1].map(() => ({classList: classList(), firstElementChild: button,
        querySelector: () => button, querySelectorAll: () => [button, button, button, button, button, button]}));
    const element = {classList: classList(), setAttribute: () => {}, firstChild: {addEventListener: (_name: string, callback: typeof click) => { click = callback; }},
        querySelectorAll: () => actions, querySelector: (selector: string) => selector === '[data-type="filter"]' ? {getAttribute: () => "all"} : {innerHTML: ""}};
    const protyle = {element, block: {id: "block"}, wysiwyg: {element: {querySelector: (): null => null}, renderCustom: () => {}}};
    const constants = {LOCAL_FLASHCARD: "card", CB_GET_ALL: "all", SIZE_GET_MAX: 100, DIALOG_OPENCARD: "card", QUICK_DECK_ID: "deck"};
    const dependencies = new Proxy({Constants: constants, Protyle: class {protyle = protyle;},
        fetchPost: (url: string, payload: Record<string, unknown>, callback: (response: unknown) => void) => { requests.push({url, payload, callback}); },
        onGet: (options: {afterCB: () => void}) => renders.push(options.afterCB), hasFlashcardAnswer: () => true,
        forEachPluginSubscriber: () => {},
    }, {get: (target, key) => key in target ? Reflect.get(target, key) : () => {}});
    const exports: Record<string, unknown> = {};
    runInNewContext(transpileModule(readFileSync(__dirname + "/openCard.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, require: (specifier: string) => specifier === "./flashcardMode" ? {...flashcardMode, hasFlashcardAnswer: () => true} : dependencies,
        window: {siyuan: {storage: {card: {}}, config: {flashcard: {}}, languages: new Proxy({}, {get: (_target, key) => String(key)})}}});
    const bind = exports.bindCardEvent as typeof import("./openCard").bindCardEvent;
    const card = {cardID: "old", blockID: "block", deckID: "deck", state: 1, nextDues: {1: "1", 2: "2", 3: "3", 4: "4"}};
    await bind({app: {plugins: []} as unknown as Parameters<typeof bind>[0]["app"], element: element as unknown as Element,
        cardsData: {cards: [card]} as unknown as ICardData, cardType: "all"});
    const press = (detail: string) => click({detail, target: {}, preventDefault: () => {}, stopPropagation: () => {}});
    return {requests, actions, press, complete: () => {
        requests[0].callback({data: {ial: {}}});
        requests[1].callback({code: 0, data: {id: "block", rootID: "block"}});
        renders[0]();
    }};
};

test("loading flashcards ignore reveal, rating, skip and previous keys before rendering completes", async () => {
    const h = await createReview();
    for (const key of [" ", "enter", "1", "2", "3", "4", "0", "p"]) h.press(key);
    assert.equal(h.requests.filter(request => request.url.includes("RiffCard")).length, 0);
    h.complete();
    h.press("3");
    assert.equal(h.requests.filter(request => request.url.endsWith("reviewRiffCard")).length, 0);
    h.press(" ");
    assert.equal(h.actions[1].classList.contains("fn__none"), false);
    assert.equal(h.requests.filter(request => request.url.endsWith("reviewRiffCard")).length, 0);
    h.press(" ");
    assert.equal(h.requests.filter(request => request.url.endsWith("reviewRiffCard")).length, 1);
});
