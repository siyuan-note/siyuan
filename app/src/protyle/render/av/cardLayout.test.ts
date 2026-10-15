import * as assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const fixture = () => {
    const calls: Array<{rowIndex: number, type: string}> = [];
    const saved: Record<string, unknown[]> = {};
    const record = (name: string) => (...args: unknown[]) => { (saved[name] ||= []).push(args); };
    const document = {activeElement: undefined as unknown};
    const jobs: Array<() => void> = [];
    const dependencies = {
        "../../../constants": {Constants: {ATTRIBUTE_V_SCROLL: "vscroll", TIMEOUT_LOAD: 1}},
        "../../util/hasClosest": {hasClosestByClassName: (item: {body: unknown}) => item.body},
        "../../util/selection": {focusBlock: record("focus")},
        "../../util/focusRestore": {getPendingBlockFocusMode: (): undefined => undefined},
        "./row": {
            getRowHTML: ({row, rowIndex, type}: {row: {id: string}, rowIndex: number, type: string}) => {
                calls.push({rowIndex, type});
                return `<article data-id="${row.id}" data-index="${rowIndex}" data-layout="${type}"></article>`;
            },
            stickyRow: record("sticky"), updateAVSelectionStatus: record("selection"), updateHeader: record("header"),
        },
        "./gallery/style": {getCardStyle: () => "card-style"},
        "./virtualScroll": {
            getAVSelectedItemPoints: () => [{groupID: "group", itemID: "selected"}],
            getBodyVirtualData: (_body: unknown, selector: string, index: number) => {
                assert.equal(selector, ".av__gallery-add");
                return {renderedStart: index, renderedEnd: index + 1};
            },
            initVirtualScroll: record("virtual"), setAVData: record("data"),
        },
        "../../util/processCode": {processRender: record("code")},
        "./richText": {renderAVRichTextElements: record("rich")},
        "./search": {bindAvSearch: record("search")},
        "./render": {updateSearch: record("updateSearch")},
        "./locate": {finishAVLocate: record("locate")},
    };
    const compiled = transpileModule(readFileSync("src/protyle/render/av/cardLayout.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const exports: Record<string, (...args: unknown[]) => any> = {};
    new Function("require", "exports", "window", "document", "getSelection", "setTimeout", compiled)(
        (name: keyof typeof dependencies) => {
            assert.ok(dependencies[name], "unexpected module: " + name);
            return dependencies[name];
        }, exports, {siyuan: {languages: {newRow: "new", loadMore: "more"}}}, document,
        () => ({rangeCount: 0}), (job: () => void) => { jobs.push(job); });
    return {api: exports, calls, saved, document, jobs};
};

test("card HTML preserves both layout baselines and virtual windows", () => {
    // 摘要取自重构前两份生成器，冻结大小、分页与虚拟窗口的完整 HTML。
    const hashes = {
        gallery: ["8b33413d1f62e7d4d750e83d1b9ff8641c916e283cf85760dbd59494885e9429",
            "74c516f745b1cf092151dad546d2fc4e45b6acb920ba643bf85628316529a1cd",
            "3a54cbfbfba4272be706ff7ac05bc9c8cc4c62f29d2b2de077c40250e922312d",
            "c634a59b9d368c6e09ddd2f8b8ba5b642c7b1514edfb2d5cb828a3761ffa757d",
            "f398bf302576f165a8a645b4506199e9e69d63e14bb4bb453950ea11ea2cf2d2"],
        kanban: ["7f0f04ddbe90be7b686f5eb2f6cdb8d07ba16107364df7b4bb69e92eb30d9aeb",
            "7f0f04ddbe90be7b686f5eb2f6cdb8d07ba16107364df7b4bb69e92eb30d9aeb",
            "7f0f04ddbe90be7b686f5eb2f6cdb8d07ba16107364df7b4bb69e92eb30d9aeb",
            "60059084cd0e141245b322e3e67f99b144c8c9deeba23353f5dd11d725ec558a",
            "d66910165ba9d54ac2761161a2cd72ef65c934787e50176e640f2a604cc0b988"],
    };
    for (const type of ["gallery", "kanban"] as const) {
        for (let index = 0; index < 5; index++) {
            const f = fixture();
            const count = index < 3 ? 3 : 105;
            const attributes: Record<string, string> = {};
            const virtual = index === 4 ? {renderedStart: 10, renderedEnd: 12, rowOffset: 20, topSpacerHeight: 100} : undefined;
            const html = f.api.getAVCardHTML(type, {cards: Array.from({length: count}, (_, i) => ({id: `row${i}`})),
                cardCount: count + 5, pageSize: index < 3 ? 10 : 200, cardSize: index < 3 ? index : 1},
                {setAttribute: (key: string, value: string) => { attributes[key] = value; }}, virtual);
            assert.equal(createHash("sha256").update(html).digest("hex"), hashes[type][index], `${type}: ${index}`);
            assert.deepEqual(f.calls.map(item => item.rowIndex), index === 4 ? [30, 31, 32] :
                Array.from({length: index < 3 ? 3 : 100}, (_, i) => i));
            assert.ok(f.calls.every(item => item.type === type));
            assert.deepEqual(attributes, index < 3 ? {} : {vscroll: "true"});
        }
    }
});

test("card state preserves group paging and ignores ghost or locate-only windows", () => {
    for (const type of ["gallery", "kanban"]) {
        const f = fixture();
        const search = {textContent: " query "};
        f.document.activeElement = search;
        const body = (id: string, ghost = false, locate = false) => ({
            dataset: {groupId: id, pageSize: "200", avLocateWindow: locate ? "true" : ""},
            getAttribute: () => id,
            querySelector: (selector: string) => selector.includes(":not") && ghost ? null :
                {getAttribute: () => "12"},
        });
        const blockElement = {
            style: {alignSelf: "start"}, getAttribute: () => "true",
            querySelector: (selector: string) => selector.includes("av-search") ? search : {scrollLeft: 17},
            querySelectorAll: (selector: string) => selector.includes("fields--edit") ?
                [{body: {dataset: {groupId: "group"}}, parentElement: {getAttribute: () => "edited"}}] :
                [body(""), body("ghost", true), body("locate", false, true)],
        };
        const state = f.api.captureAVCardRenderState({blockElement, protyle: {contentElement: {scrollTop: 42}}}, type);
        assert.deepEqual(state.editIds, [{groupId: "group", fieldId: "edited"}]);
        assert.deepEqual(state.selectItemIds, [{groupId: "group", fieldId: "selected"}]);
        assert.deepEqual(state.pageSizes, {unGroup: "200", ghost: "200", locate: "200"});
        assert.deepEqual(state.virtualData, {[type === "gallery" ? "all" : ""]: {renderedStart: 12, renderedEnd: 13}});
        assert.equal(state.query, " query ");
        assert.equal(state.isSearching, true);
        assert.equal(state.oldOffset, 42);
        assert.equal(state.alignSelf, "start");
        assert.equal(state.left, type === "kanban" ? 17 : undefined);
    }
});

test("card restoration retains viewport, callback and virtual selection before locate completion", () => {
    const f = fixture();
    const sizes: Record<string, string> = {};
    const scroller = {scrollLeft: 0};
    const blockElement = {
        style: {alignSelf: ""}, classList: {toggle: () => {}}, getAttribute: () => "",
        setAttribute: (name: string, value: string) => { sizes[name] = value; },
        querySelector: (selector: string) => selector === ".av__kanban" ? scroller :
            selector.includes(".av__body") ? {dataset: sizes} : null,
    };
    const protyle = {contentElement: {scrollTop: 0}};
    const data = {view: {displayEmptyFields: true, coverFrom: 0}};
    let callback = 0;
    f.api.afterRenderCards({blockElement, protyle, data, renderAll: false,
        cb: (received: unknown) => { assert.equal(received, data); callback++; },
        resetData: {oldOffset: 42, alignSelf: "start", left: 17, selectItemIds: [], editIds: [],
            pageSizes: {unGroup: "200"}, query: "query", isSearching: true, virtualData: {}},
    });
    assert.equal(protyle.contentElement.scrollTop, 42);
    assert.equal(blockElement.style.alignSelf, "start");
    assert.equal(scroller.scrollLeft, 17);
    assert.equal(sizes.pageSize, "200");
    assert.equal(sizes["data-render"], "true");
    assert.equal(callback, 1);
    assert.equal(f.saved.virtual.length, 1);
    assert.equal(f.saved.locate.length, 1);
    assert.equal(f.jobs.length, 0);
    assert.equal(f.saved.search, undefined);
});
