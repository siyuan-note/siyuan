import {createReadStream} from "node:fs";
import {createInterface} from "node:readline";
import {pathToFileURL} from "node:url";

export const parsePerformanceLine = line => {
    const marker = "siyuan-performance ";
    const start = line.indexOf(marker);
    if (start < 0) {
        return undefined;
    }
    const record = JSON.parse(line.slice(start + marker.length));
    if (typeof record.operation !== "string" || !record.operation ||
        !Number.isFinite(record.duration_us) || record.duration_us < 0) {
        throw new Error("Invalid performance record");
    }
    for (const fields of [record.stages_us, record.counts]) {
        if (fields !== undefined && (!fields || typeof fields !== "object" || Array.isArray(fields) ||
            Object.values(fields).some(value => !Number.isFinite(value) || value < 0))) {
            throw new Error("Invalid performance fields");
        }
    }
    return record;
};

const distribution = values => {
    values.sort((a, b) => a - b);
    const n = values.length;
    const median = n % 2 ? values[(n - 1) / 2] : (values[n / 2 - 1] + values[n / 2]) / 2;
    return {samples: n, median, ...(n >= 20 ? {p95: values[Math.ceil(n * 0.95) - 1]} : {}),
        ...(n >= 100 ? {p99: values[Math.ceil(n * 0.99) - 1]} : {}), max: values[n - 1]};
};

export const summarizePerformance = records => {
    const groups = new Map();
    for (const record of records) {
        let group = groups.get(record.operation);
        if (!group) {
            group = {duration_ms: [], stages_ms: new Map(), counts: new Map()};
            groups.set(record.operation, group);
        }
        group.duration_ms.push(record.duration_us / 1000);
        for (const [source, target, divisor] of [[record.stages_us, group.stages_ms, 1000], [record.counts, group.counts, 1]]) {
            for (const [name, value] of Object.entries(source || {})) {
                if (!target.has(name)) {
                    target.set(name, []);
                }
                target.get(name).push(value / divisor);
            }
        }
    }
    return Object.fromEntries(Array.from(groups, ([name, group]) => [name, {
        duration_ms: distribution(group.duration_ms),
        stages_ms: Object.fromEntries(Array.from(group.stages_ms, ([stage, values]) => [stage, distribution(values)])),
        counts: Object.fromEntries(Array.from(group.counts, ([count, values]) => [count, distribution(values)])),
    }]));
};

const main = async files => {
    if (!files.length) {
        throw new Error("Usage: node scripts/performance.mjs <capture.log> [other-capture.log ...]");
    }
    for (const file of files) {
        const records = [];
        let lineNumber = 0;
        for await (const line of createInterface({input: createReadStream(file, {encoding: "utf8"}), crlfDelay: Infinity})) {
            lineNumber++;
            try {
                const record = parsePerformanceLine(line);
                if (record) {
                    records.push(record);
                }
            } catch (error) {
                throw new Error(`${file}:${lineNumber}: ${error.message}`, {cause: error});
            }
        }
        if (!records.length) {
            throw new Error(`No performance records in ${file}`);
        }
        console.log(JSON.stringify({file, operations: summarizePerformance(records)}, null, 2));
    }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main(process.argv.slice(2));
}
