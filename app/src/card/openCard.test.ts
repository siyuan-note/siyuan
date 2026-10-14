import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as flashcardMode from "./flashcardMode";
const {loadMenuToggle} = require("../../tests/menu-toggle-fixture.cjs");

const classList = () => {
    const values = new Set<string>();
    return {add: (...names: string[]) => names.forEach(name => values.add(name)),
        remove: (...names: string[]) => names.forEach(name => values.delete(name)), contains: (name: string) => values.has(name)};
};

const createReview = async () => {
    const requests: Array<{url: string, payload: Record<string, unknown>, callback: (response: unknown) => void, resolve: () => void}> = [];
    const menuItems = new Map<string, IMenu>();
    let confirmDue: (value: string, dialog: unknown) => void;
    const renders: Array<() => void> = [];
    let click: (event: unknown) => void;
    const button = {setAttribute: () => {}, removeAttribute: () => {}, previousElementSibling: {textContent: ""}};
    const actions = [0, 1].map(() => ({classList: classList(), firstElementChild: button,
        querySelector: () => button, querySelectorAll: () => [button, button, button, button, button, button]}));
    const element = {classList: classList(), setAttribute: () => {}, firstChild: {addEventListener: (_name: string, callback: typeof click) => { click = callback; }},
        querySelectorAll: () => actions, querySelector: (selector: string) => selector === '[data-type="filter"]' ? {getAttribute: (name: string) => name === "data-id" ? "" : "all"} : {innerHTML: ""}};
    const protyle = {element, block: {id: "block"}, wysiwyg: {element: {querySelector: (): null => null}, renderCustom: () => {}}};
    const constants = {LOCAL_FLASHCARD: "card", CB_GET_ALL: "all", SIZE_GET_MAX: 100, DIALOG_OPENCARD: "card", QUICK_DECK_ID: "deck"};
    const menuToggle = loadMenuToggle({window: {siyuan: {menus: {menu: {
        element: {classList: {contains: () => true}}, remove() {},
    }}}}});
    const dependencies = new Proxy({Constants: constants, Protyle: class {protyle = protyle;},
        fetchPost: (url: string, payload: Record<string, unknown>, callback: (response: unknown) => void) => new Promise<void>(resolve => { requests.push({url, payload, callback, resolve}); }),
        Menu: class {addItem(item: IMenu) {menuItems.set(item.id, item);} addSeparator() {} fullscreen() {} open() {}},
        hasClosestByAttribute: (target: {type: string}, _name: string, value: string) => target.type === value ? target : null,
        openInputDialog: (options: {onConfirm: typeof confirmDue}) => { confirmDue = options.onConfirm; },
        onGet: (options: {afterCB: () => void}) => renders.push(options.afterCB), hasFlashcardAnswer: () => true,
        forEachPluginSubscriber: () => {},
    }, {get: (target, key) => key in target ? Reflect.get(target, key) : () => {}});
    const exports: Record<string, unknown> = {};
    runInNewContext(transpileModule(readFileSync(__dirname + "/openCard.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, require: (specifier: string) => {
        if (specifier.endsWith("menuToggle")) return menuToggle;
        if (specifier === "./flashcardMode") return {...flashcardMode, hasFlashcardAnswer: () => true};
        if (specifier === "dayjs") return () => ({format: () => "date", add: () => ({isValid: () => true, year: () => 2026, format: () => "20261015000000"})});
        return dependencies;
    }, window: {siyuan: {storage: {card: {}}, config: {flashcard: {}}, languages: new Proxy({_time: {"1m": "%s min", "1d": "%s day"}}, {get: (target, key) => key in target ? Reflect.get(target, key) : String(key)})}}});
    const bind = exports.bindCardEvent as typeof import("./openCard").bindCardEvent;
    const card = {cardID: "old", blockID: "block", deckID: "deck", state: 1, nextDues: {1: "1", 2: "2", 3: "3", 4: "4"}};
    await bind({app: {plugins: []} as unknown as Parameters<typeof bind>[0]["app"], element: element as unknown as Element,
        cardsData: {cards: [card]} as unknown as ICardData, cardType: "all"});
    const press = (detail: string) => click({detail, target: {}, preventDefault: () => {}, stopPropagation: () => {}});
    return {requests, actions, press, menuItems,
        more: () => click({detail: 0, target: {type: "more", closest: (): null => null, setAttribute() {},
            getBoundingClientRect: () => ({})}, preventDefault: () => {}, stopPropagation: () => {}}),
        confirmDue: () => confirmDue("7", {element: {querySelector: () => ({})}}),
        complete: () => {
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

test("reset review synchronizes the rebuilt card ID before rating, skipping or setting due time", async () => {
    const h = await createReview();
    h.complete();
    h.press(" ");
    h.more();
    h.menuItems.get("reset").click({} as HTMLElement, {} as MouseEvent);
    const reset = h.requests.at(-1);
    h.press("3");
    assert.equal(h.requests.at(-1), reset);
    reset.callback({code: 0});
    reset.resolve();
    const refresh = h.requests.at(-1);
    assert.ok(refresh.url.endsWith("getRiffCardsByBlockIDs"));
    h.press("3");
    assert.equal(h.requests.at(-1), refresh);
    refresh.callback({data: {blocks: [{id: "block", riffCardID: "new"}]}});
    refresh.resolve();
    await new Promise(resolve => setImmediate(resolve));
    h.press("3");
    assert.equal(h.requests.at(-1).payload.cardID, "new");
    h.press("0");
    assert.equal(h.requests.at(-1).payload.cardID, "new");
    h.more();
    h.menuItems.get("setDueTime").click({} as HTMLElement, {} as MouseEvent);
    h.confirmDue();
    assert.deepEqual(JSON.parse(JSON.stringify(h.requests.at(-1).payload.cardDues)), [{id: "new", due: "20261015000000"}]);
});

test("failed identity refresh retries on the next action and never submits the stale card ID", async () => {
    const h = await createReview();
    h.complete();
    h.press(" ");
    h.more();
    h.menuItems.get("reset").click({} as HTMLElement, {} as MouseEvent);
    const reset = h.requests.at(-1);
    reset.callback({code: 0});
    reset.resolve();
    h.requests.at(-1).resolve();
    await new Promise(resolve => setImmediate(resolve));
    h.press("3");
    const retry = h.requests.at(-1);
    assert.ok(retry.url.endsWith("getRiffCardsByBlockIDs"));
    assert.equal(h.requests.filter(request => request.url.endsWith("reviewRiffCard")).length, 0);
    retry.callback({data: {blocks: [{id: "block", riffCardID: "recovered"}]}});
    retry.resolve();
    await new Promise(resolve => setImmediate(resolve));
    h.press("3");
    assert.equal(h.requests.at(-1).payload.cardID, "recovered");
});
