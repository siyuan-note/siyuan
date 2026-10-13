import {spawn, spawnSync} from "node:child_process";
import {copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {availableParallelism, tmpdir} from "node:os";
import {basename, dirname, join, resolve} from "node:path";
import {performance} from "node:perf_hooks";
import {fileURLToPath} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const kernel = join(root, "kernel");
const modelPackage = "github.com/siyuan-note/siyuan/kernel/model";
const apiPackage = "github.com/siyuan-note/siyuan/kernel/api";
const toolsPackage = "github.com/siyuan-note/siyuan/kernel/mcp/tools";
const utilPackage = "github.com/siyuan-note/siyuan/kernel/util";
const tags = ["-tags", "fts5 sqlcipher"];
// 分片构建与其他包分别限制原生编译并发，多个大包分片时分阶段执行。
const packageParallelism = Math.min(2, availableParallelism());
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const listTests = output => output.split(/\r?\n/).filter(name => /^(Test|Example|Fuzz)\S*$/.test(name));

// 核数较少时保留包间并行，避免其他包分片占用模型包有限的运行名额。
export const testPackageConfigurations = (shards, modelOnly, cores) => {
    const configurations = [{name: "model", package: modelPackage, count: shards}];
    if (!modelOnly && cores >= 4) {
        configurations.push({name: "api", package: apiPackage, count: Math.min(2, shards)});
        configurations.push({name: "mcp/tools", package: toolsPackage, count: Math.min(2, shards)});
        configurations.push({name: "util", package: utilPackage, count: Math.min(2, shards)});
    }
    return configurations;
};

// 按短前缀聚合，再按历史耗时均衡分配；每次从当前测试二进制读取用例，避免遗漏新增测试。
export const planShards = (names, count, durations) => {
    if (!Number.isInteger(count) || count < 1 || count > 16 || new Set(names).size !== names.length) {
        throw new Error("Invalid shard count or duplicate test names");
    }
    const buckets = new Map();
    for (const name of names) {
        const prefix = name.slice(0, durations.prefixLength);
        const bucket = buckets.get(prefix) ?? {prefix, names: []};
        bucket.names.push(name);
        buckets.set(prefix, bucket);
    }
    const shards = Array.from({length: Math.min(count, buckets.size)}, () => ({seconds: 0, names: [], prefixes: []}));
    for (const bucket of [...buckets.values()]) {
        const measured = durations.buckets[bucket.prefix];
        bucket.seconds = measured ? measured.seconds + Math.max(0, bucket.names.length - measured.tests) * durations.defaultSeconds :
            bucket.names.length * durations.defaultSeconds;
    }
    const ordered = [...buckets.values()].sort((a, b) => b.seconds - a.seconds || a.prefix.localeCompare(b.prefix, "en"));
    for (const bucket of ordered) {
        const shard = shards.reduce((best, item) => item.seconds < best.seconds ? item : best);
        shard.seconds += bucket.seconds;
        shard.names.push(...bucket.names);
        shard.prefixes.push(escapeRegex(bucket.prefix) + (bucket.prefix.length < durations.prefixLength ? "$" : ""));
    }
    for (const shard of shards) {
        shard.regex = "^(" + shard.prefixes.sort().join("|") + ")";
        const matches = names.filter(name => new RegExp(shard.regex).test(name)).sort();
        if (JSON.stringify(matches) !== JSON.stringify([...shard.names].sort())) {
            throw new Error("Shard selection does not match its assigned tests");
        }
    }
    return shards;
};

// 每个进程使用独立的当前目录，测试资源通过目录链接复用，隔离相对路径写入。
export const preparePackageWorkspace = (repository, workspace, name) => {
    if (!["model", "api", "mcp/tools", "util"].includes(name)) {
        throw new Error("Unsupported test package workspace: " + name);
    }
    const cwd = join(workspace, "kernel", name);
    mkdirSync(cwd, {recursive: true});
    const link = (source, destination) => symlinkSync(source, destination, process.platform === "win32" ? "junction" : "dir");
    for (const resource of ["app", "docs", "scripts"]) {
        if (existsSync(join(repository, resource))) {
            link(join(repository, resource), join(workspace, resource));
        }
    }
    // 嵌套包的祖先目录也必须独立，不能经由目录链接在源码树中创建运行时文件。
    const parts = name.split("/");
    for (let i = 0; i < parts.length; i++) {
        const relative = join("kernel", ...parts.slice(0, i));
        for (const entry of readdirSync(join(repository, relative), {withFileTypes: true})) {
            if (entry.isDirectory() && entry.name !== parts[i]) {
                link(join(repository, relative, entry.name), join(workspace, relative, entry.name));
            }
        }
    }
    for (const entry of readdirSync(join(repository, "kernel", name), {withFileTypes: true})) {
        if (entry.isDirectory()) {
            link(join(repository, "kernel", name, entry.name), join(cwd, entry.name));
        } else if (entry.isFile() && entry.name.endsWith(".go")) {
            // 源码检查用例读取同目录的 Go 文件，副本保留检查且隔离运行时文件。
            copyFileSync(join(repository, "kernel", name, entry.name), join(cwd, entry.name));
        }
    }
    return cwd;
};

const command = (args, cwd = kernel) => {
    const result = spawnSync("go", args, {cwd, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024});
    if (result.error || result.status !== 0) {
        throw result.error ?? new Error(result.stderr || result.stdout || `go exited with ${result.status}`);
    }
    return result.stdout;
};

export const runJSONJob = async ({name, args, cwd, expectedTests, executable = "go"}, output) => {
    const started = performance.now();
    const logPath = join(output, name + ".jsonl");
    const log = createWriteStream(logPath);
    const child = spawn(executable, args, {cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]});
    let pending = "";
    const completed = new Set();
    const failed = new Set();
    const tail = [];
    const consume = line => {
        log.write(line + "\n");
        try {
            const event = JSON.parse(line);
            if (event.Output) {
                tail.push(event.Output.trimEnd());
                if (tail.length > 100) {
                    tail.shift();
                }
            }
            if (event.Test && !event.Test.includes("/") && ["pass", "fail", "skip"].includes(event.Action)) {
                completed.add(event.Test);
            }
            if (event.Action === "fail") {
                failed.add(event.Test ?? event.Package);
            }
        } catch {
            tail.push(line);
        }
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", data => {
        pending += data;
        const lines = pending.split("\n");
        pending = lines.pop();
        lines.forEach(consume);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", data => {
        log.write(data);
        tail.push(data.trimEnd());
    });
    const code = await new Promise(resolve => {
        child.on("error", error => { tail.push(error.message); });
        child.on("close", resolve);
    });
    if (pending) {
        consume(pending);
    }
    await new Promise(resolve => log.end(resolve));
    const missing = expectedTests?.filter(test => !completed.has(test)) ?? [];
    const unexpected = expectedTests ? [...completed].filter(test => !expectedTests.includes(test)) : [];
    const result = {name, code: code ?? 1, seconds: (performance.now() - started) / 1000, tests: completed.size,
        failed: [...failed], missing, unexpected, logPath};
    if (result.code || failed.size || missing.length || unexpected.length) {
        result.code = 1;
        console.error(`${name} failed\n${tail.join("\n")}\nMissing: ${missing.join(", ")}\nUnexpected: ${unexpected.join(", ")}`);
    }
    console.log(`${name}: ${result.code ? "FAIL" : "PASS"}, ${result.tests} tests, ${result.seconds.toFixed(1)}s`);
    return result;
};

