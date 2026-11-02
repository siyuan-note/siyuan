import {test} from "node:test";
import {resolveStartupBranch} from "./startupBranches";
import {state} from "../shared/runtime";
const assert = require("node:assert/strict");

// 分支选择只读启动快照，用例整组替换后在结束后还原。
const withState = (values, run) => {
    const saved = state.startup;
    state.startup = Object.freeze({...saved, ...values});
    try {
        run();
    } finally {
        state.startup = saved;
    }
};

const crashInfo = {workspaceDir: "/crash", crashInfo: "boom"};

// 分支是判别联合：断言分支名后需要显式收窄，才能访问该分支携带的载荷。
const payload = (branch: {branch: string}) => branch as {
    branch: string;
    remoteKernelArgError?: {code?: string};
    remoteKernelTarget?: {origin: string};
    appCrashInfo?: {workspaceDir?: string; crashInfo: string};
};

test("branch precedence follows the order the entry relies on", () => {
    // 全部条件同时成立时，最靠前的条件优先。
    withState({remoteKernelArgError: {code: "E"}, remoteKernelTarget: {origin: "https://a"},
        firstOpen: true, lastWorkspaceMissing: true}, () => {
        const branch = payload(resolveStartupBranch(crashInfo));
        assert.equal(branch.branch, "remote-arg-invalid");
        assert.deepEqual(branch.remoteKernelArgError, {code: "E"});
    });
    withState({remoteKernelArgError: undefined, remoteKernelTarget: {origin: "https://a"},
        firstOpen: true, lastWorkspaceMissing: true}, () => {
        const branch = payload(resolveStartupBranch(crashInfo));
        assert.equal(branch.branch, "remote-target");
        assert.equal(branch.remoteKernelTarget.origin, "https://a");
    });
    withState({remoteKernelArgError: undefined, remoteKernelTarget: undefined,
        firstOpen: true, lastWorkspaceMissing: true}, () => {
        assert.equal(resolveStartupBranch(crashInfo).branch, "first-open");
    });
    withState({remoteKernelArgError: undefined, remoteKernelTarget: undefined,
        firstOpen: false, lastWorkspaceMissing: true}, () => {
        const branch = payload(resolveStartupBranch(crashInfo));
        assert.equal(branch.branch, "crash-recovery");
        assert.equal(branch.appCrashInfo, crashInfo);
    });
    withState({remoteKernelArgError: undefined, remoteKernelTarget: undefined,
        firstOpen: false, lastWorkspaceMissing: true}, () => {
        assert.equal(resolveStartupBranch(undefined).branch, "workspace-missing");
    });
    withState({remoteKernelArgError: undefined, remoteKernelTarget: undefined,
        firstOpen: false, lastWorkspaceMissing: false}, () => {
        assert.equal(resolveStartupBranch(undefined).branch, "local-kernel");
    });
});

test("the selected branch carries the payload the caller needs", () => {
    // 崩溃恢复分支必须带上崩溃信息，调用方不再需要断言该字段存在。
    withState({remoteKernelArgError: undefined, remoteKernelTarget: undefined,
        firstOpen: false, lastWorkspaceMissing: false}, () => {
        const branch = payload(resolveStartupBranch(crashInfo));
        assert.equal(branch.appCrashInfo.crashInfo, "boom");
        assert.equal(branch.appCrashInfo.workspaceDir, "/crash");
    });
});

test("a file entry selects the Markdown editor even when the remote argument is invalid", () => {
    const saved = state.markdown.startup;
    try {
        // 独立 Markdown 入口与工作空间无关，优先级高于其余全部启动条件。
        state.markdown.startup = true;
        withState({remoteKernelArgError: {code: "E"}, remoteKernelTarget: {origin: "https://a"},
            firstOpen: true, lastWorkspaceMissing: true}, () => {
            assert.equal(resolveStartupBranch(crashInfo).branch, "markdown-editor");
        });

        state.markdown.startup = false;
        withState({remoteKernelArgError: {code: "E"}, remoteKernelTarget: {origin: "https://a"},
            firstOpen: true, lastWorkspaceMissing: true}, () => {
            assert.equal(resolveStartupBranch(crashInfo).branch, "remote-arg-invalid");
        });
    } finally {
        state.markdown.startup = saved;
    }
});
