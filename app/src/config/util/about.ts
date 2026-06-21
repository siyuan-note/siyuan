export const getCloudURL = (key: string) => {
    const origin = window.siyuan.config.cloudRegion === 0 ? "https://ld246.com" : "https://liuyun.io";
    if (!key || "" === key) {
        return origin;
    }
    return `${origin}/${key}`;
};

export const getIndexURL = (key: string) => {
    const lang = "zh-CN" === window.siyuan.config.lang ? "" : "/en";
    return "https://b3log.org/siyuan" + `${lang}/${key}`;
};
