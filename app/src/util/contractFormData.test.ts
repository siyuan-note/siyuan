import * as assert from "node:assert/strict";
import {test} from "node:test";
import {ContractFormData} from "./contractFormData";

test("preserves repeated text and file entries under a dynamic channel name", async () => {
    const data = new ContractFormData({channel: [" first ", "second", new Blob(["file"])], empty: []});
    const values = data.getAll("channel");
    assert.equal(values.length, 3);
    assert.equal(values[0], " first ");
    assert.equal(values[1], "second");
    assert.ok(values[2] instanceof Blob);
    assert.equal(await values[2].text(), "file");
    assert.equal(data.has("empty"), false);
});

test("serializes typed upload fields without trimming passwords or adding omitted values", async () => {
    const data = new ContractFormData({file: new Blob(["backup"]), password: " secret ", omitted: undefined});
    assert.equal(data.get("password"), " secret ");
    assert.equal(data.has("omitted"), false);
    const file = data.get("file");
    assert.ok(file instanceof Blob);
    assert.equal(await file.text(), "backup");
    assert.ok(data instanceof FormData);
});
