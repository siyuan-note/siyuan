const fs = require("node:fs/promises");
const path = require("node:path");
const {execFile} = require("node:child_process");
const {promisify} = require("node:util");

const execute = promisify(execFile);
const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

// Node 的 Windows rename 不保留目标 ACL；通过固定脚本调用不忽略元数据错误的 ReplaceFileW。
const replaceFile = async (source, destination, backup, {platform = process.platform, fileSystem = fs, run = execute} = {}) => {
    if (platform !== "win32") return fileSystem.rename(source, destination);
    await run(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
        path.join(__dirname, "replaceFile.ps1"), "-Source", source, "-Destination", destination, "-Backup", backup],
    {windowsHide: true, shell: false, timeout: 30000, maxBuffer: 64 * 1024});
};

const preserveOwnership = async (file, original, {platform = process.platform} = {}) => {
    if (platform === "win32" || original.identity === "missing") return;
    const current = await file.stat({bigint: true});
    if (Number(current.uid) !== original.uid || Number(current.gid) !== original.gid) {
        await file.chown(original.uid, original.gid);
    }
    // chown 可能清除权限位，必须在其后恢复模式。
    await file.chmod(original.mode);
};

const syncDirectory = async (directory, {platform = process.platform, fileSystem = fs} = {}) => {
    if (platform === "win32") return;
    const handle = await fileSystem.open(directory, "r");
    try {await handle.sync();} finally {await handle.close();}
};

module.exports = {replaceFile, preserveOwnership, syncDirectory};
