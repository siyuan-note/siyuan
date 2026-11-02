const assert = require("node:assert/strict");
const {test} = require("node:test");
const {createLocalWorkspaceDirQuery} = require("./workspaceInfo");

const origin = "https://127.0.0.1:6806";

test("the main process asks the local kernel for the workspace instead of the auth page", async () => {
    const requests = [];
    const query = createLocalWorkspaceDirQuery({
        fetch: async (url, init) => {
            requests.push([url, init.method]);
            return {json: async () => ({code: 0, data: {workspaceDir: "/Users/alice/SiYuan"}})};
        },
        writeLog: assert.fail,
    });
    assert.equal(await query({kernelTarget: {origin}, workspaceDir: "/Users/alice/SiYuan/"}), "/Users/alice/SiYuan");
    assert.deepEqual(requests, [["https://127.0.0.1:6806/api/system/getWorkspaceInfo", "POST"]]);
});

test("a failed workspace query keeps the workspace used to start the kernel", async () => {
    for (const fetch of [
        async () => { throw new Error("offline"); },
        async () => ({json: async () => ({code: -1, msg: "Auth failed"})}),
        async () => ({json: async () => ({code: 0, data: {workspaceDir: ""}})}),
    ]) {
        const logs: string[] = [];
        const query = createLocalWorkspaceDirQuery({fetch, writeLog: (message: string) => logs.push(message)});
        assert.equal(await query({kernelTarget: {origin}, workspaceDir: "/startup"}), "/startup");
        assert.equal(await query({kernelTarget: {origin}}), "");
        assert.equal(logs.length, 2);
    }
});
