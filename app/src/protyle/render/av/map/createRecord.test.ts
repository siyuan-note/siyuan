import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as closest from "../../../util/hasClosest";
import * as escape from "../../../../util/escape";
import {DOMFixture, requireFixture} from "./testDOM";

const compile = (path: string) => transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
}).outputText;
const actionSource = compile("src/protyle/render/av/action.ts");
const templateSource = compile("src/protyle/render/av/newItemTemplate.ts");

const setup = (type: string, layout: string, templateID = "") => {
    const document = new DOMFixture();
    const block = document.createElement("div");
    block.dataset.type = "NodeAttributeView";
    block.dataset.avId = "database";
    block.dataset.nodeId = "carrier";
    block.dataset.avType = layout;
    block.setAttribute("custom-sy-av-view", "view");
    block.innerHTML = `<div class="av__header" data-default-template-id="${templateID}"></div>
        <div class="av__body" data-group-id=""><button data-type="${type}"><span>Create</span></button></div>`;
    document.body.append(block);
    const requests: Array<{templateID: string; previousID: string; groupID: string; avID: string; blockID: string; viewID: string}> = [];
    const opened: Array<{itemID: string; focusPrimary: boolean}> = [];
    const insertions: Array<{previousID: string; groupID: string}> = [];
    const messages: string[] = [];
    let callback: (response: unknown) => void;
    let rendered = 0;
    const modules: Record<string, unknown> = {};
    // 只允许已知但本入口不应调用的依赖；新增依赖或意外走入其他业务路径均立即失败。
    for (const id of ["./viewType", "../../../plugin/Menu", "../../wysiwyg/transaction", "../../../menus/util",
        "../../../menus/commonMenuItem", "./cell", "./col", "../../../plugin/EventBus", "./openMenuPanel",
        "../../hint/extend", "../../util/selection", "../../util/selectionOffsets", "../../preview/image",
        "../../../emoji", "dayjs", "./calc", "./view", "./rangeSelect", "./relation", "../../ui/hideElements",
        "../../../util/highlightById", "./gallery/util", "../../util/clear", "../../../util/image",
        "../../../mobile/util/mobileAppUtil", "./kanban/groupMenu", "./groupFold", "./publishState",
        "./readonlyState", "./batchEdit", "../../../util/functions", "./viewVisibility",
        "./cellValue", "./blockIcon", "./itemLink", "../../../editor/openLink", "./richText", "../../../search/util",
        "../../../mobile/menu/search", "../../../mobile/util/keyboardToolbar", "./capabilities", "./fieldValueEditor",
        "./locationValue", "../../../dialog", "../../../menus/Menu", "../../../util/upDownHint",
        "../../../mobile/util/bindBottomSheetDialog"]) {
        modules[id] = new Proxy({}, {get: (_target, name: string) => assert.fail(`Unexpected dependency call: ${id}.${name}`)});
    }
    Object.assign(modules, {
        "../../util/hasClosest": closest,
        "../../util/compatibility": {isOnlyMeta: () => false},
        "./attributeValue": {getAVTemplateInteractiveElement: () => null},
        "./coverPosition": {isCardCoverPositioning: () => false},
        "./row": {insertRows: (position: typeof insertions[number]) => insertions.push(position)},
        "./virtualScroll": {getAvBodyData: () => ({rows: [{id: "previous-row"}]})},
        "./calendar/state": {getCalendarCreationDate: () => undefined},
        "../../../constants": {Constants: {CUSTOM_SY_AV_VIEW: "custom-sy-av-view"}},
        "../../../util/escape": escape,
        "../../../dialog/message": {showMessage: (message: string) => messages.push(message)},
        "../../../util/fetch": {fetchPost: (url: string, payload: typeof requests[number], response: typeof callback) => {
            assert.equal(url, "/api/av/createAttributeViewItem");
            requests.push(payload);
            callback = response;
        }},
        "./render": {avRender: () => { rendered++; }},
        "./openDatabaseRow": {openDatabaseRowByData: (_protyle: unknown, record: typeof opened[number]) => opened.push(record)},
    });
    const context = {document, require: requireFixture(modules), window: {siyuan: {languages: {
        newItemTemplateUnavailableNotebookTip: "Unavailable notebook", untitled: "Untitled",
    }}}};
    const template = {} as typeof import("../newItemTemplate");
    runInNewContext(templateSource, {...context, exports: template});
    modules["./newItemTemplate"] = template;
    const action = {} as typeof import("../action");
    runInNewContext(actionSource, {...context, exports: action});
    const protyle = {app: {appId: "app"}, id: "editor", notebookId: "notebook", options: {}} as IProtyle;
    return {requests, opened, insertions, messages, protyle, block, rendered: () => rendered,
        click: () => action.avClick(protyle, {target: block.querySelector("span"), preventDefault() {}, stopPropagation() {}} as unknown as MouseEvent & {target: HTMLElement}),
        respond: (response: unknown = {code: 0, data: {itemID: "new-record", content: "New record", isDetached: true}}) => callback(response)};
};

for (const type of ["av-add-more", "av-add-bottom"]) {
    test(`map ${type} dispatches through avClick and opens created records with optional templates`, () => {
        for (const layout of ["map", "table"]) {
            for (const templateID of ["", "template-id"]) {
                const scenario = setup(type, layout, templateID);
                assert.equal(scenario.click(), true);
                assert.equal(scenario.opened.length, 0);
                if (layout === "table" && !templateID) {
                    assert.equal(scenario.insertions.length, 1);
                    assert.equal(scenario.requests.length, 0);
                    assert.equal(scenario.insertions[0].previousID, type === "av-add-bottom" ? "previous-row" : "");
                } else {
                    assert.equal(scenario.insertions.length, 0);
                    assert.equal(scenario.requests.length, 1);
                    const request = scenario.requests[0];
                    assert.equal(request.templateID, templateID);
                    assert.equal(request.previousID, type === "av-add-bottom" ? "previous-row" : "");
                    assert.equal(request.groupID, "");
                    assert.equal(request.avID, "database");
                    assert.equal(request.blockID, "carrier");
                    assert.equal(request.viewID, "view");
                    scenario.respond();
                    assert.equal(scenario.rendered(), 1);
                }
                assert.equal(scenario.opened.length, layout === "map" ? 1 : 0);
                if (layout === "map") {
                    assert.equal(scenario.opened[0].itemID, "new-record");
                    assert.equal(scenario.opened[0].focusPrimary, true);
                }
            }
        }
    });
}

test("disabled map creation actions cannot issue requests or insert records", () => {
    for (const type of ["av-add-more", "av-add-bottom"]) {
        const scenario = setup(type, "map");
        scenario.protyle.disabled = true;
        assert.equal(scenario.click(), false);
        assert.equal(scenario.requests.length, 0);
        assert.equal(scenario.insertions.length, 0);
    }
});

test("failed map record creation cannot open a detail and preserves unavailable-notebook feedback", () => {
    for (const unavailableNotebook of [false, true]) {
        const scenario = setup("av-add-more", "map", "template-id");
        scenario.click();
        scenario.respond({code: 1, data: {unavailableNotebook}});
        assert.equal(scenario.opened.length, 0);
        assert.deepEqual(scenario.messages, unavailableNotebook ? ["Unavailable notebook"] : []);
        assert.equal(scenario.rendered(), unavailableNotebook ? 0 : 1);
    }
});
