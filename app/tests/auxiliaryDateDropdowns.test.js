const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const ts = require("typescript");

const sources = Object.fromEntries(Object.entries({
    "history/repoPanel": readFileSync(path.join(__dirname, "../src/history/repoPanel.ts"), "utf8"),
    "emoji/index": readFileSync(path.join(__dirname, "../src/emoji/index.ts"), "utf8"),
}).map(([name, text]) => {
    return [name, {text, node: ts.createSourceFile(name + ".ts", text, ts.ScriptTarget.Latest, true)}];
}));
const find = (node, predicate) => {
    if (predicate(node)) { return node; }
    return ts.forEachChild(node, child => find(child, predicate));
};
const evaluate = (node, source, dependencies) => {
    const compiled = ts.transpileModule(`const callback = ${node.getText(source.node)};`, {
        compilerOptions: {target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS},
    }).outputText;
    return new Function(...Object.keys(dependencies), compiled + "\nreturn callback;")(...Object.values(dependencies));
};
const variable = (source, name, dependencies) => evaluate(find(source.node, node =>
    ts.isVariableDeclaration(node) && node.name.getText(source.node) === name).initializer, source, dependencies);
const listener = (source, target, type, dependencies) => evaluate(find(source.node, node =>
    ts.isCallExpression(node) && node.expression.getText(source.node) === target + ".addEventListener" &&
    ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === type).arguments[1], source, dependencies);

test("snapshot and dynamic icon dates use shared dropdown bindings without inline hosts", () => {
    for (const source of Object.values(sources)) {
        assert.match(source.text, /import \{bindDatePicker\} from "\.\.\/datePicker\/binding";/);
        assert.doesNotMatch(source.text, /bindInlineDatePicker|datePicker\/inline/);
        assert.doesNotMatch(source.text, /data-role="(?:dynamic-)?date-calendar"/);
    }
    assert.match(sources["history/repoPanel"].text, /\[startDate, endDate\]\.map\(input => bindDatePicker\(input\)\)/);
    assert.match(sources["emoji/index"].text, /const dynamicDatePicker = bindDatePicker\(dynamicDateElement\)/);
});

test("snapshot dropdowns retain bidirectional range limits and the explicit filter boundary", () => {
    const source = sources["history/repoPanel"];
    const startDate = {value: "2026-11-01"};
    const endDate = {value: "2026-11-30"};
    const update = variable(source, "updateDateLimits", {startDate, endDate});
    update();
    assert.equal(startDate.max, endDate.value);
    assert.equal(endDate.min, startDate.value);
    startDate.value = endDate.value = "";
    update();
    assert.equal(startDate.max, "9999-12-31");
    assert.equal(endDate.min, "1970-01-01");

    const state = {busy: false};
    let valid = false;
    let applied = 0;
    let validated = 0;
    const submit = listener(source, "dateForm", "submit", {state,
        dateForm: {reportValidity() { validated++; return valid; }},
        applyRange: () => applied++,
    });
    const event = {preventDefault() {}, stopPropagation() {}};
    submit(event);
    assert.equal(applied, 0);
    valid = true;
    state.busy = true;
    submit(event);
    assert.equal(validated, 1, "busy operations do not submit the date range");
    state.busy = false;
    submit(event);
    assert.equal(applied, 1, "valid ranges apply only through the submit handler");
    assert.match(source.text, /startDate\.addEventListener\("change", updateDateLimits\)/);
    assert.match(source.text, /endDate\.addEventListener\("change", updateDateLimits\)/);
});

test("dynamic icon date changes validate and update previews without saving an icon", () => {
    const source = sources["emoji/index"];
    let valid = true;
    let preview = "/api/icon/getDynamicIcon?type=1&color=%23d23f31&date=2026-10-26";
    let queries = 0;
    const dynamicDateElement = {value: "2026-11-15", checkValidity: () => valid};
    const change = listener(source, "dynamicDateElement", "change", {dynamicDateElement, URLSearchParams,
        dynamicURL: "/api/icon/getDynamicIcon?",
        dayjs: value => ({format: () => value}),
        dialog: {element: {querySelectorAll() {
            queries++;
            return [{getAttribute: () => preview, setAttribute: (_name, value) => { preview = value; }}];
        }}},
    });
    change();
    assert.equal(new URL(preview, "http://localhost").searchParams.get("date"), "2026-11-15");
    valid = false;
    dynamicDateElement.value = "10000-01-01";
    change();
    assert.equal(queries, 1, "invalid native dates leave the preview unchanged");
    valid = true;
    dynamicDateElement.value = "";
    change();
    assert.equal(new URL(preview, "http://localhost").searchParams.get("date"), "");
    assert.match(source.text, /if \(dynamicColorPending \|\| !dynamicDateElement\.checkValidity\(\)\)/);
});

test("snapshot replacement and owner disposal release dropdown bindings", () => {
    const snapshot = sources["history/repoPanel"].text;
    assert.match(snapshot, /states\.get\(root\)\?\.datePickers\?\.forEach\(picker => picker\.destroy\(\)\)/);
    assert.match(snapshot, /return \(\) => \{\s*observer\.disconnect\(\);\s*datePickers\.forEach\(picker => picker\.destroy\(\)\);/);
    assert.match(sources["emoji/index"].text, /destroyCallback: \(\) => \{\s*dynamicDatePicker\?\.destroy\(\)/);
});
