import {appendFileSync} from "node:fs";
import {pathToFileURL} from "node:url";

export const reportWorkflowOutcomes = (steps) => {
    const failed = Object.entries(steps).filter(([, step]) => step.outcome === "failure" && step.conclusion === "success");
    const warnings = failed.map(([id]) => `::warning title=Non-blocking step failed::${id} failed; continue-on-error kept the job running`);
    const summary = "### Non-blocking step outcomes\n\n" + (failed.length ?
        "The following steps failed without blocking the job:\n\n" + failed.map(([id]) => `- \`${id}\`: failure`).join("\n") :
        "No non-blocking step failures.") + "\n";
    return {warnings, summary};
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const {warnings, summary} = reportWorkflowOutcomes(JSON.parse(process.env.WORKFLOW_STEPS));
    warnings.forEach(warning => console.log(warning));
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
}
