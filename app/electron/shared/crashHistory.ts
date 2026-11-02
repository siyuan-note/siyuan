import * as fs from "node:fs";
import * as path from "node:path";
import {paths, writeLog, getConsole} from "./runtime";

type CrashInfo = {workspaceDir: string; crashInfo: string};

// 这些退出原因说明渲染进程是按预期结束的，不应触发安全模式提示。
const NO_SAFE_MODE_REASONS = new Set(["clean-exit", "launch-failed", "integrity-failure"]);

const markerPath = (): string => paths.appCrashMarkerPath;
const logPath = (): string => paths.appCrashLogPath;

// 同步记录工作空间主渲染进程崩溃标记，确保主进程退出前落盘。
const writeAppCrashMarker = (workspace: {workspaceDir?: string},
    details: {reason: string; exitCode?: number}): void => {
    const timestamp = new Date().toISOString();
    const marker = {
        version: 1,
        timestamp: timestamp,
        reason: details.reason,
        exitCode: details.exitCode,
        workspaceDir: workspace.workspaceDir || "",
    };

    try {
        fs.writeFileSync(markerPath(), JSON.stringify(marker, null, 2));
    } catch (e) {
        getConsole().error(e);
    }

    try {
        const line = timestamp.replace(/T/, " ").replace(/\..+/, "") +
            " Render process gone [reason=" + details.reason + ", exitCode=" + details.exitCode +
            ", workspace=" + JSON.stringify(marker.workspaceDir) + "]";
        let log = "";
        if (fs.existsSync(logPath())) {
            log = fs.readFileSync(logPath(), "utf8");
        }
        const lines = (log + line).trimEnd().split("\n").slice(-20);
        fs.writeFileSync(logPath(), lines.join("\n") + "\n");
    } catch (e) {
        getConsole().error(e);
    }
};

// 优先读取结构化标记，并兼容旧版本的 app.crash.log。
const readAppCrashInfo = (): CrashInfo | undefined => {
    if (fs.existsSync(markerPath())) {
        try {
            const markerText = fs.readFileSync(markerPath(), "utf8");
            const marker = JSON.parse(markerText);
            if (NO_SAFE_MODE_REASONS.has(marker.reason)) {
                fs.unlinkSync(markerPath());
            } else {
                let crashInfo = markerText;
                if (fs.existsSync(logPath())) {
                    crashInfo = fs.readFileSync(logPath(), "utf8");
                }
                return {
                    workspaceDir: typeof marker.workspaceDir === "string" ? marker.workspaceDir : "",
                    crashInfo: crashInfo,
                };
            }
        } catch (e) {
            writeLog("read crash marker failed: " + e);
            try {
                return {
                    workspaceDir: "",
                    crashInfo: fs.readFileSync(markerPath(), "utf8"),
                };
            } catch (readError) {
                writeLog("read invalid crash marker failed: " + readError);
                return {
                    workspaceDir: "",
                    crashInfo: "Invalid renderer crash marker",
                };
            }
        }
    }

    if (!fs.existsSync(logPath())) {
        return undefined;
    }

    try {
        const crashInfo = fs.readFileSync(logPath(), "utf8");
        const legacyLines = crashInfo.split(/\r?\n/).filter((line: string) => line.trim());
        const reasons: (string | undefined)[] = legacyLines.map((line: string) => {
            const match = line.match(/reason=([^,\]]+)/);
            return match ? match[1] : undefined;
        });
        if (reasons.length > 0 && reasons.every((reason) => reason && NO_SAFE_MODE_REASONS.has(reason))) {
            fs.unlinkSync(logPath());
            writeLog("ignored legacy crash log without safe mode reason");
            return undefined;
        }
        return {
            workspaceDir: "",
            crashInfo: crashInfo,
        };
    } catch (e) {
        writeLog("read crash log failed: " + e);
        return {
            workspaceDir: "",
            crashInfo: "Unreadable renderer crash log",
        };
    }
};

// 安全模式选择后内核启动成功，删除本次恢复所使用的崩溃信息。
const clearAppCrashInfo = (): void => {
    // 诊断副本不参与启动判断，恢复成功后仍可导出最近一次崩溃记录。
    const archiveDir = path.join(paths.confDir, "crash-history");
    [markerPath(), logPath()].forEach((filePath: string) => {
        try {
            fs.mkdirSync(archiveDir, {recursive: true});
            const archivePath = path.join(archiveDir, path.basename(filePath));
            if (fs.existsSync(filePath)) {
                fs.copyFileSync(filePath, archivePath);
            } else {
                fs.rmSync(archivePath, {force: true});
            }
        } catch (e) {
            writeLog("archive crash info failed: " + e);
        }
        try {
            fs.unlinkSync(filePath);
        } catch (e) {
            // 文件不存在等异常忽略。
        }
    });
};

export {writeAppCrashMarker, readAppCrashInfo, clearAppCrashInfo};
