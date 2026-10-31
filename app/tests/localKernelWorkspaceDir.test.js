const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../electron/main.js"), "utf8");
const start = source.indexOf("const getLocalKernelWorkspaceDir =");
const end = source.indexOf("const requestKernelExit =");

const load = fetch => {
    assert.ok(start > -1 && end > start, "getLocalKernelWorkspaceDir is declared before requestKernelExit");
    const logs = [];
    const getLocalKernelWorkspaceDir = new Function("net", "writeLog",
        source.slice(start, end) + ";return getLocalKernelWorkspaceDir;")({fetch}, message => logs.push(message));
    return {getLocalKernelWorkspaceDir, logs};
};

test("the main process asks the local kernel for its workspace instead of the auth page", async () => {
    const requests = [];
    const {getLocalKernelWorkspaceDir} = load(async (url, init) => {
        requests.push([url, init.method]);
        return {json: async () => ({code: 0, data: {workspaceDir: "/Users/alice/SiYuan"}})};
    });
    const item = {kernelTarget: {origin: "https://127.0.0.1:6806"}, workspaceDir: "/Users/alice/SiYuan/"};
    assert.equal(await getLocalKernelWorkspaceDir(item), "/Users/alice/SiYuan");
    assert.deepEqual(requests, [["https://127.0.0.1:6806/api/system/getWorkspaceInfo", "POST"]]);
});

test("a failed workspace query keeps the workspace used to start the kernel", async () => {
    for (const fetch of [
        async () => { throw new Error("offline"); },
        async () => ({json: async () => ({code: -1, msg: "Auth failed"})}),
        async () => ({json: async () => ({code: 0, data: {workspaceDir: ""}})}),
    ]) {
        const {getLocalKernelWorkspaceDir, logs} = load(fetch);
        const origin = "https://127.0.0.1:6806";
        assert.equal(await getLocalKernelWorkspaceDir({kernelTarget: {origin}, workspaceDir: "/startup"}), "/startup");
        assert.equal(await getLocalKernelWorkspaceDir({kernelTarget: {origin}}), "");
        assert.equal(logs.length, 2);
    }
});
