import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {applyHTMLLocalAssetPaths, type IHTMLLocalAsset, isHTMLLocalAssetPath} from "./htmlLocalAssets";

describe("HTML local assets", () => {
    it("recognizes absolute paths without treating web and asset URLs as local", () => {
        assert.equal(isHTMLLocalAssetPath("file:///tmp/a.png"), true);
        assert.equal(isHTMLLocalAssetPath("C:\\Images\\a.png"), true);
        assert.equal(isHTMLLocalAssetPath("/tmp/a.png"), true);
        assert.equal(isHTMLLocalAssetPath("https://example.com/a.png"), false);
        assert.equal(isHTMLLocalAssetPath("//example.com/a.png"), false);
        assert.equal(isHTMLLocalAssetPath("assets/a.png"), false);
    });

    it("rewrites only successful paths by their input indexes", () => {
        const values = ["file:///tmp/a.png", "/tmp/b.pdf"];
        const assets = values.map((path, index) => ({
            element: {
                setAttribute(_attribute: string, value: string) {
                    values[index] = value;
                },
            } as Element,
            attribute: index === 0 ? "src" : "href",
            path,
        })) as IHTMLLocalAsset[];

        applyHTMLLocalAssetPaths(assets, [undefined, "assets/b.pdf"]);

        assert.deepEqual(values, ["file:///tmp/a.png", "assets/b.pdf"]);
    });
});
