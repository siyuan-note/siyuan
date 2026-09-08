import * as assert from "node:assert/strict";
import {test} from "node:test";
import {parseProviderHeaders} from "./aiProviderHeaders";

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
