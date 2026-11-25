import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = readFileSync(__dirname + "/util.ts", "utf8");
const code = transpileModule(source.slice(source.indexOf("export const getArticle ="),
    source.indexOf("export const replace =")), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

test("search preview applies query, attributes and rich title only after document navigation completes", () => {
    const callbacks: Array<(response: unknown) => void> = [];
    let render: {beforeAVRender: () => void, afterCB: () => void, isValid: () => boolean};
    const applied: string[] = [];
    let current = true;
    const protyle = {notebookId: "box", scroll: {lastScrollTop: 3}, query: {key: "old"},
        contentElement: {classList: {add() {}, remove() {}}}, options: {render: {title: true}},
        title: {render: () => applied.push("title")}, wysiwyg: {renderCustom: () => applied.push("attributes")}};
    const api: {getArticle?: (options: unknown) => void} = {};
    runInNewContext(code, {exports: api,
        window: {siyuan: {config: {editor: {dynamicLoadBlocks: 128}}}}, Constants: {CB_GET_HTML: "html"},
        beginSearchPreviewRequest: () => () => current,
        checkFold: (_id: string, callback: (zoom: boolean) => void) => callback(false),
        addLoading: () => {}, isEncryptedBox: () => false, isSupportCSSHL: () => true,
        fetchPost: (_url: string, _data: unknown, callback: typeof callbacks[number]) => callbacks.push(callback),
        onGet: (options: typeof render) => { render = options; },
    });
    api.getArticle({id: "new-root", edit: {protyle}, value: "new"});
    callbacks[0]({code: 0, data: {ial: {title: "New title"}}});
    callbacks[1]({code: 0, data: {rootID: "new-root"}});
    assert.equal(protyle.query.key, "old");
    assert.deepEqual(applied, []);
    render.beforeAVRender();
    assert.equal(protyle.query.key, "new");
    assert.deepEqual(applied, ["attributes"]);
    render.afterCB();
    assert.deepEqual(applied, ["attributes", "title"]);
    assert.equal(render.isValid(), true);
    current = false;
    assert.equal(render.isValid(), false);
});

test("search preview reveals only the current result after positioning or a render error", async () => {
    type Preview = {beforeAVRender: () => void, afterAVRender: () => Promise<void>, onAVRenderError: () => void};
    const responses: Array<(response: unknown) => void> = [];
    const previews: Preview[] = [];
    const positions: Array<() => void> = [];
    const classes = new Set<string>();
    const calls: string[] = [];
    const ranges: Range[] = [];
    let request = 0;
    const protyle = {
        scroll: {lastScrollTop: 0}, options: {render: {title: false}},
        contentElement: {
            classList: {
                add: (name: string) => classes.add(name),
                remove: (name: string) => { calls.push("show"); classes.delete(name); },
            },
            getBoundingClientRect: () => ({top: 0, height: 200}),
        },
        highlight: {ranges},
    };
    const api: {getArticle?: (options: unknown) => void} = {};
    runInNewContext(code, {exports: api,
        window: {siyuan: {config: {editor: {dynamicLoadBlocks: 128}}}}, Constants: {CB_GET_HTML: "html"},
        beginSearchPreviewRequest: () => {
            const id = ++request;
            return () => request === id;
        },
        checkFold: (_id: string, callback: (zoom: boolean) => void) => callback(false),
        addLoading: () => {}, isEncryptedBox: () => false, isSupportCSSHL: () => true,
        fetchPost: (_url: string, _data: unknown, callback: typeof responses[number]) => responses.push(callback),
        onGet: (preview: Preview) => previews.push(preview),
        locateSearchAVPreview: async (): Promise<undefined> => undefined,
        searchMarkRender: (_owner: unknown, _keywords: string[], _id: string, position: () => void) => positions.push(position),
        highlightById: (_owner: unknown, id: string) => {
            assert.ok(classes.has("fn__hidden"));
            calls.push("position " + id);
        },
        ResizeObserver: class { observe() {} disconnect() {} },
        setTimeout: () => {},
    });
    Object.assign(protyle, {wysiwyg: {element: {}}});
    const preview = async (id: string) => {
        api.getArticle({id, edit: {protyle}});
        responses.at(-1)({code: 0, data: {ial: {}}});
        responses.at(-1)({code: 0, data: {keywords: ["match"]}});
        const result = previews.at(-1);
        result.beforeAVRender();
        await result.afterAVRender();
        assert.ok(classes.has("fn__hidden"));
        return result;
    };
    const first = await preview("first");
    await preview("next");
    first.onAVRenderError();
    positions[0]();
    assert.ok(classes.has("fn__hidden"));
    assert.deepEqual(calls, []);
    positions[1]();
    assert.equal(classes.has("fn__hidden"), false);
    assert.deepEqual(calls, ["position next", "show"]);

    const failed = await preview("failed");
    failed.onAVRenderError();
    assert.equal(classes.has("fn__hidden"), false);
});
