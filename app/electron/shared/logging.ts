import * as fs from "node:fs";
import * as path from "node:path";
import {Console} from "node:console";
import type {LogFunction} from "./types";

// 只声明实际用到的两个方法。
type NodeConsole = {log: (...args: unknown[]) => void; error: (...args: unknown[]) => void};

// 桌面启动器关闭输出管道后，终端日志失败不应中断文件日志或应用启动。
const createConsole = ({stdout = process.stdout, stderr = process.stderr}: {
    stdout?: NodeJS.WritableStream; stderr?: NodeJS.WritableStream;
} = {}): NodeConsole =>
    new Console({
        stdout,
        stderr,
        ignoreErrors: true,
    });

// 日志同时写入终端与工作空间的固定日志文件，单条写入失败不影响后续记录。
const createWriteLog = (console: NodeConsole, confDir: string): LogFunction => (out) => {
    console.log(out);
    const logFile = path.join(confDir, "app.log");
    let log = "";
    const maxLogLines = 1024;
    try {
        if (fs.existsSync(logFile)) {
            log = fs.readFileSync(logFile).toString();
            const lines = log.split("\n");
            if (maxLogLines < lines.length) {
                log = lines.slice(maxLogLines / 2, maxLogLines).join("\n") + "\n";
            }
        }
        let text = String(out);
        text = new Date().toISOString().replace(/T/, " ").replace(/\..+/, "") + " " + text;
        log += text + "\n";
        fs.writeFileSync(logFile, log);
    } catch (e) {
        console.error(e);
    }
};

export {
    createConsole,
    createWriteLog,
};
