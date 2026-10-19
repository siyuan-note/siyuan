import * as assert from "node:assert/strict";
import test from "node:test";
import {
    IAgentApprovalPolicy,
    approvalOverridesForPatch,
    capabilityOverridesForPatch,
    getCapabilityActionApproval,
    resolveCapabilityApproval,
    updateCapabilityActionApproval,
    updateCapabilityApproval,
} from "./aiCapabilityPolicy";

const newPolicy = (): IAgentApprovalPolicy => ({default: "risk", overrides: {}});

test("capability approval preserves action overrides", () => {
    let policy = updateCapabilityActionApproval(newPolicy(), "native/backend/search", "semantic", "allow");
    policy = updateCapabilityApproval(policy, "native/backend/search", "confirm");

    assert.equal(resolveCapabilityApproval(policy, "native/backend/search", "fulltext"), "confirm");
    assert.equal(resolveCapabilityApproval(policy, "native/backend/search", "semantic"), "allow");
    assert.deepEqual(policy.overrides["native/backend/search"], {
        default: "confirm",
        actions: {semantic: "allow"},
    });
});

test("capability approval inherits the policy default without dropping action overrides", () => {
    const policy: IAgentApprovalPolicy = {
        default: "risk",
        overrides: {
            "native/backend/search": {
                default: "confirm",
                actions: {semantic: "allow"},
            },
        },
    };
    const updated = updateCapabilityApproval(policy, "native/backend/search", "risk");

    assert.deepEqual(updated.overrides["native/backend/search"], {
        default: "",
        actions: {semantic: "allow"},
    });
    assert.equal(resolveCapabilityApproval(updated, "native/backend/search", "fulltext"), "risk");
    assert.equal(resolveCapabilityApproval(updated, "native/backend/search", "semantic"), "allow");
});

test("action approval distinguishes inheritance from explicit decisions", () => {
    let policy = updateCapabilityApproval(newPolicy(), "native/backend/search", "confirm");
    assert.equal(getCapabilityActionApproval(policy, "native/backend/search", "fulltext"), "");
    assert.equal(resolveCapabilityApproval(policy, "native/backend/search", "fulltext"), "confirm");

    policy = updateCapabilityActionApproval(policy, "native/backend/search", "fulltext", "risk");
    assert.equal(getCapabilityActionApproval(policy, "native/backend/search", "fulltext"), "risk");
    assert.equal(resolveCapabilityApproval(policy, "native/backend/search", "fulltext"), "risk");

    policy = updateCapabilityActionApproval(policy, "native/backend/search", "fulltext", "");
    assert.equal(getCapabilityActionApproval(policy, "native/backend/search", "fulltext"), "");
    assert.equal(resolveCapabilityApproval(policy, "native/backend/search", "fulltext"), "confirm");
});

test("empty inherited approval entries are removed", () => {
    let policy = updateCapabilityActionApproval(newPolicy(), "native/backend/search", "fulltext", "confirm");
    policy = updateCapabilityActionApproval(policy, "native/backend/search", "fulltext", "");

    assert.equal(policy.overrides["native/backend/search"], undefined);
});

test("removed capability overrides are submitted as empty decisions", () => {
    // 设置补丁按对象合并，省略的键不会从 overrides 中移除，被删除的条目必须改写为空决策交给内核清除。
    assert.deepEqual(capabilityOverridesForPatch({asset: "deny", block: "deny"}, {block: "deny"}),
        {asset: "", block: "deny"});
    assert.deepEqual(capabilityOverridesForPatch({}, {asset: "allow"}), {asset: "allow"});
});

test("removed approval overrides are submitted as empty decisions", () => {
    const policy: IAgentApprovalPolicy = {
        default: "risk",
        overrides: {
            "native/backend/search": {default: "confirm", actions: {semantic: "allow"}},
            "native/backend/block": {default: "allow", actions: {}},
        },
    };

    const actionRemoved = updateCapabilityActionApproval(policy, "native/backend/search", "semantic", "");
    assert.deepEqual(approvalOverridesForPatch(policy.overrides, actionRemoved.overrides), {
        "native/backend/search": {default: "confirm", actions: {semantic: ""}},
        "native/backend/block": {default: "allow", actions: {}},
    });

    const entryRemoved = updateCapabilityApproval(policy, "native/backend/block", "risk");
    assert.equal(entryRemoved.overrides["native/backend/block"], undefined);
    assert.deepEqual(approvalOverridesForPatch(policy.overrides, entryRemoved.overrides)["native/backend/block"],
        {default: "", actions: {}});
});
