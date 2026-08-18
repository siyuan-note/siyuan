import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {filterTagData, getTagFilterKeywords} from "./tagFilter";

const tag = (label: string, children?: IBlockTree[]) => ({
    name: label.split("/").pop(),
    label,
    children,
} as IBlockTree);

describe("tag filtering", () => {
    it("splits keywords and ignores case and extra whitespace", () => {
        assert.deepEqual(getTagFilterKeywords("  Project   TODO  "), ["project", "todo"]);
    });

    it("requires every keyword to match the complete tag label", () => {
        const data = [
            tag("Project", [tag("Project/Status", [tag("Project/Status/Todo")]), tag("Project/Topic")]),
            tag("Archive"),
        ];
        const filtered = filterTagData(data, ["project", "todo"], value => value);
        assert.deepEqual(filtered.map(item => item.label), ["Project"]);
        assert.deepEqual(filtered[0].children.map(item => item.label), ["Project/Status"]);
        assert.deepEqual(filtered[0].children[0].children.map(item => item.label), ["Project/Status/Todo"]);
        assert.equal(data[0].children.length, 2);
    });

    it("keeps ancestors when only a child matches", () => {
        const filtered = filterTagData([
            tag("Project", [tag("Project/Status")]),
        ], ["status"], value => value);
        assert.equal(filtered[0].label, "Project");
        assert.equal(filtered[0].children[0].label, "Project/Status");
    });

    it("matches unescaped labels", () => {
        const filtered = filterTagData([tag("A/&lt;Draft&gt;")], ["<draft>"], value => value.replace("&lt;", "<").replace("&gt;", ">"));
        assert.equal(filtered.length, 1);
    });
});
