import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {resolveSlashMenuItems, TSlashMenuItem} from "./slashMenu";

test("the map slash entry is searchable and creates a map database block", () => {
    const source = ts.createSourceFile("extend.ts", readFileSync(join(__dirname, "extend.ts"), "utf8"),
        ts.ScriptTarget.Latest, true);
    let declaration: ts.ObjectLiteralExpression;
    const visit = (node: ts.Node) => {
        if (ts.isObjectLiteralExpression(node) && node.properties.some(property =>
            ts.isPropertyAssignment(property) && property.name.getText(source) === "id" &&
            ts.isStringLiteral(property.initializer) && property.initializer.text === "databaseMapView")) {
            declaration = node;
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(declaration);
    const item: TSlashMenuItem = runInNewContext(ts.transpileModule(`(${declaration.getText(source)})`, {
        compilerOptions: {target: ts.ScriptTarget.ES2020},
    }).outputText, {window: {siyuan: {languages: {databaseMapView: "Database map view"}}}});
    item.entryKey = item.id;
    const options = {enabled: true, hideConfiguredCreate: false, order: [item.id], visible: () => true};
    for (const key of ["data", "map", "地图", "ditu"]) {
        assert.equal(resolveSlashMenuItems([item], {...options, key})[0], item);
    }
    assert.equal(item.value, '<div data-type="NodeAttributeView" data-av-type="map"></div>');
    assert.match(item.html, /#iconGlobe/);
    assert.match(item.html, /Database map view/);
    assert.equal(resolveSlashMenuItems([item], {...options, key: "map", visible: () => false}).length, 0);
    assert.equal(resolveSlashMenuItems([item], {...options, key: "map", lite: true}).length, 0);
});
