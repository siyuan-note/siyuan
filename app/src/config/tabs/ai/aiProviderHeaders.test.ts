import * as assert from "node:assert/strict";
import {test} from "node:test";
import {hasProviderHeaderAuth, parseProviderHeaders} from "./aiProviderHeaders";

test("provider authentication headers replace the API key requirement", () => {
    for (const name of ["Authorization", "authorization", "X-API-Key", "api-key"]) {
        assert.equal(hasProviderHeaderAuth({[name]: "{{secrets.API_KEY}}"}), true);
        assert.equal(hasProviderHeaderAuth({[name]: "  "}), false);
    }
    assert.equal(hasProviderHeaderAuth({"User-Agent": "SiYuan", "X-Route": "test"}), false);
    assert.equal(hasProviderHeaderAuth(), false);
});

test("provider headers accept empty configuration and string values", () => {
    assert.deepEqual(parseProviderHeaders(" "), {});
    assert.deepEqual(parseProviderHeaders('{"Authorization":"Bearer key","X-Route":""}'), {
        Authorization: "Bearer key", "X-Route": "",
    });
});

test("provider headers reject malformed values, injection and case-insensitive duplicates", () => {
    for (const value of ["null", "[]", "1", "{", '{"X-Key":1}', '{"Bad Name":"key"}',
        '{"X-Key":"a","x-key":"b"}', '{"X-Key":"key\\r\\ninjected: true"}']) {
        assert.equal(parseProviderHeaders(value), null, value);
    }
});
