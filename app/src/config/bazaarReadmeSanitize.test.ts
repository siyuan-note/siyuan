import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {BAZAAR_README_ALLOWED_URI_REGEXP, BAZAAR_README_SANITIZE_OPTIONS} from "./bazaarReadmeSanitize";

describe("bazaarReadmeSanitize", () => {
    it("allows supported URI protocols", () => {
        [
            "https://example.com",
            "mailto:test@example.com",
            "siyuan://bazaar/themes/Whisper/readme",
            "web+siyuan://bazaar/themes/Whisper/readme",
            "/relative/path",
            "#heading",
        ].forEach((uri) => assert.equal(BAZAAR_README_ALLOWED_URI_REGEXP.test(uri), true, uri));
    });

    it("rejects dangerous and unsupported URI protocols", () => {
        [
            "javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "vbscript:msgbox(1)",
            "unknown://example.com",
        ].forEach((uri) => assert.equal(BAZAAR_README_ALLOWED_URI_REGEXP.test(uri), false, uri));
    });

    it("keeps embedded frames forbidden", () => {
        assert.deepEqual(BAZAAR_README_SANITIZE_OPTIONS.FORBID_TAGS, ["iframe", "frame", "frameset"]);
        assert.equal("ALLOW_UNKNOWN_PROTOCOLS" in BAZAAR_README_SANITIZE_OPTIONS, false);
    });
});
