import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {genTemplateDocTreePlanHTML, ITemplateDocTreePlan} from "./docTree";

describe("template document tree preview", () => {
    it("shows names, hierarchy and count for a preview without an insertion plan ID", () => {
        const plan: ITemplateDocTreePlan = {id: "", count: 2, nodes: [
            {id: "parent", parentID: "root", title: "Parent", hPath: "/Parent", depth: 0},
            {id: "child", parentID: "parent", title: "<Child>&", hPath: "/Parent/Child", depth: 1},
        ]};
        const html = genTemplateDocTreePlanHTML(plan, "New documents");
        assert.match(html, /padding-left: 4px/);
        assert.match(html, /padding-left: 22px/);
        assert.match(html, /Parent/);
        assert.match(html, /&lt;Child>&amp;/);
        assert.match(html, /class="counter">2</);
        assert.doesNotMatch(html, /<Child>/);
    });
});
