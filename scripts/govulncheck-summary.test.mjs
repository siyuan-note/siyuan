import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts", "govulncheck-summary.mjs");

const config = {
    protocol_version: "v1.0.0",
    scanner_name: "govulncheck",
    scanner_version: "v1.10.0",
    db: "https://vuln.go.dev",
    scan_level: "symbol",
    scan_mode: "source",
    go_version: "go1.26.10",
};

// govulncheck -json 输出为缩进的多行对象序列，fixture 必须保持同样的形态。
const stream = (records) => records.map((record) => JSON.stringify(record, null, 2)).join("\n") + "\n";

const run = (records) => {
    const dir = mkdtempSync(join(tmpdir(), "sy-govuln-"));
    try {
        const file = join(dir, "govulncheck.json");
        writeFileSync(file, stream(records), "utf8");
        const result = spawnSync(process.execPath, [script, file], {encoding: "utf8"});
        return {status: result.status, stdout: result.stdout || "", stderr: result.stderr || ""};
    } finally {
        rmSync(dir, {recursive: true, force: true});
    }
};

const finding = (osv, fixedVersion, module, version, position) => ({
    finding: {
        osv,
        fixed_version: fixedVersion,
        trace: position ? [{module, version, position}] : [{module, version}],
    },
});

test("fails when a vulnerability is reachable from the scanned code", () => {
    const {status, stdout, stderr} = run([
        {config},
        {
            osv: {
                id: "GO-0000-0001",
                summary: "Reachable issue",
                affected: [{package: {name: "example.com/lib", ecosystem: "Go"}}],
            },
        },
        finding("GO-0000-0001", "v1.2.0", "example.com/lib", "v1.0.0", {
            filename: "model/a.go",
            line: 12,
            column: 3,
        }),
    ]);
    assert.equal(status, 1);
    assert.ok(
        stdout.includes("| [GO-0000-0001](https://pkg.go.dev/vuln/GO-0000-0001) Reachable issue | `example.com/lib` | v1.0.0 | v1.2.0 | yes |"),
        stdout
    );
    assert.match(stdout, /- 1 called from the scanned code/);
    assert.match(stdout, /`model\/a\.go:12`/);
    assert.match(stderr, /1 vulnerability is called from the scanned code/);
});

test("succeeds when the vulnerable module is only required, not called", () => {
    const {status, stdout} = run([{config}, finding("GO-0000-0002", "v2.0.0", "example.com/dep", "v1.0.0", null)]);
    assert.equal(status, 0);
    assert.match(stdout, /- 0 called from the scanned code/);
    assert.match(stdout, /- 1 in required modules but not called/);
    assert.match(stdout, /\| v1\.0\.0 \| v2\.0\.0 \| no \|/);
});

test("only counts a vulnerability once when several call paths report it", () => {
    const {status, stdout} = run([
        {config},
        finding("GO-0000-0003", "v1.1.0", "example.com/lib", "v1.0.0", {filename: "a.go", line: 1, column: 1}),
        finding("GO-0000-0003", "v1.1.0", "example.com/lib", "v1.0.0", {filename: "b.go", line: 2, column: 1}),
        finding("GO-0000-0003", "v1.1.0", "example.com/lib", "v1.0.0", {filename: "c.go", line: 3, column: 1}),
        finding("GO-0000-0003", "v1.1.0", "example.com/lib", "v1.0.0", {filename: "d.go", line: 4, column: 1}),
        finding("GO-0000-0003", "v1.1.0", "example.com/lib", "v1.0.0", {filename: "e.go", line: 5, column: 1}),
    ]);
    assert.equal(status, 1);
    assert.equal(stdout.split("\n").filter((item) => item.startsWith("| ") && item.includes("GO-0000-0003")).length, 1);
    assert.match(stdout, /and 2 more/);
});

test("succeeds and reports clean results", () => {
    const {status, stdout} = run([{config}]);
    assert.equal(status, 0);
    assert.match(stdout, /No known vulnerabilities were found\./);
});

test("fails when the scanner did not finish", () => {
    const {status, stderr} = run([{progress: {message: "Scanning..."}}]);
    assert.equal(status, 2);
    assert.match(stderr, /produced no result/);
});

test("fails when the report file is missing", () => {
    const result = spawnSync(process.execPath, [script, join(tmpdir(), "sy-govuln-missing.json")], {encoding: "utf8"});
    assert.equal(result.status, 2);
    assert.match(result.stderr, /cannot read govulncheck output/);
});

test("keeps the table intact for summaries with pipes and newlines", () => {
    const {status, stdout} = run([
        {config},
        {osv: {id: "GO-0000-0004", summary: "a | b\nc", affected: []}},
        finding("GO-0000-0004", "v1.0.1", "example.com/lib", "v1.0.0", {filename: "x.go", line: 1, column: 1}),
    ]);
    assert.equal(status, 1);
    assert.match(stdout, /a \\\| b c/);
    for (const line of stdout.split("\n").filter((item) => item.startsWith("| ["))) {
        assert.equal(line.split(/(?<!\\)\|/).length - 2, 5, `unexpected column count in: ${line}`);
    }
});