export const runJobs = async (jobs, concurrency, run) => {
    let next = 0;
    const results = new Array(jobs.length);
    await Promise.all(Array.from({length: Math.min(concurrency, jobs.length)}, async () => {
        while (next < jobs.length) {
            const index = next++;
            results[index] = await run(jobs[index]);
        }
    }));
    return results;
};

// 未分片作业还包含构建耗时，优先启动，避免仅按分片测试耗时排序将其推后。
export const orderJobs = jobs => jobs.sort((a, b) => Number(b.name === "other-packages") - Number(a.name === "other-packages") ||
    b.seconds - a.seconds || a.name.localeCompare(b.name, "en"));

const main = async () => {
    const options = {shards: Math.min(4, availableParallelism()), modelOnly: false, output: undefined};
    for (let i = 2; i < process.argv.length; i++) {
        const argument = process.argv[i];
        if (argument === "--model-only") {
            options.modelOnly = true;
        } else if (argument === "--shards") {
            options.shards = Number(process.argv[++i]);
        } else if (argument === "--output") {
            options.output = resolve(process.argv[++i]);
        } else {
            throw new Error("Unknown argument: " + argument);
        }
    }
    if (!Number.isInteger(options.shards) || options.shards < 1 || options.shards > 16) {
        throw new Error("--shards must be an integer between 1 and 16");
    }
    const started = performance.now();
    const workspace = mkdtempSync(join(tmpdir(), "siyuan-kernel-tests-"));
    const output = options.output ?? mkdtempSync(join(tmpdir(), "siyuan-kernel-results-"));
    mkdirSync(output, {recursive: true});
    let otherJob;
    let otherFinished = false;
    try {
        const configurations = testPackageConfigurations(options.shards, options.modelOnly, availableParallelism());
        const otherPackagesJob = parallelism => {
            const sharded = new Set(configurations.map(configuration => configuration.package));
            const packages = command(["list", ...tags, "./..."]).trim().split(/\r?\n/).filter(name => !sharded.has(name));
            return {name: "other-packages", cwd: kernel, seconds: 0,
                args: ["test", ...tags, "-p", String(parallelism), "-json", "-count=1", ...packages]};
        };
        const startOtherPackages = () => {
            otherJob = runJSONJob(otherPackagesJob(packageParallelism), output).then(result => [result])
                .finally(() => { otherFinished = true; });
        };
        if (!options.modelOnly && configurations.length === 1) {
            startOtherPackages();
        }
        const binaries = join(workspace, "binaries");
        mkdirSync(binaries);
        // 同一次 Go 构建共享依赖，每个包只链接一次，原生编译与测试运行分开控制并发。
        await new Promise((resolve, reject) => {
            const compiler = spawn("go", ["test", ...tags, "-p", String(packageParallelism), "-c", "-o", binaries,
                ...configurations.map(configuration => "./" + configuration.name)], {
                cwd: kernel, windowsHide: true, stdio: "inherit",
            });
            compiler.on("error", reject);
            compiler.on("close", code => code === 0 ? resolve() : reject(new Error("Sharded test compilation failed: " + code)));
        });
        const jobs = [];
        const backgroundJobs = [];
        const inventory = {};
        for (const configuration of configurations) {
            const jobName = configuration.name.replaceAll("/", "-");
            const base = join(binaries, basename(configuration.name) + ".test");
            const binary = process.platform === "win32" && existsSync(base + ".exe") ? base + ".exe" : base;
            const listed = spawnSync(binary, ["-test.list=."], {
                cwd: join(kernel, configuration.name), encoding: "utf8", windowsHide: true,
            });
            if (listed.error || listed.status !== 0) {
                throw listed.error ?? new Error(listed.stderr);
            }
            const names = listTests(listed.stdout);
            if (!names.length) {
                throw new Error("No tests discovered for " + configuration.package);
            }
            const durations = JSON.parse(readFileSync(join(root, "scripts", "kernel-" + jobName + "-test-durations.json"), "utf8"));
            const shards = planShards(names, configuration.count, durations);
            inventory[configuration.name] = {tests: names.length, shards: shards.length};
            const destination = ["model", "api"].includes(configuration.name) ? jobs : backgroundJobs;
            destination.push(...shards.map((shard, i) => ({name: jobName + "-" + (i + 1), seconds: shard.seconds, expectedTests: shard.names,
                cwd: preparePackageWorkspace(root, join(workspace, jobName + "-shard-" + i), configuration.name),
                args: ["tool", "test2json", "-t", "-p", configuration.package, binary, "-test.v=test2json", "-test.count=1", "-test.timeout=10m", "-test.run=" + shard.regex]})));
        }
        if (backgroundJobs.length) {
            // 复用其他包原有的两个运行名额，避免新分片挤占模型与 API 的名额。
            // 未分片包使用一个名额并限制为 -p 1，测试进程上限与原有 -p 2 作业一致。
            backgroundJobs.push(otherPackagesJob(1));
            otherJob = runJobs(orderJobs(backgroundJobs), packageParallelism, job => runJSONJob(job, output))
                .finally(() => { otherFinished = true; });
        } else if (!options.modelOnly && !otherJob) {
            startOtherPackages();
        }
        const concurrency = Math.min(4, Math.max(1, availableParallelism() - (otherJob && !otherFinished ? 1 : 0)));
        console.log(`Running ${jobs.length} model/API shards (${concurrency} workers) and ${backgroundJobs.length} other jobs ` +
            `(${backgroundJobs.length ? packageParallelism : 0} workers); logs: ${output}`);
        const results = await runJobs(orderJobs(jobs), concurrency, job => runJSONJob(job, output));
        if (otherJob) {
            results.unshift(...await otherJob);
        }
        const summary = {seconds: (performance.now() - started) / 1000, modelTests: inventory.model.tests, shards: inventory.model.shards,
            apiTests: inventory.api?.tests ?? 0, apiShards: inventory.api?.shards ?? 0, packages: inventory, results};
        writeFileSync(join(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
        console.log(`Kernel tests: ${summary.seconds.toFixed(1)}s; summary: ${join(output, "summary.json")}`);
        process.exitCode = results.some(result => result.code) ? 1 : 0;
    } finally {
        if (otherJob) {
            await otherJob;
        }
        // 只删除本次创建的临时目录；目录链接的目标资源保留。
        if (dirname(resolve(workspace)) !== resolve(tmpdir()) || !basename(workspace).startsWith("siyuan-kernel-tests-")) {
            throw new Error("Unsafe temporary workspace path");
        }
        rmSync(workspace, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
    }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
