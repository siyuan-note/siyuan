import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getTemplateTree, TemplateEntry} from "./fileTree";

const entries: TemplateEntry[] = [
    {path: "note10.md", isDir: false},
    {path: "Work/Weekly/Review.md", isDir: false},
    {path: "Work/daily.md", isDir: false},
    {path: "Work/Weekly", isDir: true},
    {path: "Work", isDir: true, isPackage: true},
    {path: "Empty", isDir: true},
    {path: "note2.md", isDir: false},
];

describe("template file tree", () => {
    it("groups folders first and naturally sorts files without changing the input", () => {
        const original = entries.slice();
        const rows = getTemplateTree(entries, "", new Set());
        assert.deepEqual(rows.map(item => item.path), ["Empty", "Work", "note2.md", "note10.md"]);
        assert.equal(rows[1].isPackage, true);
        assert.deepEqual(entries, original);
    });

    it("respects nested expansion and keeps empty directories", () => {
        const rows = getTemplateTree(entries, "", new Set(["Work", "Work/Weekly", "Empty"]));
        assert.deepEqual(rows.map(item => [item.path, item.depth]), [
            ["Empty", 0], ["Work", 0], ["Work/Weekly", 1], ["Work/Weekly/Review.md", 2],
            ["Work/daily.md", 1], ["note2.md", 0], ["note10.md", 0],
        ]);
        assert.equal(rows[3].name, "Review.md");
    });

    it("searches names case-insensitively and reveals ancestors without changing expansion", () => {
        const expanded = new Set(["Empty"]);
        const rows = getTemplateTree(entries, " REVIEW ", expanded);
        assert.deepEqual(rows.map(item => item.path), ["Work", "Work/Weekly", "Work/Weekly/Review.md"]);
        assert.equal(rows[0].expanded, true);
        assert.equal(rows[1].expanded, true);
        assert.deepEqual([...expanded], ["Empty"]);
        assert.deepEqual(getTemplateTree(entries, "", expanded).map(item => item.path),
            ["Empty", "Work", "note2.md", "note10.md"]);
    });

    it("matches full paths and includes descendants of matching folders", () => {
        assert.deepEqual(getTemplateTree(entries, "work/week", new Set()).map(item => item.path),
            ["Work", "Work/Weekly", "Work/Weekly/Review.md"]);
        assert.deepEqual(getTemplateTree(entries, "missing", new Set()), []);
        assert.deepEqual(getTemplateTree([], "", new Set()), []);
    });
});
