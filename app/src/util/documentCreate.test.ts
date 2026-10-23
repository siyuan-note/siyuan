import * as assert from "node:assert/strict";
import {test} from "node:test";
import {createdDocumentID, documentCreateRequest, documentParentID} from "./documentCreate";

const notebook = "20261023000000-box0001";
const parent = "20261023000001-parent1";
const id = "20261023000002-newdoc1";

test("document creation keeps ID location and literal title independent", () => {
    assert.equal(documentParentID("/"), null);
    assert.equal(documentParentID(`/${parent}.sy`), parent);
    assert.equal(documentParentID(`/${notebook}/${parent}.sy`), parent);
    assert.deepEqual(documentCreateRequest(notebook, `/${parent}.sy`, id, "**A/B &amp;**", "Body"), {
        notebook, parentID: parent, id, title: {format: "plain", text: "**A/B &amp;**"}, markdown: "Body",
    });
    assert.equal(documentCreateRequest(notebook, "/", id, "").title.text, "");
    for (const value of ["", "/A/B", "../" + parent, `//${parent}.sy`, `/${parent}/`, `/${parent}/../${id}.sy`]) {
        assert.throws(() => documentParentID(value));
    }
});

test("creation callbacks use only confirmed source identities", () => {
    assert.equal(createdDocumentID({id, document: {id}}), id);
    assert.equal(createdDocumentID({id, commitState: "committed", stage: "template"}), id);
    for (const value of [null, {id}, {id, commitState: "none"}, {id, commitState: "unknown"}, {id: "invalid", document: {}}]) {
        assert.equal(createdDocumentID(value), undefined);
    }
});
