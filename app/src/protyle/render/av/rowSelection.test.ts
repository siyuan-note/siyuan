import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const createClassList = () => {
    const values = new Set<string>();
    return {add: (value: string) => values.add(value), remove: (value: string) => values.delete(value),
        contains: (value: string) => values.has(value)};
};

const createSelection = (viewType: TAVView, virtual: boolean) => {
    const count = {textContent: ""};
    const views = {classList: createClassList(), closest: () => block,
        querySelector: () => count};
    const block = {
        getAttribute: (name: string) => name === "data-av-type" ? viewType : null,
        querySelectorAll: (selector: string) => selector === ".av__body" ? bodies : [views],
    };
    const bodies = ["first", "second"].map(groupID => {
        const icon = {value: "", setAttribute: (_name: string, value: string) => { icon.value = value; }};
        const header = {classList: createClassList(), querySelector: () => icon};
        const selected = virtual ? [] : ["parent", "child"].map(id => ({dataset: {id}}));
        return {
            dataset: {groupId: groupID}, firstElementChild: header, icon,
            closest: () => block, querySelector: (): null => null,
            querySelectorAll: () => selected,
        };
    });
    const dependencies: Record<string, unknown> = {
        "../../../constants": {Constants: {ATTRIBUTE_V_SCROLL: "data-v-scroll"}},
        "./viewType": {isTableLikeView: (value: string) => value === "table" || value === "list"},
        "../../util/hasClosest": {hasClosestByClassName: (element: {closest: () => unknown}) => element.closest()},
    };
    const load = <T>(name: string) => {
        const exports = {} as T;
        runInNewContext(transpileModule(readFileSync(`src/protyle/render/av/${name}.ts`, "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
        }).outputText, {
            exports, window: {siyuan: {languages: {selected: "selected"}}},
            require: (dependency: string) => dependencies[dependency] || {},
        });
        dependencies["./" + name] = exports;
        return exports;
    };
    load<typeof import("./selectionState")>("selectionState");
    const scroll = load<typeof import("./virtualScroll")>("virtualScroll");
    const row = load<typeof import("./row")>("row");
    const blockElement = block as unknown as HTMLElement;
    if (virtual) {
        // 分组快照包含已加载但未挂载的行，模拟虚拟窗口裁掉选中行后的状态。
        const groups: IAVTable[] = [
            {id: "first", columns: [], rowCount: 2, rows: [{id: "parent", cells: []}, {id: "child", cells: []}]},
            {id: "second", columns: [], rowCount: 3, rows: [{id: "parent", cells: []}, {id: "child", cells: []}, {id: "other", cells: []}]},
        ];
        scroll.initVirtualScroll({blockElement, protyle: {} as IProtyle, data: {
            id: "database", name: "Database", viewID: "view", views: [],
            viewType,
            view: {columns: [], rows: [], rowCount: 3, groups},
        }, selectedItemPoints: bodies.flatMap(body => ["parent", "child"].map(itemID =>
            ({itemID, groupID: body.dataset.groupId})))});
    }
    return {count, views, bodies, blockElement, scroll, update: () => row.updateAVSelectionStatus(blockElement)};
};

for (const viewType of ["table", "list"] as const) {
    test(`${viewType} selection counts unique items across groups and retains virtual selection`, () => {
        const fixture = createSelection(viewType, true);
        fixture.update();
        assert.equal(fixture.count.textContent, "2 selected");
        assert.equal(fixture.views.classList.contains("av__views--selection"), true);
        assert.equal(fixture.bodies[0].icon.value, "#iconCheck");
        assert.equal(fixture.bodies[1].icon.value, "#iconIndeterminateCheck");

        fixture.scroll.resetAVRowSelect(fixture.bodies[0] as unknown as HTMLElement, []);
        fixture.update();
        assert.equal(fixture.count.textContent, "2 selected");
        assert.equal(fixture.bodies[0].icon.value, "#iconUncheck");
        assert.equal(fixture.bodies[1].icon.value, "#iconIndeterminateCheck");

        fixture.scroll.resetAVRowSelect(fixture.bodies[1] as unknown as HTMLElement, []);
        fixture.update();
        assert.equal(fixture.count.textContent, "");
        assert.equal(fixture.views.classList.contains("av__views--selection"), false);
    });
}

for (const viewType of ["gallery", "kanban"] as const) {
    test(`${viewType} selection counts duplicate group instances once without virtual state`, () => {
        const fixture = createSelection(viewType, false);
        fixture.update();
        assert.equal(fixture.count.textContent, "2 selected");
    });
}
