import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/wysiwyg/touchReference.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = (options: {reference?: string, uri?: any, selection?: string, root?: boolean} = {}) => {
    const exports: any = {};
    const calls: string[] = [];
    let opened: any;
    const dependencies = {
        Constants: {CB_GET_HL: "highlight"},
        openFileById: (value: any) => { calls.push("open"); opened = value; },
        pushBackByClick: () => calls.push("record"),
        saveBackScroll: () => calls.push("save"),
        hideElements: () => calls.push("hide"),
        processSiYuanUri: () => calls.push("uri"),
        checkFold: (_id: string, callback: any) => callback(true, ["all"], options.root),
        parseSiYuanUriInfo: () => options.uri,
        hasClosestByAttribute: (_target: any, _name: string, type: string) => type === "block-ref" ?
            options.reference && {getAttribute: () => options.reference} : {getAttribute: () => "siyuan://blocks/target"},
    };
    runInNewContext(compiled, {
        exports,
        require: () => dependencies,
        window: {getSelection: () => ({toString: () => options.selection || ""})},
    });
    const result = exports.openTouchReference({app: "app"}, {}, {x: 10, y: 20});
    return {result, calls, opened};
};

test("touch references and internal links save the source before opening a folded target", () => {
    for (const options of [{reference: "target"}, {uri: {id: "target"}}]) {
        const f = fixture(options);
        assert.equal(f.result, true);
        assert.deepEqual(f.calls, ["record", "save", "hide", "open"]);
        assert.equal(f.opened.id, "target");
        assert.equal(f.opened.zoomIn, true);
        assert.equal(f.opened.scrollPosition, "start");
        assert.deepEqual(Array.from(f.opened.action), ["all", "highlight"]);
    }
});

test("document links and attribute-view links retain their navigation behavior", () => {
    const root = fixture({uri: {id: "target"}, root: true});
    assert.deepEqual(Array.from(root.opened.action), ["all"]);
    const av = fixture({uri: {id: "target", avItemID: "row"}});
    assert.deepEqual(av.calls, ["record", "save", "hide", "uri"]);
});

test("text selection, ordinary text and external or invalid links do not navigate", () => {
    for (const options of [{selection: "selected", reference: "target"}, {}, {uri: null}]) {
        const f = fixture(options);
        assert.equal(f.result, false);
        assert.deepEqual(f.calls, []);
    }
});
