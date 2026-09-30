export type TCloudUser = NonNullable<typeof window.siyuan.user>;

interface ICloudUserRefreshAction {
    apply: boolean;
    user: TCloudUser | null;
    userName: string;
}

let cloudLoginUserName = "";

export const getCloudLoginUserName = () => cloudLoginUserName;

export const setCloudUser = (user: TCloudUser | null, userName = "") => {
    // 重复的响应和推送保持登录状态，新增登录或切换账号时报告状态变化。
    const loggedIn = Boolean(user && (!window.siyuan.user || window.siyuan.user.userId !== user.userId));
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
