import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {genNetworkImageAssetValue} from "./assetValue";

describe("genNetworkImageAssetValue", () => {
    it("accepts HTTP(S) image links without relying on file extensions", () => {
        assert.deepEqual(genNetworkImageAssetValue(" https://example.com/image?id=1 "), {
            type: "image",
            name: "",
            content: "https://example.com/image?id=1",
        });
        assert.deepEqual(genNetworkImageAssetValue("http://example.com/image"), {
            type: "image",
            name: "",
            content: "http://example.com/image",
        });
    });

    it("rejects empty, relative, Base64, and non-HTTP(S) links", () => {
        [
            "",
            "assets/image.png",
            "data:image/png;base64,AAAA",
            "file:///tmp/image.png",
            "ftp://example.com/image.png",
            "not a URL",
        ].forEach(item => assert.equal(genNetworkImageAssetValue(item), undefined));
    });
});
