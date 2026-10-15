import {test} from "node:test";
import * as assert from "node:assert/strict";
import {renderSnapshotActions} from "./snapshotActions";

test("snapshot actions retain platform presentation, order and read-only behavior", () => {
    const languages = {download: "Download", downloadRollback: "Download and rollback", remove: "Remove",
        upload: "Upload", rollback: "Rollback", tagSnapshot: "Tag", editSnapshotMemo: "Edit memo"};
    const cases = {
        getCloudRepoTagSnapshots: ["downloadSnapshot", "downloadRollback", "removeCloudRepoTagSnapshot"],
        getCloudRepoSnapshots: ["downloadSnapshot", "downloadRollback"],
        getRepoTagSnapshots: ["uploadSnapshot", "rollback", "removeRepoTagSnapshot"],
        getRepoSnapshots: ["genTag", "rollback"],
    };
    for (const [type, expected] of Object.entries(cases)) {
        for (const mobile of [false, true]) {
            for (const readonly of [false, true]) {
                const editable = type.startsWith("getRepo") && !readonly;
                const html = renderSnapshotActions(type, languages, mobile, readonly);
                assert.deepEqual([...html.matchAll(/data-type="([^"]+)"/g)].map(match => match[1]),
                    editable ? ["editSnapshotMemo", ...expected] : expected);
                assert.doesNotMatch(html, /fn__flex-1/);
                if (mobile) {
                    assert.match(html, /fn__space/);
                    assert.match(html, /history__snapshot-menu-action/);
                    assert.doesNotMatch(html, /history__snapshot-menu-action[^>]*data-type="(?:rollback|downloadRollback)"/);
                } else {
                    assert.match(html, /b3-tooltips/);
                    assert.doesNotMatch(html, /fn__space|history__snapshot-menu-action/);
                }
            }
        }
    }
});
