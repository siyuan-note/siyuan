export type TCloudUser = NonNullable<typeof window.siyuan.user>;

export interface ICloudUserRefreshAction {
    apply: boolean;
    user: TCloudUser | null;
    userName: string;
}

let loginUserName = "";

export const setCloudUser = (user: TCloudUser | null, userName = "") => {
    window.siyuan.user = user;
    if (user) {
        loginUserName = "";
    } else if (userName) {
        loginUserName = userName;
    }
};

export const getCloudLoginUserName = () => loginUserName;

export const resolveCloudUserRefresh = (
    code: number,
    user: TCloudUser | null,
    previousUserName: string,
): ICloudUserRefreshAction => {
    if (code === 0) {
        return {apply: true, user, userName: ""};
    }
    if (code === 255) {
        return {apply: true, user: null, userName: previousUserName};
    }
    return {apply: false, user, userName: ""};
};
