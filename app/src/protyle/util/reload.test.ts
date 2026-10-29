import * as assert from "node:assert/strict";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {loadModule} from "../../testSupport/loadModule";

const loadReload = () => {
    let doc: {cb: (keys: string[]) => void, onRenderError: () => void, afterAVRender: () => Promise<void>};
    let finishBacklink: () => void;
    const backlink = new Promise<void>(resolve => finishBacklink = resolve);
    let finishScroll: () => void;
    const scroll = new Promise<void>(resolve => finishScroll = resolve);
    const noop = () => {};
    const defaults = new Proxy({}, {get: () => noop});
    const exports = loadModule<Pick<typeof import("./reload"), "reloadProtyleAndWait">>(
        "src/protyle/util/reload.ts", {console,
        window: {siyuan: {config: {editor: {spellcheck: false}}}},
        require: (name: string) => {
            if (name === "./reloadState") return {shouldReloadProtyle: () => true};
            if (name === "../scroll/saveScroll") return {saveScroll: noop, getDocByScroll: (options: typeof doc) => doc = options};
            if (name === "./reloadScroll") return {preserveReloadScroll: () => ({cancel: noop, afterAVRender: () => scroll})};
            if (name === "./hasClosest") return {hasClosestByClassName: () => ({querySelectorAll: () => [{value: ""}, {value: ""}]})};
            if (name === "../wysiwyg/renderBacklink") return {renderBacklink: () => backlink};
            if (name === "../../util/fetch") return {fetchPost: (_url: string, _data: unknown, callback: (response: unknown) => void) => {
                callback({code: 0, data: {revision: "new", backlinks: [], keywords: []}});
                return Promise.resolve();
            }};
            return defaults;
        },
    }, ScriptTarget.ES2021);
    const element = {classList: {add: noop, remove: noop}, getAttribute: () => "", setAttribute: noop};
    const protyle = {
        wysiwyg: {element}, element, options: {}, lute: new Proxy({}, {get: () => noop}),
        contentElement: {scrollTop: 0}, block: {rootID: "root"},
        preview: {element: {classList: {contains: () => true}}},
    } as unknown as IProtyle;
    return {...exports, protyle, getDoc: () => doc, finishBacklink: () => finishBacklink(), finishScroll: () => finishScroll()};
};

test("sync reload waits beyond document insertion for database rendering and scroll restoration", async () => {
    const reload = loadReload();
    let done = false;
    const pending = reload.reloadProtyleAndWait(reload.protyle).then(() => done = true);
    await Promise.resolve();
    assert.equal(done, false);
    reload.getDoc().cb([]);
    await Promise.resolve();
    assert.equal(done, false, "inserting document HTML does not finish database rendering");
    const restoringScroll = reload.getDoc().afterAVRender();
    await Promise.resolve();
    assert.equal(done, false, "database rendering does not finish scroll restoration");
    reload.finishScroll();
    await restoringScroll;
    await pending;
    const failed = reload.reloadProtyleAndWait(reload.protyle);
    reload.getDoc().onRenderError();
    await assert.rejects(failed, /Could not refresh/);
});

test("invalidated document renders report failure instead of leaving sync reload pending", () => {
    const exports = loadModule<Pick<typeof import("./onGet"), "onGet">>("src/protyle/util/onGet.ts",
        {require: () => ({})}, ScriptTarget.ES2021);
    let failures = 0;
    exports.onGet({protyle: {} as IProtyle, data: {} as IWebSocketData,
        isValid: () => false, onAVRenderError: () => failures++});
    assert.equal(failures, 1);
});

test("sync reload waits for editable backlink database rendering", async () => {
    const reload = loadReload();
    reload.protyle.options.backlinkData = [];
    let done = false;
    const pending = reload.reloadProtyleAndWait(reload.protyle).then(() => done = true);
    await Promise.resolve();
    assert.equal(done, false);
    reload.finishBacklink();
    await pending;
});

test("sync reload waits for preview callbacks instead of its scheduled render call", async () => {
    const reload = loadReload();
    let complete: () => void;
    reload.protyle.preview.element.classList.contains = () => false;
    reload.protyle.preview.render = (_protyle, callback) => complete = callback;
    let done = false;
    const pending = reload.reloadProtyleAndWait(reload.protyle).then(() => done = true);
    await Promise.resolve();
    assert.equal(done, false);
    complete();
    await pending;
});
