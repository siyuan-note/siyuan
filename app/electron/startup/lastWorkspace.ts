// 上次打开的工作空间。这里的结果既作为崩溃恢复的默认选项，也用于发现该目录已被删除或移走。
import * as fs from "node:fs";
import * as path from "node:path";
import type {LogFunction} from "../shared/types";

type LastWorkspaceProbe = {
    lastWorkspacePath: string;
    lastWorkspaceMissing: boolean;
    missingWorkspacePath: string;
    availableWorkspaces: string[];
};

const emptyLastWorkspaceProbe = (): LastWorkspaceProbe => ({
    lastWorkspacePath: "",
    lastWorkspaceMissing: false,
    missingWorkspacePath: "",
    availableWorkspaces: [],
});

const isDirectory = (target: unknown): target is string => {
    try {
        return typeof target === "string" && fs.existsSync(target) && fs.statSync(target).isDirectory();
    } catch {
        return false;
    }
};

// 记录损坏或不可读时退回「无上次工作空间」，不影响正常启动。
const readLastWorkspace = (confDir: string, writeLog: LogFunction): LastWorkspaceProbe => {
    const workspaceFile = path.join(confDir, "workspace.json");
    if (!fs.existsSync(workspaceFile)) {
        return emptyLastWorkspaceProbe();
    }
    let workspaceList: unknown;
    try {
        workspaceList = JSON.parse(fs.readFileSync(workspaceFile, "utf8"));
    } catch (error) {
        writeLog("read workspace list failed: " + error);
        return emptyLastWorkspaceProbe();
    }
    if (!Array.isArray(workspaceList) || 0 === workspaceList.length) {
        return emptyLastWorkspaceProbe();
    }
    const last = workspaceList[workspaceList.length - 1];
    if (typeof last !== "string") {
        return emptyLastWorkspaceProbe();
    }
    if (isDirectory(last)) {
        return {...emptyLastWorkspaceProbe(), lastWorkspacePath: last};
    }
    // 上次打开的工作空间已丢失 https://github.com/siyuan-note/siyuan/issues/14748
    return {
        lastWorkspacePath: last,
        lastWorkspaceMissing: true,
        missingWorkspacePath: last,
        availableWorkspaces: workspaceList.slice(0, -1).filter(isDirectory),
    };
};

export {emptyLastWorkspaceProbe, readLastWorkspace};
