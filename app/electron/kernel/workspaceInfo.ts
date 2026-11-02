// 本机内核对环回地址的 getWorkspaceInfo 免认证放行。授权页在登录前加载，内核不会向其下发工作空间路径，
// 因此改由主进程直接向本机内核查询；查询失败时沿用启动内核时的工作空间路径。
type WorkspaceInfoPayload = {code?: number; data?: {workspaceDir?: string}};

type WorkspaceInfoResponse = {json: () => Promise<WorkspaceInfoPayload>};

const createLocalWorkspaceDirQuery = ({fetch, writeLog}: {
    fetch: (url: string, init: {method: "POST"}) => Promise<WorkspaceInfoResponse>;
    writeLog: (message: string) => void;
}) =>
    async (workspace: {kernelTarget: {origin: string}; workspaceDir?: string}): Promise<string> => {
        try {
            const result = await (await fetch(workspace.kernelTarget.origin + "/api/system/getWorkspaceInfo",
                {method: "POST"})).json();
            if (0 === result.code && "string" === typeof result.data?.workspaceDir && result.data.workspaceDir) {
                return result.data.workspaceDir;
            }
            writeLog("get workspace info failed [code=" + result.code + "]");
        } catch (e) {
            writeLog("get workspace info failed: " + e);
        }
        return workspace.workspaceDir || "";
    };

export {createLocalWorkspaceDirQuery};
