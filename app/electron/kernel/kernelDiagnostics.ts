// 启动失败时的本机诊断：本机请求超时说明端口已监听但回环通道不通，收集 Windows TCP 配置便于排查。
// netsh 的 show 命令不需要管理员权限，输出随系统语言本地化，因此只记录原文。
import {errorMessage} from "../shared/errors";

type DiagnosticsOptions = {
    platform: NodeJS.Platform;
    execFile: (file: string, args: string[],
        options: {timeout: number; windowsHide: boolean},
        callback: (error: Error | null, stdout: string) => void) => void;
};

const windowsTCPConfigCommands = [
    ["int", "tcp", "show", "supplemental"],
    ["int", "ipv4", "show", "global"],
    ["int", "ipv6", "show", "global"],
];

const execFileAsync = (execFile: DiagnosticsOptions["execFile"], file: string, args: string[],
    options: {timeout: number; windowsHide: boolean}): Promise<string> => new Promise((resolve, reject) => {
    execFile(file, args, options, (error: Error | null, stdout: string) => error ? reject(error) : resolve(stdout));
});

/** 非 Windows 平台没有这些命令，直接返回空结果。命令行标记保持 ASCII，便于识别输出来源。 */
const collectWindowsTCPConfig = async ({platform, execFile}: DiagnosticsOptions): Promise<string[]> => {
    if ("win32" !== platform) {
        return [];
    }
    const lines: string[] = [];
    for (const args of windowsTCPConfigCommands) {
        const command = "netsh " + args.join(" ");
        try {
            const stdout = await execFileAsync(execFile, "netsh.exe", args, {timeout: 5000, windowsHide: true});
            lines.push("[tcp config] " + command + ":\n" + String(stdout).trimEnd());
        } catch (error) {
            lines.push("[tcp config] " + command + " failed: " + errorMessage(error));
        }
    }
    return lines;
};

export {collectWindowsTCPConfig};
