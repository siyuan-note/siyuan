const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {Writable} = require("node:stream");
const {test} = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
const consoleStart = source.indexOf("const console = ");
const consoleEnd = source.indexOf("\nconst {", consoleStart);
const logStart = source.indexOf("function writeLog(out) {");
const logEnd = source.indexOf("\n}", logStart) + 2;
assert.ok(consoleStart >= 0 && consoleEnd > consoleStart && logStart >= 0 && logEnd > logStart);

const createLogger = (stdout, stderr, confDir) => vm.runInNewContext(
    source.slice(consoleStart, consoleEnd) + source.slice(logStart, logEnd) + "\n({writeLog, console})",
    {require, process: {stdout, stderr}, fs, path, confDir},
);

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
