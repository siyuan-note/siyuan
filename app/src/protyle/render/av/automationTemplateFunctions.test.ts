import * as assert from "node:assert/strict";
import {test} from "node:test";
import {automationTemplateFunctions, automationTemplateSpec} from "./automationTemplateFunctions";

test("automation capabilities ignore literal text, quotes, variables and template comments", () => {
    const source = 'httpGet .action{/* dict */}.action{$printf := "httpGet }"}.action{$printf}.action{.urlquery}.action{toString `dict`}.action{printf "%s" (urlquery "a b")}';
    assert.deepEqual([...automationTemplateFunctions(source)].sort(), ["printf", "toString", "urlquery"]);
});

test("formatting and event HTTP require format 10 while manual HTTP retains format 9", () => {
    for (const trigger of ["added", "changed", "manual"] as const) {
        const rule = {trigger, actions: [{type: "edit" as const, target: "current" as const,
            fields: {field: {mode: "template" as const, template: '.action{httpGet "https://example.com"}'}}}]};
        assert.equal(automationTemplateSpec(rule), trigger === "manual" ? 1 : 10);
        rule.actions[0].fields.field.template = '.action{printf "%s" "value"}';
        assert.equal(automationTemplateSpec(rule), 10);
    }
});
