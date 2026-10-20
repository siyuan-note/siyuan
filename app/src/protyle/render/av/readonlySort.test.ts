import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("locked sorting uses checked field submenus, refreshes without transactions and rejects stale clicks", () => {
    const api = {} as typeof import("./readonlySort");
    const items: IMenu[] = [];
    let renders = 0;
    let viewID = "view";
    let sort: IAVSort = {column: "created", order: "DESC"};
    const protyle = {disabled: true} as IProtyle;
    const data = {viewID: "view"} as IAV;
    const element = {removeAttribute: () => {}} as unknown as HTMLElement;
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/readonlySort.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {
        exports: api,
        window: {siyuan: {languages: {asc: "Ascending", desc: "Descending", avRestoreDefaultSort: "Restore"}}},
        require: (name: string) => {
            const mocks: Record<string, unknown> = {
                "../../../plugin/Menu": {Menu: class {
                    addItem(item: IMenu) { items.push(item); }
                    addSeparator() {}
                    open() {}
                }},
                "../../../menus/menuToggle": {toggleMenu: (options: {build: () => void}) => options.build()},
                "./capabilities": {hasAVCapability: (type: string) => type !== "lineNumber"},
                "./col": {getColIconByType: () => "iconClock"},
                "./readonlyState": {
                    canUseReadonlyAVSort: () => protyle.disabled,
                    getReadonlyAVSort: () => sort,
                    setReadonlyAVSort: (_element: HTMLElement, _view: string, value: IAVSort) => { sort = value; },
                },
                "./render": {avRender: () => { renders++; }},
                "./virtualScroll": {getAVData: () => data},
                "./view": {getFieldsByData: () => [{id: "created", type: "created", name: "Created"},
                    {id: "updated", type: "updated", name: "Updated"}, {id: "line", type: "lineNumber"}]},
                "./viewVisibility": {getAVCurrentViewID: () => viewID},
            };
            assert.ok(name in mocks, `unexpected dependency: ${name}`);
            return mocks[name];
        },
    });
    api.openReadonlyAVSortMenu(element, protyle, {getBoundingClientRect: () => ({})} as HTMLElement);
    assert.equal(items.length, 4);
    assert.equal(items[1].type, "submenu");
    assert.equal(items[1].submenu[1].checked, true);
    items[2].submenu[0].click(element, undefined);
    assert.equal(sort.column, "updated");
    assert.equal(sort.order, "ASC");
    assert.equal(renders, 1);
    items[3].click(element, undefined);
    assert.equal(sort, undefined);
    assert.equal(renders, 2);
    protyle.disabled = false;
    items[1].submenu[0].click(element, undefined);
    protyle.disabled = true;
    viewID = "other";
    items[1].submenu[0].click(element, undefined);
    assert.equal(renders, 2);
});
