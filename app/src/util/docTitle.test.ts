import * as assert from "node:assert/strict";
import {test} from "node:test";
import {decodeDocTitle, DOC_TITLE_SLASH, encodeDocTitle, getDocTitleText, sanitizeDocTitleInput} from "./docTitle";
import {getNewDocTargetFromSavePath} from "./parseNewDocTarget";

test("document title slash stays inside one path segment", () => {
    const title = "Parent/One";
    assert.equal(encodeDocTitle(title), `Parent${DOC_TITLE_SLASH}One`);
    assert.equal(decodeDocTitle(encodeDocTitle(title)), title);
    assert.equal(getDocTitleText(title), title);
    assert.equal(getDocTitleText(`Parent${DOC_TITLE_SLASH}One.sy`), `Parent${DOC_TITLE_SLASH}One`);
    assert.equal(sanitizeDocTitleInput(title), title);
    assert.equal(sanitizeDocTitleInput(`Parent${DOC_TITLE_SLASH}One`), `Parent${DOC_TITLE_SLASH}One`);

    const target = getNewDocTargetFromSavePath({
        templatePath: "/",
        hPath: "/",
        targetNotebookId: "box",
        currentNotebookId: "box",
        name: title,
        hasFocusTarget: false,
    });
    assert.equal(target.kind, "hPath");
    if (target.kind === "hPath") {
        assert.equal(target.title, title);
        assert.equal(target.hPath, `/Parent${DOC_TITLE_SLASH}One`);
    }
});
