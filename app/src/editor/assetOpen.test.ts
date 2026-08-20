import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    DEFAULT_ASSET_OPEN,
    getAssetOpenGestures,
    normalizeAssetOpenConfig,
    resolveAssetOpenAction,
    resolveAssetOpenGesture,
    resolveExecutableAssetOpenAction,
} from "./assetOpen";

describe("asset opening", () => {
    it("uses the existing gestures by default", () => {
        assert.deepEqual(normalizeAssetOpenConfig(), DEFAULT_ASSET_OPEN);
        assert.equal(resolveAssetOpenAction(undefined, {}), "follow-tab");
        assert.equal(resolveAssetOpenAction(undefined, {ctrlKey: true}), "folder");
        assert.equal(resolveAssetOpenAction(undefined, {altKey: true}), "current");
        assert.equal(resolveAssetOpenAction(undefined, {shiftKey: true}), "app");
    });

    it("falls back to a plain click for combined modifiers", () => {
        assert.equal(resolveAssetOpenGesture({ctrlKey: true, altKey: true}), "click");
        assert.equal(resolveAssetOpenGesture({ctrlKey: true, shiftKey: true}), "click");
        assert.equal(resolveAssetOpenGesture({altKey: true, shiftKey: true}), "click");
    });

    it("resolves tab and unsupported actions", () => {
        assert.equal(resolveExecutableAssetOpenAction("follow-tab", {
            previewable: true,
            noSplitScreen: false,
        }), "right");
        assert.equal(resolveExecutableAssetOpenAction("follow-tab", {
            previewable: true,
            noSplitScreen: true,
        }), "current");
        assert.equal(resolveExecutableAssetOpenAction("new-window", {
            previewable: false,
            noSplitScreen: false,
        }), "app");
        assert.equal(resolveExecutableAssetOpenAction("folder", {
            previewable: false,
            noSplitScreen: false,
        }), "folder");
        assert.equal(resolveExecutableAssetOpenAction("bottom", {
            previewable: true,
            noSplitScreen: false,
        }), "bottom");
        assert.equal(resolveExecutableAssetOpenAction("background", {
            previewable: true,
            noSplitScreen: false,
        }), "background");
    });

    it("normalizes each invalid action independently", () => {
        assert.deepEqual(normalizeAssetOpenConfig({
            click: "invalid" as Config.TAssetOpenAction,
            ctrlClick: "background",
            altClick: "invalid" as Config.TAssetOpenAction,
            shiftClick: "bottom",
        }), {
            click: "follow-tab",
            ctrlClick: "background",
            altClick: "current",
            shiftClick: "bottom",
        });
    });

    it("keeps each gesture separate when actions degrade to the default app", () => {
        assert.deepEqual(getAssetOpenGestures(undefined, "app", {
            previewable: false,
            noSplitScreen: false,
        }), ["click", "altClick", "shiftClick"]);
        assert.deepEqual(getAssetOpenGestures(undefined, "folder", {
            previewable: false,
            noSplitScreen: false,
        }), ["ctrlClick"]);
    });
});
