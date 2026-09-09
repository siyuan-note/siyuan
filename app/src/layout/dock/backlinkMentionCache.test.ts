import {it} from "node:test";
import * as assert from "node:assert/strict";
import {BacklinkMentionCache, getBacklinkMentionQueryKey} from "./backlinkMentionCache";

it("reuses mentions when only source filters change and invalidates query or index changes", () => {
    const cache = new BacklinkMentionCache<{backmentions: string[], mentionsCount: number}>();
    const query = {id: "target", k: "", mk: "", sort: "0", mSort: "0", notebook: "box"};
    const key = getBacklinkMentionQueryKey(query);
    const value = {backmentions: ["mention"], mentionsCount: 1};
    cache.set(key, 1, value);
    const filteredQuery = {...query, sourceFilter: {excludedRefDefIDs: ["archive"]}, includeMentions: false};
    assert.equal(cache.get(getBacklinkMentionQueryKey(filteredQuery), 1), value);
    assert.equal(cache.get(key, 2), undefined);
    for (const field of ["id", "k", "mk", "sort", "mSort", "notebook"]) {
        assert.equal(cache.get(getBacklinkMentionQueryKey({...query, [field]: "changed"}), 1), undefined);
    }
    cache.clear();
    assert.equal(cache.get(key, 1), undefined);
});

it("caches empty results and replaces the previous target", () => {
    const cache = new BacklinkMentionCache<{backmentions: string[], mentionsCount: number}>();
    const empty = {backmentions: [] as string[], mentionsCount: 0};
    cache.set("a", 1, empty);
    assert.equal(cache.get("a", 1), empty);
    cache.set("b", 1, empty);
    assert.equal(cache.get("a", 1), undefined);
});
