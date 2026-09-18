import {test} from "node:test";
import * as assert from "node:assert/strict";
import {applyPublishAVFolds, getPublishAVView, setPublishAVFolds, setPublishAVView} from "./publishState";

test("发布视图和分组状态在重新渲染后保留，并隔离数据库块及视图", () => {
    const block = {dataset: {nodeId: "block", avId: "database"}};
    const remounted = {dataset: {...block.dataset}};
    const other = {dataset: {nodeId: "other", avId: "database"}};
    setPublishAVView(block, "view2");
    assert.equal(getPublishAVView(remounted), "view2");
    assert.equal(getPublishAVView(other), "");
    setPublishAVFolds(block, "view2", {a: false, b: true});
    setPublishAVFolds(block, "view2", {b: false});
    const data = {viewID: "view2", view: {groups: [
        {id: "a", groupFolded: true}, {id: "b", groupFolded: true}, {id: "c", groupFolded: true},
    ]}} as IAV;
    applyPublishAVFolds(remounted, data);
    assert.deepEqual(data.view.groups.map(group => group.groupFolded), [false, false, true]);
    const otherView = {viewID: "view1", view: {groups: [{id: "a", groupFolded: true}]}} as IAV;
    applyPublishAVFolds(block, otherView);
    assert.equal(otherView.view.groups[0].groupFolded, true);
    setPublishAVView(remounted, "");
    assert.equal(getPublishAVView(block), "");
});
