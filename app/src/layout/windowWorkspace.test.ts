import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("窗口布局保存各页签独立阅读位置并沿用加密页签过滤", () => {
    const compiled = transpileModule(readFileSync("src/layout/util.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    class Layout {
        direction = "lr";
        children: unknown[] = [];
    }
    class Wnd {
        element = {style: {}};
        children: unknown[] = [];
    }
    class Editor {
        editor: any;
        constructor(public options: any) {
            this.editor = {protyle: options.protyle};
        }
    }
    class Tab {
        title = "Document";
        headElement = {classList: {contains: () => false}, getAttribute: () => "1"};
        constructor(public model: Editor) {}
    }
    let detached = true;
    const dependencies = {
        Layout, Wnd, Tab, Editor,
        Asset: class {}, Backlink: class {}, Bookmark: class {}, Files: class {},
        Graph: class {}, Outline: class {}, Tag: class {}, Search: class {}, Custom: class {},
        Constants: {CB_GET_SCROLL: "scroll", CB_GET_ALL: "all", CB_GET_FOCUS: "focus"},
        isWindow: () => detached,
        isPhablet: () => false,
        isEncryptedBox: (id: string) => id === "encrypted",
        saveScroll: (protyle: any, getObject: boolean) => {
            assert.equal(getObject, true);
            return protyle.scroll;
        },
    };
    const api = {} as {layoutToJSON: (layout: unknown, json: object) => void,
        newModelByInitData: (app: object, tab: Tab, json: object) => Editor};
    runInNewContext(compiled, {exports: api, require: () => dependencies});
    const makeTab = (position: number, notebookId = "plain") => new Tab(new Editor({protyle: {
        notebookId,
        block: {id: "zoomed-block", rootID: "doc", showAll: true},
        preview: {element: {classList: {contains: () => true}}},
        element: {dataset: {}},
        scroll: {rootId: "doc", zoomInId: "zoomed-block", scrollTop: position},
    }}));
    const root = new Layout();
    const wnd = new Wnd();
    root.children = [wnd];
    wnd.children = [makeTab(100), makeTab(500), makeTab(900, "encrypted")];
    const json: any = {};
    api.layoutToJSON(root, json);
    assert.equal(json.children[0].children.length, 2);
    const tabs = json.children[0].children;
    assert.equal(tabs[0].children.scrollAttr.scrollTop, 100);
    assert.equal(tabs[1].children.scrollAttr.scrollTop, 500);
    assert.equal(tabs[0].children.action, "scroll");
    assert.equal(JSON.stringify(json).includes("encrypted"), false);
    const editor = api.newModelByInitData({}, wnd.children[0] as Tab, tabs[0].children);
    assert.equal(editor.options.scrollAttr.scrollTop, 100);
    assert.equal(editor.options.scrollAttr.zoomInId, "zoomed-block");
    detached = false;
    const mainJSON: any = {};
    api.layoutToJSON(root, mainJSON);
    assert.equal(mainJSON.children[0].children[0].children.scrollAttr, undefined);
});
