import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {getCardFieldsClass} from "./gallery/cardLayout";

const rowModule = {} as typeof import("./row");
const source = readFileSync(join(__dirname, "row.ts"), "utf8");
runInNewContext(transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText, {
    exports: rowModule,
    require: (id: string) => ({
        "./gallery/cardLayout": {getCardFieldsClass},
        "./cover": {getCardCoverSource: () => ""},
        "./conditionalColor": {getConditionalItemStyle: () => ""},
        "./entryIcon": {getAVCellShowIcon: () => false},
        "./col": {getColIconByType: () => "iconA"},
        "./cell": {cellValueIsEmpty: () => false, renderCell: () => "Primary value"},
        "../../../util/escape": {escapeAttr: (value: string) => value, escapeHtmlTextAndAttr: (value: string) => value},
    }[id] ?? {}),
    window: {siyuan: {languages: {openBy: "Open", more: "More", displayEmptyFields: "Show empty fields"}}},
});

test("a kanban card keeps its preview and entry action when its primary field is hidden", () => {
    const data = {
        fields: [{type: "block", id: "title", name: "Title", hidden: true}],
        coverFrom: 1,
        cardLayout: 0,
        displayEmptyFields: true,
    } as IAVKanban;
    const row = {id: "item", coverContent: "Content preview", values: [
        {id: "value", valueType: "block", value: {type: "block"}},
    ]} as IAVGalleryItem;
    const render = () => rowModule.getRowHTML({type: "kanban", row, data, rowIndex: 0});

    const hidden = render();
    assert.match(hidden, /Content preview/);
    assert.match(hidden, /data-type="av-gallery-open"/);
    assert.match(hidden, /av__gallery-fields fn__none/);
    assert.doesNotMatch(hidden, /data-field-id="title"|av__gallery-item--empty/);

    row.coverContent = "";
    assert.match(render(), /av__gallery-item--empty/);
    assert.match(render(), /data-type="av-gallery-open"/);

    data.fields[0].hidden = false;
    const shown = render();
    assert.match(shown, /data-field-id="title"/);
    assert.doesNotMatch(shown, /av-gallery-open|av__gallery-item--empty/);
});
