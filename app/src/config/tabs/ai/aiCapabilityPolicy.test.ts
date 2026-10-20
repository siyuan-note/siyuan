import * as assert from "node:assert/strict";
import test from "node:test";
import {
    IAgentApprovalOverridePatch,
    IAgentApprovalPolicy,
    actionApprovalPatch,
    approvalOverridePatch,
    capabilityOverridesPatch,
    getCapabilityActionApproval,
    resolveCapabilityApproval,
} from "./aiCapabilityPolicy";

test("capability approval resolves action overrides before the capability and policy defaults", () => {
    const policy: IAgentApprovalPolicy = {
        default: "risk",
        overrides: {"native/backend/search": {default: "confirm", actions: {semantic: "allow"}}},
    };

    assert.equal(resolveCapabilityApproval(policy, "native/backend/search", "semantic"), "allow");
    assert.equal(resolveCapabilityApproval(policy, "native/backend/search", "fulltext"), "confirm");
    assert.equal(resolveCapabilityApproval(policy, "native/backend/block"), "risk");
    assert.equal(getCapabilityActionApproval(policy, "native/backend/search", "fulltext"), "");
});

test("capability toggles patch only the changed entries", () => {
    // 恢复默认时写入空决策，由内核规范化清除；未改动的条目不能出现在补丁里。
    assert.deepEqual(capabilityOverridesPatch("allow", ["native/backend/asset"], "allow"),
        {"native/backend/asset": ""});
    assert.deepEqual(capabilityOverridesPatch("allow", ["native/backend/asset", "native/backend/block"], "deny"),
        {"native/backend/asset": "deny", "native/backend/block": "deny"});
});

test("consecutive capability changes do not undo each other", () => {
    // 第一次保存返回前，两次操作都基于同一份旧配置生成补丁。
    const stale = {default: "allow", overrides: {"native/backend/asset": "deny"}};
    const enable = capabilityOverridesPatch(stale.default, ["native/backend/asset"], "allow");
    const disable = capabilityOverridesPatch(stale.default, ["native/backend/block"], "deny");
    const merged = {...stale.overrides, ...enable, ...disable};

    // 后一次补丁不包含 asset，合并后不会把刚恢复的能力重新禁用。
    assert.deepEqual(merged, {"native/backend/asset": "", "native/backend/block": "deny"});
});

test("approval patches only carry the changed decision", () => {
    assert.deepEqual(approvalOverridePatch("risk", "risk"), {default: ""});
    assert.deepEqual(approvalOverridePatch("risk", "confirm"), {default: "confirm"});
    assert.deepEqual(actionApprovalPatch("semantic", "allow"), {actions: {semantic: "allow"}});
    assert.deepEqual(actionApprovalPatch("semantic", ""), {actions: {semantic: ""}});
});

test("consecutive approval changes do not undo each other", () => {
    const stale: IAgentApprovalPolicy = {
        default: "risk",
        overrides: {"native/backend/asset": {default: "confirm", actions: {semantic: "allow"}}},
    };
    // 模拟设置补丁的对象合并。
    const merge = (policy: IAgentApprovalPolicy, patch: Record<string, IAgentApprovalOverridePatch>):
        IAgentApprovalPolicy => {
        const overrides = {...policy.overrides};
        Object.entries(patch).forEach(([id, change]) => {
            const current = overrides[id] || {default: "", actions: {}};
            overrides[id] = {
                default: change.default ?? current.default,
                actions: {...current.actions, ...change.actions},
            };
        });
        return {...policy, overrides};
    };

    const resetAsset = merge(stale, {"native/backend/asset": approvalOverridePatch(stale.default, "risk")});
    const merged = merge(resetAsset, {"native/backend/block": actionApprovalPatch("rename", "allow")});

    // 后一次补丁只带 block 的操作决策，asset 恢复默认后不会被旧快照改回去。
    assert.equal(merged.overrides["native/backend/asset"].default, "");
    assert.equal(merged.overrides["native/backend/asset"].actions.semantic, "allow");
    assert.equal(merged.overrides["native/backend/block"].actions.rename, "allow");
});
