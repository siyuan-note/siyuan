const assert = require("node:assert/strict");
const {readFileSync, readdirSync, statSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");

const guideRoot = path.resolve(__dirname, "../guide");
const guideIDs = ["20210808180117-6v0mkxr", "20210808180117-czj9bvb", "20211226090932-5lcq56f", "20240530133126-axarxgx"];

function* documents(directory) {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            yield* documents(file);
        } else if (entry.name.endsWith(".sy")) {
            yield file;
        }
    }
}

function* mediaNodes(node) {
    if (node.Type === "NodeAudio" || node.Type === "NodeVideo") {
        yield node;
    }
    for (const child of node.Children || []) {
        yield* mediaNodes(child);
    }
}

for (const guideID of guideIDs) {
    test(`bundled media asset references exist in guide ${guideID}`, () => {
        const root = path.join(guideRoot, guideID);
        const types = new Set();
        for (const file of documents(root)) {
            for (const node of mediaNodes(JSON.parse(readFileSync(file, "utf8")))) {
                types.add(node.Type);
                assert.match(node.Data, /\ssrc="assets\//, `${file}: ${node.ID}`);
                for (const attribute of node.Data.matchAll(/\b[\w-]+="(assets\/[^"?#]+)(?:[?#][^"]*)?"/g)) {
                    assert.ok(statSync(path.join(root, attribute[1])).isFile(), `${file}: ${attribute[1]}`);
                }
            }
        }
        assert.deepEqual([...types].sort(), ["NodeAudio", "NodeVideo"]);
    });
}
