import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const loadReload = () => {
    let doc: {cb: (keys: string[]) => void, onRenderError: () => void};
    let finishBacklink: () => void;
    const backlink = new Promise<void>(resolve => finishBacklink = resolve);
    const noop = () => {};
    const exports = {} as Pick<typeof import("./reload"), "reloadProtyleAndWait">;
    const defaults = new Proxy({}, {get: () => noop});
    runInNewContext(transpileModule(readFileSync("src/protyle/util/reload.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, console,
        window: {siyuan: {config: {editor: {spellcheck: false}}}},
        require: (name: string) => {
            if (name === "./reloadState") return {shouldReloadProtyle: () => true};
            if (name === "../scroll/saveScroll") return {saveScroll: noop, getDocByScroll: (options: typeof doc) => doc = options};
            if (name === "./reloadScroll") return {preserveReloadScroll: () => ({cancel: noop})};
            if (name === "./hasClosest") return {hasClosestByClassName: () => ({querySelectorAll: () => [{value: ""}, {value: ""}]})};
            if (name === "../wysiwyg/renderBacklink") return {renderBacklink: () => backlink};
            if (name === "../../util/fetch") return {fetchPost: (_url: string, _data: unknown, callback: (response: unknown) => void) => {
                callback({code: 0, data: {revision: "new", backlinks: [], keywords: []}});
                return Promise.resolve();
            }};
            return defaults;
        },
    });
    const element = {classList: {add: noop, remove: noop}, getAttribute: () => "", setAttribute: noop};
    const protyle = {
        wysiwyg: {element}, element, options: {}, lute: new Proxy({}, {get: () => noop}),
        contentElement: {scrollTop: 0}, block: {rootID: "root"},
        preview: {element: {classList: {contains: () => true}}},
    } as unknown as IProtyle;
    return {...exports, protyle, getDoc: () => doc, finishBacklink: () => finishBacklink()};
};

test("sync reload waits for the actual document render and reports rendering errors", async () => {
    const reload = loadReload();
    let done = false;
    const pending = reload.reloadProtyleAndWait(reload.protyle).then(() => done = true);
    await Promise.resolve();
    assert.equal(done, false);
    reload.getDoc().cb([]);
    await pending;
    const failed = reload.reloadProtyleAndWait(reload.protyle);
    reload.getDoc().onRenderError();
    await assert.rejects(failed, /Could not refresh/);
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
