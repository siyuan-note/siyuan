import * as assert from "node:assert/strict";
import {test} from "node:test";
import {isWindowWorkspace, isWindowWorkspaceSnapshot, WindowWorkspaceWriter} from "./workspaceCore";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("工作区接受分屏和空页签，拒绝未知版本及损坏的层级", () => {
    const snapshot = {
        version: 1, time: 1, layout: {instance: "Layout", children: [{
            instance: "Wnd", children: [{instance: "Tab", children: {}}, {
                instance: "Tab", children: {instance: "Editor", rootId: "doc", scrollAttr: {rootId: "doc", scrollTop: 120}},
            }],
        }]},
    };
    assert.equal(isWindowWorkspaceSnapshot(snapshot), true);
    assert.equal(isWindowWorkspaceSnapshot({...snapshot, version: 2}), false);
    assert.equal(isWindowWorkspaceSnapshot({...snapshot, time: NaN}), false);
    assert.equal(isWindowWorkspaceSnapshot({...snapshot, layout: {instance: "Layout", children: [{instance: "Editor"}]}}), false);
    assert.equal(isWindowWorkspaceSnapshot({...snapshot, layout: {instance: "Layout", children: [{instance: "Wnd", children: [null]}]}}), false);
    const cyclic = {instance: "Layout", children: [] as unknown[]};
    cyclic.children.push(cyclic);
    assert.equal(isWindowWorkspaceSnapshot({...snapshot, layout: cyclic}), false);
});

test("移除标记和不受支持的元数据不出现在工作区列表中", () => {
    const workspace = {version: 1, id: "20260922100000-abcdefg", name: "阅读"};
    assert.equal(isWindowWorkspace(workspace), true);
    for (const invalid of [{...workspace, deleted: true}, {...workspace, version: 2}, {...workspace, id: "../layout"}, {...workspace, name: " "}]) {
        assert.equal(isWindowWorkspace(invalid), false);
    }
});

test("连续更新只保留最新等待值，并等待最后一次持久化", async () => {
    const values: number[] = [];
    const releases: Array<(saved: boolean) => void> = [];
    const writer = new WindowWorkspaceWriter<number>(value => {
        values.push(value);
        return new Promise(resolve => releases.push(resolve));
    });
    const saved = writer.save(1);
    await tick();
    writer.save(2);
    writer.save(3);
    releases.shift()(true);
    await tick();
    assert.deepEqual(values, [1, 3]);
    let finished = false;
    void saved.then(() => finished = true);
    await tick();
    assert.equal(finished, false);
    releases.shift()(true);
    assert.equal(await saved, true);
});

test("请求失败后允许重试最新状态", async () => {
    let succeed = false;
    const values: number[] = [];
    const writer = new WindowWorkspaceWriter<number>(async value => {
        values.push(value);
        return succeed;
    });
    assert.equal(await writer.save(1), false);
    succeed = true;
    assert.equal(await writer.save(2), true);
    assert.deepEqual(values, [1, 2]);
});

test("完成写入同一轮微任务中的更新不会遗漏", async () => {
    const values: number[] = [];
    const writer = new WindowWorkspaceWriter<number>(async value => {
        values.push(value);
        if (value === 1) {
            queueMicrotask(() => queueMicrotask(() => writer.save(2)));
        }
        return true;
    });
    await writer.save(1);
    await tick();
    assert.deepEqual(values, [1, 2]);
});

test("移除时等待在途请求结束并丢弃待写入状态", async () => {
    const values: number[] = [];
    let finish: (saved: boolean) => void;
    const writer = new WindowWorkspaceWriter<number>(value => {
        values.push(value);
        return new Promise(resolve => finish = resolve);
    });
    writer.save(1);
    await tick();
    writer.save(2);
    const stopped = writer.stop();
    finish(false);
    await stopped;
    assert.deepEqual(values, [1]);
    const next = writer.save(3);
    await tick();
    finish(true);
    assert.equal(await next, true);
    assert.deepEqual(values, [1, 3]);
});
