export type TCloudUser = NonNullable<typeof window.siyuan.user>;

interface ICloudUserRefreshAction {
    apply: boolean;
    user: TCloudUser | null;
    userName: string;
}

let cloudLoginUserName = "";
let cloudUserSession = 0;

export const getCloudLoginUserName = () => cloudLoginUserName;
export const getCloudUserSession = () => cloudUserSession;

export const setCloudUser = (user: TCloudUser | null, userName = "") => {
    // 重复的响应和推送保持登录状态，新增登录或切换账号时报告状态变化。
    const loggedIn = Boolean(user && (!window.siyuan.user || window.siyuan.user.userId !== user.userId));
    if (window.siyuan.user?.userId !== user?.userId) {
        cloudUserSession++;
    }
    window.siyuan.user = user;
    cloudLoginUserName = user ? "" : userName;
    return loggedIn;
};

export const resolveCloudUserRefresh = (
    code: number,
    user: TCloudUser | {closeTimeout: number} | null,
    previousUserName: string,
): ICloudUserRefreshAction => {
    const cloudUser = user && "userName" in user ? user : null;
    if (code === 0) {
        return {apply: true, user: cloudUser, userName: ""};
    }
    if (code === 255) {
        return {apply: true, user: null, userName: previousUserName};
    }
    return {apply: false, user: cloudUser, userName: ""};
};

// 同一会话合并进行中的刷新；自动刷新限制为每分钟一次，手动刷新不受冷却限制。
export const createCloudUserRefresh = <T>(request: (key: string) => Promise<T>, now = Date.now) => {
    type RefreshState = {key: string; attemptedAt: number; pending?: Promise<T>};
    let state: RefreshState | undefined;
    return (key: string, force = false): Promise<T | undefined> => {
        if (state?.key === key) {
            if (state.pending) {
                return state.pending;
            }
            if (!force && now() - state.attemptedAt < 60000) {
                return Promise.resolve(undefined);
            }
        }
        const current: RefreshState = {key, attemptedAt: now()};
        state = current;
        current.pending = Promise.resolve().then(() => request(key)).finally(() => {
            current.pending = undefined;
        });
        return current.pending;
    };
};
