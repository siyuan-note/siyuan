import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {removeSelectedRepoTags, repoSelectionKey, RepoTagSelection} from "./repoBatch";

describe("removeSelectedRepoTags", () => {
    const local: RepoTagSelection = {source: "local", tag: "same", id: "snapshot-a"};
    const cloud: RepoTagSelection = {source: "cloud", tag: "same", id: "snapshot-b"};

    it("keeps sources and snapshot identities separate", () => {
        assert.notEqual(repoSelectionKey(local), repoSelectionKey(cloud));
        assert.notEqual(repoSelectionKey(local), repoSelectionKey({...local, id: "snapshot-b"}));
        assert.notEqual(repoSelectionKey({...local, tag: "a:b"}), repoSelectionKey({...local, tag: "a", id: "b:snapshot-a"}));
    });

    it("removes only selected entries and verifies each affected source", async () => {
        const calls: string[] = [];
        const result = await removeSelectedRepoTags([local], async item => {
            calls.push(repoSelectionKey(item));
            return true;
        }, async source => {
            assert.equal(source, "local");
            return [{tag: "keep"}];
        });
        assert.deepEqual(calls, [repoSelectionKey(local)]);
        assert.deepEqual([...result], [repoSelectionKey(local)]);
    });

    it("does not report a successful response as removal when the tag still exists", async () => {
        const result = await removeSelectedRepoTags([local, cloud], async () => true,
            async source => source === "cloud" ? [{tag: "same"}] : []);
        assert.deepEqual([...result], [repoSelectionKey(local)]);
    });

    it("continues sequentially after transport and API failures", async () => {
        let active = 0;
        const third = {...local, tag: "third"};
        const calls: string[] = [];
        const result = await removeSelectedRepoTags([local, cloud, third], async item => {
            assert.equal(active++, 0);
            calls.push(item.tag);
            await Promise.resolve();
            active--;
            if (item === local) {
                throw new Error("offline");
            }
            return item !== cloud;
        }, async () => [{tag: "same"}]);
        assert.deepEqual(calls, ["same", "same", "third"]);
        assert.deepEqual([...result], [repoSelectionKey(third)]);
    });

    it("recognizes a verified removal when the delete response was lost", async () => {
        const result = await removeSelectedRepoTags([cloud], async () => {
            throw new Error("connection lost after deletion");
        }, async () => []);
        assert.deepEqual([...result], [repoSelectionKey(cloud)]);
    });

    it("retains unverified entries and can retry them without repeating confirmed removals", async () => {
        const first = await removeSelectedRepoTags([local, cloud], async () => true, async source => {
            if (source === "cloud") {
                throw new Error("offline");
            }
            return [];
        });
        const remaining = [local, cloud].filter(item => !first.has(repoSelectionKey(item)));
        assert.deepEqual(remaining, [cloud]);
        const retry = await removeSelectedRepoTags(remaining, async () => true, async () => []);
        assert.deepEqual([...retry], [repoSelectionKey(cloud)]);
    });
});
