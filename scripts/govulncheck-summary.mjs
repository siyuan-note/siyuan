import {readFileSync} from "node:fs";
import {resolve} from "node:path";

// govulncheck -json 输出是缩进的多行对象序列，不是 NDJSON，按顶层花括号切分。
const splitTopLevel = (text) => {
    const out = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (c === "\\") {
                escaped = true;
            } else if (c === "\"") {
                inString = false;
            }
            continue;
        }
        if (c === "\"") {
            inString = true;
            continue;
        }
        if (c === "{") {
            if (depth === 0) {
                start = i;
            }
            depth++;
            continue;
        }
        if (c === "}") {
            depth--;
            if (depth === 0 && start >= 0) {
                out.push(JSON.parse(text.slice(start, i + 1)));
                start = -1;
            }
        }
    }
    return out;
};

// 把可能含有换行和表格分隔符的摘要压成单行，避免破坏 Markdown 表格。
const cell = (value, max = 90) => {
    const text = String(value ?? "").replace(/\s+/g, " ").replaceAll("|", "\\|").trim();
    return text.length > max ? `${text.slice(0, max - 3)}...` : text;
};

const path = process.argv[2];
if (!path) {
    console.error("usage: node scripts/govulncheck-summary.mjs <govulncheck-json-output>");
    process.exit(2);
}

let raw;
try {
    raw = readFileSync(resolve(path), "utf8");
} catch (err) {
    console.error(`cannot read govulncheck output: ${err.message}`);
    process.exit(2);
}

const objects = splitTopLevel(raw);
const config = objects.find((item) => item.config);
if (!config) {
    console.error("govulncheck produced no result: the scanner did not run to completion");
    process.exit(2);
}

const advisories = new Map();
for (const item of objects) {
    if (item.osv) {
        advisories.set(item.osv.id, item.osv);
    }
}

// 同一漏洞会有多条 finding（不同调用路径），按漏洞聚合；任一 finding 带调用位置才算可达。
const findings = new Map();
for (const item of objects) {
    if (!item.finding) {
        continue;
    }
    const finding = item.finding;
    let entry = findings.get(finding.osv);
    if (!entry) {
        entry = {id: finding.osv, fixed: finding.fixed_version || "", module: "", version: "", reachable: false, sites: []};
        findings.set(finding.osv, entry);
    }
    const trace = finding.trace || [];
    const frames = trace.filter((frame) => frame.position);
    if (frames.length > 0) {
        entry.reachable = true;
        const site = frames[frames.length - 1];
        const where = `${site.position.filename}:${site.position.line}`;
        entry.sites.push([where, site.function].filter(Boolean).join(" "));
    }
    if (!entry.module) {
        const vulnModule = trace.find((frame) => frame.module);
        if (vulnModule) {
            entry.module = vulnModule.module;
            entry.version = vulnModule.version || "";
        }
    }
}

const sorted = [...findings.values()].sort((a, b) => a.id.localeCompare(b.id));
const reachable = sorted.filter((entry) => entry.reachable);
const importedOnly = sorted.filter((entry) => !entry.reachable);

console.log("## govulncheck");
console.log("");
console.log(`Scanned \`${config.config.scan_level}\` reachability for \`${config.config.go_version}\`.`);
if (sorted.length === 0) {
    console.log("");
    console.log("No known vulnerabilities were found.");
    process.exit(0);
}
console.log("");
console.log(`- ${sorted.length} known ${sorted.length === 1 ? "vulnerability" : "vulnerabilities"}`);
console.log(`- ${reachable.length} called from the scanned code`);
console.log(`- ${importedOnly.length} in required modules but not called`);
console.log("");
console.log("| Vulnerability | Module | Version | Fixed in | Called |");
console.log("| --- | --- | --- | --- | --- |");
for (const entry of sorted) {
    const advisory = advisories.get(entry.id) || {};
    const link = `[${entry.id}](https://pkg.go.dev/vuln/${entry.id})`;
    const summary = advisory.summary ? ` ${cell(advisory.summary)}` : "";
    console.log(`| ${link}${summary} | \`${cell(entry.module, 60)}\` | ${cell(entry.version, 40)} | ${cell(entry.fixed, 40)} | ${entry.reachable ? "yes" : "no"} |`);
}

if (reachable.length > 0) {
    console.log("");
    console.log("### Call sites");
    for (const entry of reachable) {
        console.log("");
        console.log(`- \`${entry.id}\``);
        for (const site of entry.sites.slice(0, 3)) {
            console.log(`  - \`${cell(site, 120)}\``);
        }
        if (entry.sites.length > 3) {
            console.log(`  - and ${entry.sites.length - 3} more`);
        }
    }
    console.error(`${reachable.length} ${reachable.length === 1 ? "vulnerability is" : "vulnerabilities are"} called from the scanned code`);
    process.exitCode = 1;
}
