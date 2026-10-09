import {test} from "node:test";
import * as assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, rmdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {reportWorkflowOutcomes} from "./report-workflow-outcomes.mjs";

test("non-blocking failures remain visible despite a successful conclusion", () => {
    const {warnings, summary} = reportWorkflowOutcomes({
        tests: {outcome: "failure", conclusion: "success"},
        success: {outcome: "success", conclusion: "success"},
        skipped: {outcome: "skipped", conclusion: "skipped"},
        blocking: {outcome: "failure", conclusion: "failure"},
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /^::warning.*tests failed/);
    assert.match(summary, /`tests`: failure/);
    assert.doesNotMatch(summary, /`success`|`skipped`|`blocking`/);
});

test("successful jobs still produce a clear summary", () => {
    const {warnings, summary} = reportWorkflowOutcomes({});
    assert.deepEqual(warnings, []);
    assert.match(summary, /No non-blocking step failures/);
});

test("workflow command writes the summary and emits an annotation", (t) => {
    const directory = mkdtempSync(join(tmpdir(), "siyuan-workflow-report-"));
    const summaryPath = join(directory, "summary.md");
    t.after(() => {
        rmSync(summaryPath, {force: true});
        rmdirSync(directory);
    });
    const output = execFileSync(process.execPath, [fileURLToPath(new URL("./report-workflow-outcomes.mjs", import.meta.url))], {
        env: {...process.env, WORKFLOW_STEPS: JSON.stringify({tests: {outcome: "failure", conclusion: "success"}}),
            GITHUB_STEP_SUMMARY: summaryPath}, encoding: "utf8",
    });
    assert.match(output, /::warning.*tests failed/);
    assert.match(readFileSync(summaryPath, "utf8"), /`tests`: failure/);
});
