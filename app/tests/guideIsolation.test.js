const assert = require("node:assert/strict");
const {readFileSync, readdirSync, statSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");

const guideRoot = path.resolve(__dirname, "../guide");
const zhGuideID = "20210808180117-czj9bvb";
const ruGuideID = "20261122113000-kt3e4wz";
const startDocs = {
    [zhGuideID]: "20200812220555-lj3enxa",
    [ruGuideID]: "20261122113000-m9xlls7",
};
const idPattern = /\b\d{14}-[a-z0-9]{7}\b/g;

function* walkFiles(dir) {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            yield* walkFiles(full);
        } else {
            yield full;
        }
    }
}

function collectGuideData(guideID) {
    const root = path.join(guideRoot, guideID);
    const assetIDs = new Set();
    const assetsDir = path.join(root, "assets");
    for (const file of walkFiles(assetsDir)) {
        for (const match of path.basename(file).match(idPattern) || []) {
            assetIDs.add(match);
        }
    }

    const nonAssetIDs = new Set([guideID]);
    const blockIDs = new Set();
    const avFiles = new Set();
    const avRefs = new Set();
    const blockRefs = [];

    for (const file of walkFiles(root)) {
        const rel = path.relative(root, file);
        if (rel.startsWith(`assets${path.sep}`)) {
            continue;
        }
        if (file.endsWith(".sy")) {
            const raw = readFileSync(file, "utf8");
            for (const match of raw.match(idPattern) || []) {
                if (!assetIDs.has(match)) {
                    nonAssetIDs.add(match);
                }
            }
            const doc = JSON.parse(raw);
            const visit = node => {
                if (!node || typeof node !== "object") {
                    return;
                }
                if (typeof node.ID === "string" && node.ID.length > 0) {
                    blockIDs.add(node.ID);
                    nonAssetIDs.add(node.ID);
                }
                if (node.Properties && typeof node.Properties.id === "string" && node.Properties.id.length > 0) {
                    blockIDs.add(node.Properties.id);
                    nonAssetIDs.add(node.Properties.id);
                }
                if (node.Type === "NodeAttributeView" && node.AttributeViewID) {
                    avRefs.add(node.AttributeViewID);
                }
                if (node.Type === "NodeTextMark" && node.TextMarkType === "block-ref" && node.TextMarkBlockRefID) {
                    blockRefs.push({file: rel, refID: node.TextMarkBlockRefID});
                }
                for (const value of Object.values(node)) {
                    if (Array.isArray(value)) {
                        value.forEach(visit);
                    } else if (value && typeof value === "object") {
                        visit(value);
                    }
                }
            };
            visit(doc);
        } else if (rel.startsWith(`storage${path.sep}av${path.sep}`) && file.endsWith(".json")) {
            const avID = path.basename(file, ".json");
            avFiles.add(avID);
            const raw = readFileSync(file, "utf8");
            for (const match of raw.match(idPattern) || []) {
                if (!assetIDs.has(match)) {
                    nonAssetIDs.add(match);
                }
            }
        }
    }

    return {root, nonAssetIDs, blockIDs, avFiles, avRefs, blockRefs};
}

test("Russian and Simplified Chinese guides have disjoint IDs, AV files, and landing pages", () => {
    const zh = collectGuideData(zhGuideID);
    const ru = collectGuideData(ruGuideID);

    assert.notEqual(startDocs[zhGuideID], startDocs[ruGuideID]);
    assert.ok(statSync(path.join(zh.root, `${startDocs[zhGuideID]}.sy`)).isFile());
    assert.ok(statSync(path.join(ru.root, `${startDocs[ruGuideID]}.sy`)).isFile());

    const ruBoxDoc = JSON.parse(readFileSync(path.join(ru.root, ".siyuan/boxDoc.json"), "utf8"));
    assert.equal(ruBoxDoc.boxDocID, ruGuideID);
    assert.ok(statSync(path.join(ru.root, `${ruGuideID}.sy`)).isFile());

    for (const id of ru.blockIDs) {
        assert.match(id, /^\d{14}-[a-z0-9]{7}$/, `Russian guide block ID has invalid format: ${id}`);
    }
    for (const id of ru.nonAssetIDs) {
        assert.equal(zh.nonAssetIDs.has(id), false, `shared non-asset ID between zh-CN and ru guides: ${id}`);
    }
    assert.equal(ru.avFiles.size, 4);
    for (const avID of ru.avFiles) {
        assert.equal(zh.avFiles.has(avID), false, `shared attribute-view ID between zh-CN and ru guides: ${avID}`);
    }
    for (const avID of ru.avRefs) {
        assert.ok(ru.avFiles.has(avID), `Russian guide references missing AV file: ${avID}`);
    }
    for (const {file, refID} of ru.blockRefs) {
        assert.ok(ru.blockIDs.has(refID), `Russian guide ${file} references unknown block ID: ${refID}`);
    }
});
