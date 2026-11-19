import * as assert from "node:assert/strict";
import {test} from "node:test";
import {getBlockLinkID, isNodeID} from "./nodeID";

test("node IDs match the kernel's ASCII timestamp and lowercase alphanumeric suffix rules", () => {
    for (const id of ["20261118000000-abcdefg", "00000000000000-0123456", "99999999999999-a0b1c2z"]) {
        assert.equal(isNodeID(id), true, id);
        assert.equal(getBlockLinkID(`siyuan://blocks/${id}`), id);
    }
    for (const id of [null, undefined, 123, "", "2026111800000-abcdefg", "202611180000000-abcdefg",
        "20261118000000abcdefg", "20261118000000-abcdef", "20261118000000-abcdefgh",
        "20261118000000-Abcdefg", "20261118000000-abc_def", "20261118000000-abc-def",
        "2026111800000a-abcdefg", "２０２６１１１８００００００-abcdefg", "20261118000000-abcdef中",
        "20261118000000-abcdefg\n", "20261118000000-abcdefg?focus=1"]) {
        assert.equal(isNodeID(id), false, String(id));
        assert.equal(getBlockLinkID(`siyuan://blocks/${id}`), undefined);
    }
});

test("reference conversion accepts only a complete block link", () => {
    const id = "20261118000000-a0b1c2z";
    for (const link of [null, undefined, id, `web+siyuan://blocks/${id}`, `https://blocks/${id}`,
        `siyuan://blocks/${id}?avItemID=${id}`, `siyuan://blocks/${id}#anchor`, `siyuan://blocks/${id}/child`]) {
        assert.equal(getBlockLinkID(link), undefined, String(link));
    }
});
