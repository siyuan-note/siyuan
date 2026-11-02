import * as fs from "node:fs/promises";
import * as path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import type {MarkdownFileDescriptor} from "./registry";

const execute = promisify(execFile);
const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

// Node 的 Windows rename 不保留目标 ACL；通过固定脚本调用不忽略元数据错误的 ReplaceFileW。
const replaceFile = async (source: string, destination: string, backup: string | undefined,
    {platform = process.platform, fileSystem = fs, run = execute}: {
        platform?: NodeJS.Platform; fileSystem?: typeof fs; run?: typeof execute;
    } = {}): Promise<void> => {
    if (platform !== "win32") return fileSystem.rename(source, destination);
    await run(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
        path.join(__dirname, "replaceFile.ps1"), "-Source", source, "-Destination", destination, "-Backup", backup!],
    {windowsHide: true, shell: false, timeout: 30000, maxBuffer: 64 * 1024});
};

const preserveOwnership = async (file: fs.FileHandle, original: MarkdownFileDescriptor,
    {platform = process.platform}: {platform?: NodeJS.Platform} = {}): Promise<void> => {
    if (platform === "win32" || original.identity === "missing") return;
    const current = await file.stat({bigint: true});
    if (Number(current.uid) !== original.uid || Number(current.gid) !== original.gid) {
        await file.chown(original.uid!, original.gid!);
    }
    // chown 可能清除权限位，必须在其后恢复模式。
    await file.chmod(original.mode);
};

const syncDirectory = async (directory: string,
    {platform = process.platform, fileSystem = fs}: {platform?: NodeJS.Platform; fileSystem?: typeof fs} = {}): Promise<void> => {
    if (platform === "win32") return;
    const handle = await fileSystem.open(directory, "r");
    try {await handle.sync();} finally {await handle.close();}
};

export {replaceFile, preserveOwnership, syncDirectory};
