import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import * as ts from "typescript";
import {getAVOfferedFilterOperators, isAVDateType, isAVNumericFilterCalcOperator} from "./capabilities";

test("filter options preserve labels, order, selection and rollup distinctions", () => {
    const source = ts.createSourceFile("filter.ts", readFileSync(`${__dirname}/filter.ts`, "utf8"), ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find(node => ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(item => item.name.getText(source) === "getOperatorSelectByType"));
    const compiled = ts.transpileModule(`${declaration.getText(source)}\nreturn getOperatorSelectByType;`, {
        compilerOptions: {target: ts.ScriptTarget.ES2021},
    }).outputText;
    const options = new Function("window", "getAVOfferedFilterOperators", "isAVDateType", compiled)(
        {siyuan: {languages: new Proxy({}, {get: (_target, key) => String(key)})}},
        getAVOfferedFilterOperators, isAVDateType,
    );
    const baseline = JSON.parse(readFileSync(`${__dirname}/fixtures/filter-options.json`, "utf8"));
    for (const [type, expected] of Object.entries(baseline)) {
        assert.deepEqual([false, true].map(rollup => options(type, "Contains", rollup)), expected, type);
    }
});

test("rollup numeric filters preserve target fallback for range and unknown operators", () => {
    const numbers = ["Count all", "Count values", "Count unique values", "Count empty", "Count not empty",
        "Percent empty", "Percent not empty", "Percent unique values", "Sum", "Average", "Median", "Min", "Max",
        "Checked", "Unchecked", "Percent checked", "Percent unchecked"];
    for (const operator of numbers) {
        assert.equal(isAVNumericFilterCalcOperator(operator), true, operator);
    }
    for (const operator of ["", "Unique values", "Range", "Earliest", "Latest", "Template", "unknown", undefined]) {
        assert.equal(isAVNumericFilterCalcOperator(operator), false, operator);
    }
});
