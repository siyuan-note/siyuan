const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const selectionFailure = (diagnosticFailure = false) => {
    const file = path.join(__dirname, "inlineMathSelection.test.js");
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    let drag;
    let validateDragPoints;
    const visit = node => {
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === "drag") {
            drag = node.initializer.getText(source);
        }
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === "validateDragPoints") {
            validateDragPoints = node.initializer.getText(source);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(drag);
    assert.ok(validateDragPoints);
    const script = `const assert = require("node:assert/strict");
const validateDragPoints = ${validateDragPoints};
const win = {webContents: {executeJavaScript: async source => {
    if (source.includes("Invalid native selection drag")) return true;
    if (source === "getSelection().toString()") return "";
    if (${diagnosticFailure} && source.includes("const describePoint")) throw new Error("Renderer disposed");
    return {mode: "left", direction: "forward", events: [{phase: "mouseup", text: "", collapsed: true}]};
}}};
const send = async () => {};
(${drag})({x: 32, y: 64}, {x: 48, y: 64}, true).catch(error => {
    console.error(error);
    process.exitCode = 1;
});`;
    let failure;
    try {
        execFileSync(process.execPath, ["-e", script], {encoding: "utf8", stdio: "pipe", timeout: 5000});
    } catch (error) {
        failure = error;
    }
    assert.equal(failure?.status, 1, "the native-selection assertion must remain a failure");
    assert.match(failure.stderr, /AssertionError \[ERR_ASSERTION\]/);
    assert.match(failure.stderr, /at drag|at eval|at \[eval\]/);
    return failure.stderr;
};

test("inline math failures print selection diagnostics alongside the original assertion stack", () => {
    const stderr = selectionFailure();
    assert.match(stderr, /Selection diagnostics: /);
    const diagnostics = JSON.parse(stderr.split("Selection diagnostics: ")[1].split("\n")[0]);
    assert.deepEqual(diagnostics, {mode: "left", direction: "forward",
        events: [{phase: "mouseup", text: "", collapsed: true}]});
});

test("inline math diagnostic collection failures retain the original selection assertion", () => {
    assert.match(selectionFailure(true), /Selection diagnostics unavailable: Error: Renderer disposed/);
});
