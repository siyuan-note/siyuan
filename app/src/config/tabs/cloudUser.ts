export type TCloudUser = NonNullable<typeof window.siyuan.user>;

interface ICloudUserRefreshAction {
    apply: boolean;
    user: TCloudUser | null;
    userName: string;
}

let cloudLoginUserName = "";

export const getCloudLoginUserName = () => cloudLoginUserName;

export const setCloudUser = (user: TCloudUser | null, userName = "") => {
    window.siyuan.user = user;
    cloudLoginUserName = user ? "" : userName;
};

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
