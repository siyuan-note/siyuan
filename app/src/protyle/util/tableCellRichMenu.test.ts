import * as assert from "node:assert/strict";
import {test} from "node:test";
import {filterTableCellSlashMenuItems, TABLE_CELL_SLASH_IDS} from "./tableCellRichMenu";

test("table cell menus retain inline insertion and formatting without unsupported block commands", () => {
    for (const id of ["newFileRef", "ref", "assets", "insertAsset", "insertIOSPhotos", "insertImgURL",
        "bold", "italic", "inlineMath", "infoStyle", "successStyle", "warningStyle", "errorStyle", "clearFontStyle"]) {
        assert.ok(TABLE_CELL_SLASH_IDS.has(id), id);
    }
    for (const id of ["table", "database", "newSubDocRef", "blockEmbed", "html", "insertVideoURL", "insertAudioURL"]) {
        assert.equal(TABLE_CELL_SLASH_IDS.has(id), false, id);
    }
});

test("table cell filtering retains groups and removes separators around excluded commands", () => {
    const item = (id: string): IHintData => ({id, value: id, html: id});
    const separator: IHintData = {value: "", html: "separator"};
    const items = filterTableCellSlashMenuItems([separator, item("table"), separator, item("ref"),
        separator, item("database"), separator, item("insertAsset"), separator]);
    assert.deepEqual(items.map(item => item.html), ["ref", "separator", "insertAsset"]);
});
