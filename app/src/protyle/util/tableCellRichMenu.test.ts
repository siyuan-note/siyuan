import * as assert from "node:assert/strict";
import {test} from "node:test";
import {TABLE_CELL_SLASH_IDS} from "./tableCellRichMenu";

test("table cell menus retain inline insertion and formatting without unsupported block commands", () => {
    for (const id of ["newFileRef", "ref", "assets", "insertAsset", "insertIOSPhotos", "insertImgURL",
        "bold", "italic", "inlineMath", "infoStyle", "successStyle", "warningStyle", "errorStyle", "clearFontStyle"]) {
        assert.ok(TABLE_CELL_SLASH_IDS.has(id), id);
    }
    for (const id of ["table", "database", "newSubDocRef", "blockEmbed", "html", "insertVideoURL", "insertAudioURL"]) {
        assert.equal(TABLE_CELL_SLASH_IDS.has(id), false, id);
    }
});
