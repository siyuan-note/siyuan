import {fetchWithAppId} from "./fetchWithAppId";
import {withFetchTimeout} from "./fetchTimeout";

let connectionRevision = 0;
let pendingCheck: Promise<boolean>;

export const markKernelConnectionAlive = () => {
    connectionRevision++;
};

const probeKernelConnection = async (revision: number) => {
    for (let attempt = 0; attempt < 3; attempt++) {
        if (revision !== connectionRevision) {
            return true;
        }
        try {
            const alive = await withFetchTimeout(async signal => {
                const response = await fetchWithAppId("/api/system/version", {cache: "no-store", signal});
                if (!response.ok) {
                    return false;
                }
                const result = await response.json();
                return result?.code === 0 && typeof result.data === "string";
            }, undefined, 1500);
            if (alive || revision !== connectionRevision) {
                return true;
            }
        } catch {
            if (revision !== connectionRevision) {
                return true;
            }
        }
        if (attempt < 2) {
            await new Promise<void>(resolve => setTimeout(resolve, 300));
        }
    }
    return revision !== connectionRevision;
};

// 多处连接错误共用只读探测，不重放结果不明的写请求。
export const checkKernelConnection = () => {
    if (!pendingCheck) {
        pendingCheck = probeKernelConnection(connectionRevision).finally(() => {
            pendingCheck = undefined;
        });
    }
    return pendingCheck;
};
