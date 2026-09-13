import * as assert from "node:assert/strict";
import {test} from "node:test";
import {ContractFormData} from "./contractFormData";

test("serializes typed upload fields without trimming passwords or adding omitted values", async () => {
    const data = new ContractFormData({file: new Blob(["backup"]), password: " secret ", omitted: undefined});
    assert.equal(data.get("password"), " secret ");
    assert.equal(data.has("omitted"), false);
    const file = data.get("file");
    assert.ok(file instanceof Blob);
    assert.equal(await file.text(), "backup");
    assert.ok(data instanceof FormData);
});
