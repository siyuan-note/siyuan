import {test} from "node:test";
import {readLastWorkspace} from "./lastWorkspace";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// 每个用例建一个可写的临时配置目录，事后清理。
const withConfDir = (workspaceList, run) => {
    const confDir = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-last-workspace-"));
    try {
        if (workspaceList !== undefined) {
            fs.writeFileSync(path.join(confDir, "workspace.json"),
                typeof workspaceList === "string" ? workspaceList : JSON.stringify(workspaceList));
        }
        return run(confDir);
    } finally {
        fs.rmSync(confDir, {recursive: true, force: true});
    }
};

const makeDirectories = (...names) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-workspaces-"));
    return {root, paths: names.map(name => {
        const target = path.join(root, name);
        fs.mkdirSync(target);
        return target;
    })};
};

test("readLastWorkspace reports nothing when workspace.json is absent", () => {
    withConfDir(undefined, confDir => {
        assert.deepStrictEqual(readLastWorkspace(confDir, () => {}), {
            lastWorkspacePath: "", lastWorkspaceMissing: false, missingWorkspacePath: "", availableWorkspaces: [],
        });
    });
});

test("readLastWorkspace keeps the last entry when its directory still exists", () => {
    const {root, paths} = makeDirectories("first", "second");
    try {
        withConfDir(paths, confDir => {
            assert.deepStrictEqual(readLastWorkspace(confDir, () => {}), {
                lastWorkspacePath: paths[1], lastWorkspaceMissing: false, missingWorkspacePath: "", availableWorkspaces: [],
            });
        });
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test("readLastWorkspace reports the missing last entry and keeps the remaining usable ones", () => {
    const {root, paths} = makeDirectories("first");
    try {
        const missing = path.join(root, "removed");
        withConfDir([paths[0], missing], confDir => {
            assert.deepStrictEqual(readLastWorkspace(confDir, () => {}), {
                lastWorkspacePath: missing, lastWorkspaceMissing: true, missingWorkspacePath: missing,
                availableWorkspaces: [paths[0]],
            });
        });
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test("readLastWorkspace ignores unusable workspace.json content and logs once", () => {
    const logged = [];
    withConfDir("{not json", confDir => {
        assert.deepStrictEqual(readLastWorkspace(confDir, message => logged.push(message)), {
            lastWorkspacePath: "", lastWorkspaceMissing: false, missingWorkspacePath: "", availableWorkspaces: [],
        });
    });
    assert.equal(logged.length, 1);
    assert.match(logged[0], /^read workspace list failed: /);
});

test("readLastWorkspace treats an empty list as no previous workspace", () => {
    withConfDir([], confDir => {
        assert.deepStrictEqual(readLastWorkspace(confDir, () => {}), {
            lastWorkspacePath: "", lastWorkspaceMissing: false, missingWorkspacePath: "", availableWorkspaces: [],
        });
    });
});
