import * as assert from "node:assert/strict";
import {readdirSync, readFileSync} from "node:fs";
import {join, relative} from "node:path";
import {test} from "node:test";

// 独立资源、工作空间切换、布局和同步来源事务保留其专用协议。
const dedicated = new Set([
    "/api/setting/setBootAppearance",
    "/api/sync/setSyncProvider", "/api/repo/setSnapshotMemo",
]);

test("desktop and mobile configuration writes use the shared gateway", () => {
    const walk = (directory: string) => {
        for (const entry of readdirSync(directory, {withFileTypes: true})) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) { walk(path); continue; }
            if (!path.endsWith(".ts") || path.endsWith(".test.ts")) continue;
            const file = relative("src", path).replaceAll("\\", "/");
            if (["config/util/configApi.ts", "config/util/resourceConfig.ts"].includes(file)) continue;
            const source = readFileSync(path, "utf8");
            const writes = source.matchAll(/(?:fetchPost|fetchSyncPost)\(\s*"(\/api\/(?:setting\/(?:patch|set\w+)|system\/set\w+|sync\/set\w+|repo\/set\w+|asset\/setOCRConfig|graph\/setGraphConf))"/g);
            for (const write of writes) assert.ok(dedicated.has(write[1]), `${file} bypasses config.set through ${write[1]}`);
            const resourceWrites = source.matchAll(/(?:fetchPost|fetchSyncPost|postFile)\(\s*"(\/api\/(?:system\/(?:setWorkspaceDir|setUILayout|importConf)|storage\/(?:removeCriterion|setOutlineStorage)|notebook\/setNotebookConf))"/g);
            for (const write of resourceWrites) assert.fail(`${file} bypasses the resource configuration gateway through ${write[1]}`);
        }
    };
    walk("src");
});
