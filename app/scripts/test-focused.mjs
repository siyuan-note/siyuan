import {spawnSync} from "node:child_process";
import {availableParallelism} from "node:os";
import {existsSync, statSync} from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";

export const focusedFiles = (arguments_, cwd = process.cwd()) => {
    const files = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
    if (files.length === 0) {
        throw new Error("Specify at least one existing .test.ts/.test.js/.test.mjs file");
    }
    return [...new Set(files.map(file => {
        if (file.startsWith("-") || /[*?\[\]{}]/.test(file)) {
            throw new Error(`Expected an explicit test file, not an option or glob: ${file}`);
        }
        const resolved = path.resolve(cwd, file);
        if (!/\.test\.(?:ts|js|mjs)$/.test(file) || !existsSync(resolved) || !statSync(resolved).isFile()) {
            throw new Error(`Test file does not exist or is not a test file: ${file}`);
        }
        return resolved;
    }))];
};

export const focusedArguments = files => [
    "--import", "tsx", "--experimental-test-module-mocks", "--test",
    `--test-concurrency=${Math.min(4, availableParallelism())}`,
    ...files,
];

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
    try {
        // Validate the entire selection before installing Electron or starting any test.
        const files = focusedFiles(process.argv.slice(2));
        createRequire(import.meta.url)("electron");
        const result = spawnSync(process.execPath, focusedArguments(files), {stdio: "inherit"});
        if (result.error) {
            throw result.error;
        }
        if (result.signal) {
            process.kill(process.pid, result.signal);
        } else {
            process.exitCode = result.status ?? 1;
        }
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
