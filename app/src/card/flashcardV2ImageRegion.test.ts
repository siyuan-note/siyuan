import * as assert from "node:assert/strict";
import {test} from "node:test";
import {flashcardImageOCRRegions} from "./flashcardV2ImageRegion";

test("OCR imports normalized word boxes and ignores blank or non-image rows", () => {
    assert.deepEqual(flashcardImageOCRRegions([
        {level: "1", page_num: "1", width: "200", height: "100"},
        {level: "4", page_num: "1", left: "0", top: "0", width: "30", height: "30", text: "Heading"},
        {level: "5", page_num: "1", left: "50", top: "25", width: "50", height: "25", text: "Term"},
        {level: "5", page_num: "1", left: "5", top: "5", width: "10", height: "10", text: " "},
        {level: "5", page_num: "2", left: "5", top: "5", width: "10", height: "10", text: "Another page"},
        null,
    ], 400, 200), [{x: .25, y: .25, width: .25, height: .25}]);
});
