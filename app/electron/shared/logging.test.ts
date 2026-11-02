import {Writable} from "node:stream";
import {test} from "node:test";
import {createConsole, createWriteLog} from "./logging";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const createLogger = (stdout, stderr, confDir) => {
    const logger = createConsole({stdout, stderr});
    return {writeLog: createWriteLog(logger, confDir), console: logger};
};

for (const asynchronous of [false, true]) {
    test(`broken output pipes preserve file logging (${asynchronous ? "asynchronous" : "synchronous"})`, async t => {
        const confDir = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-console-"));
        t.after(() => fs.rmSync(confDir, {recursive: true, force: true}));
        const brokenPipe = () => new Writable({
            write(chunk, encoding, callback) {
                const error = Object.assign(new Error("write EPIPE"), {code: "EPIPE"});
                if (asynchronous) {
                    setImmediate(() => callback(error));
                } else {
                    throw error;
                }
            },
        });
        const logger = createLogger(brokenPipe(), brokenPipe(), confDir);
        logger.writeLog("startup continues");
        logger.console.error("diagnostic output");
        await new Promise(resolve => setTimeout(resolve, 20));
        logger.writeLog("second entry");
        const log = fs.readFileSync(path.join(confDir, "app.log"), "utf8");
        assert.match(log, /startup continues\n/);
        assert.match(log, /second entry\n/);
        // 文件写入失败的诊断也不能因标准错误管道断开而抛出异常。
        fs.rmSync(confDir, {recursive: true});
        logger.writeLog("unwritable log");
        await new Promise(resolve => setTimeout(resolve, 20));
    });
}

test("working output streams retain formatted diagnostics and file logs", t => {
    const confDir = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-console-"));
    t.after(() => fs.rmSync(confDir, {recursive: true, force: true}));
    let output = "";
    const stream = new Writable({write(chunk, encoding, callback) {
        output += chunk.toString();
        callback();
    }});
    const logger = createLogger(stream, stream, confDir);
    logger.writeLog("startup");
    logger.console.error("failure %s", "details");
    assert.equal(output, "startup\nfailure details\n");
    assert.match(fs.readFileSync(path.join(confDir, "app.log"), "utf8"), /startup\n/);
});

test("the desktop log keeps the newest entries and stays bounded", t => {
    const confDir = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-console-"));
    t.after(() => fs.rmSync(confDir, {recursive: true, force: true}));
    const sink = new Writable({write(chunk, encoding, callback) {
        callback();
    }});
    const logFile = path.join(confDir, "app.log");
    const logger = createLogger(sink, sink, confDir);
    for (let index = 0; index < 1100; index++) {
        logger.writeLog("entry " + index);
    }
    const lines = fs.readFileSync(logFile, "utf8").trimEnd().split("\n");
    assert.ok(lines.length <= 1024, `log grew to ${lines.length} lines`);
    assert.match(lines[lines.length - 1], /entry 1099$/);
    // 超出上限后只保留后半段，最早的记录被丢弃。
    assert.equal(lines.some(line => /entry 0$/.test(line)), false);

    // 新进程接着写同一个文件时不丢失已有记录。
    const resumed = createLogger(sink, sink, confDir);
    resumed.writeLog("resumed");
    const resumedLines = fs.readFileSync(logFile, "utf8").trimEnd().split("\n");
    assert.match(resumedLines[resumedLines.length - 1], /resumed$/);
    assert.equal(resumedLines.length, lines.length + 1);
});
