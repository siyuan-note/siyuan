import * as assert from "node:assert/strict";
import test from "node:test";
import {getAssetsPreviewPath} from "./previewPath";

test("keeps regular asset preview paths unchanged", () => {
    assert.equal(getAssetsPreviewPath("assets/image.png"), "assets/image.png");
});

test("adds an exact data path for notebook and document asset previews", () => {
    assert.equal(
        getAssetsPreviewPath("assets/video.mp4", "20260821000000-abcdefg/20260821000001-hijklmn/assets/video.mp4"),
        "assets/video.mp4?dataPath=20260821000000-abcdefg%2F20260821000001-hijklmn%2Fassets%2Fvideo.mp4"
    );
});

test("preserves existing asset query parameters", () => {
    assert.equal(
        getAssetsPreviewPath("assets/image.png?thumbnail=256", "20260821000000-abcdefg/assets/image.png"),
        "assets/image.png?thumbnail=256&dataPath=20260821000000-abcdefg%2Fassets%2Fimage.png"
    );
});
