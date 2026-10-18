import * as assert from "node:assert/strict";
import {test} from "node:test";
import {resolve} from "node:path";

Object.assign(globalThis, {SIYUAN_VERSION: "test", NODE_ENV: "test"});
const {attachLivePhotoVideo, getLivePhotoUploadPairs} = require("./livePhotoPairs") as typeof import("./livePhotoPairs");

test("Live Photo pairs follow uploaded file indices through reordering and deduplication", () => {
    const photoA = new File(["photo-a"], "same.heic");
    const videoA = new File(["video-a"], "same.mov");
    const photoB = new File(["photo-b"], "same.heic");
    const videoB = new File(["video-b"], "same.mov");
    const result = getLivePhotoUploadPairs([{photo: photoA, video: videoA}, {photo: photoB, video: videoB}],
        [videoB, photoA, photoB, videoA], [
            {index: 0, path: "assets/deduplicated-b.mov"}, {index: 1, path: "assets/a.heic"},
            {index: 2, path: "assets/b.heic"}, {index: 3, path: "assets/a.mov"},
        ]);
    assert.deepEqual([...result.videos], [[1, "assets/a.mov"], [2, "assets/deduplicated-b.mov"]]);
    assert.deepEqual([...result.hidden].sort(), [0, 3]);
    assert.equal(result.incomplete, false);
});

test("partial uploads never create a standalone video or associate a different file", () => {
    const photo = new File(["photo"], "photo.heic");
    const video = new File(["video"], "photo.mov");
    for (const successes of [[{index: 0, path: "assets/photo.heic"}], [{index: 1, path: "assets/photo.mov"}]]) {
        const result = getLivePhotoUploadPairs([{photo, video}], [photo, video], successes);
        assert.equal(result.videos.size, 0);
        assert.ok(result.hidden.has(1));
        assert.equal(result.incomplete, true);
    }
    const replaced = getLivePhotoUploadPairs([{photo, video}], [new File(["other"], "photo.heic"), video],
        [{index: 0, path: "assets/other.heic"}, {index: 1, path: "assets/photo.mov"}]);
    assert.equal(replaced.videos.size, 0);
});

test("uploaded image markup retains the paired path through editor normalization", () => {
    require(resolve("stage/protyle/js/lute/lute.min.js"));
    const lute = Lute.New();
    lute.SetKramdownIAL(true);
    let dom = attachLivePhotoVideo('<span data-type="img" class="img"><span><img src="assets/photo.heic" data-src="assets/photo.heic"></span></span>', 'assets/photo.mov?x=1&name="clip"');
    assert.match(dom, /custom-sy-live-photo="1"/);
    assert.ok(dom.includes('custom-sy-live-photo-video="assets/photo.mov?x=1&amp;name=&quot;clip&quot;"'));
    for (let pass = 0; pass < 3; pass++) {
        dom = lute.SpinBlockDOM(dom);
        assert.match(dom, /custom-sy-live-photo-video=/);
        assert.match(lute.BlockDOM2Md(dom), /custom-sy-live-photo-video=/);
    }
});
