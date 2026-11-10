import * as assert from "node:assert/strict";
import {test} from "node:test";
import * as capabilities from "./capabilities";
import * as cellValue from "./cellValue";
import * as locationValue from "./locationValue";
import * as escape from "../../../util/escape";
import * as image from "../../../util/image";
import * as imageURL from "../../../util/imageURL";
import {loadModule} from "../../../testSupport/loadModule";

// 表格资源单元格直接拼接 innerHTML；未列出的依赖一旦被调用就立即失败，避免替身掩盖转义路径。
const dependencies: Record<string, unknown> = {
    "./capabilities": capabilities,
    "./cellValue": cellValue,
    "./locationValue": locationValue,
    "../../../util/escape": escape,
    "../../../util/image": image,
    "../../../util/imageURL": imageURL,
    "../../../util/functions": {
        objEquals: (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right),
    },
};

const cell = loadModule<typeof import("./cell")>("src/protyle/render/av/cell.ts", {
    require: (id: string) => dependencies[id] ?? new Proxy({}, {
        get: (_target, member) => {
            if (member === "__esModule") {
                return true;
            }
            throw new Error(`Unexpected dependency use in cell.ts: ${id}.${String(member)}`);
        },
    }),
    window: {siyuan: {languages: {empty: "Empty", copy: "Copy"}}},
});

const assetCell = (content: string) => ({
    type: "mAsset",
    mAsset: [{type: "image", name: "poc", content}],
} as IAVCellValue);

test("表格资源单元格转义图片地址中的引号", () => {
    const html = cell.renderCell(assetCell("assets/poc.png?x=1\" onerror=\"require('child_process')\""), 0, false, "table");

    assert.equal(html.includes(' onerror="'), false);
    assert.match(html, /src="assets\/poc\.png\?x=1&quot; onerror=&quot;/);
});

test("表格资源单元格保留已编码路径和查询串", () => {
    const html = cell.renderCell(assetCell("assets/%E6%B5%8B%E8%AF%95.png?box=1"), 0, false, "table");

    assert.match(html, /src="assets\/%E6%B5%8B%E8%AF%95\.png\?box=1&style=thumb"/);
});
