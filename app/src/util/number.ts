// 把数值缩写为带 k/M 后缀的短格式，用于集市下载次数、星标、issues 等计数展示
export const formatCount = (n: number | string) => {
    const num = typeof n === "string" ? parseFloat(n) : n;
    if (!Number.isFinite(num)) {
        // 后端可能返回空串或非数值，原样返回避免显示 NaN
        return n;
    }
    if (num < 1000) {
        return n.toString();
    }
    let value: number;
    let suffix: string;
    if (num < 1000000) {
        value = num / 1000;
        suffix = "k";
    } else {
        value = num / 1000000;
        suffix = "M";
    }
    // 保留一位小数，去掉末尾无意义的 .0（如 1.0k → 1k）
    return (value.toFixed(1).replace(/\.0$/, "")) + suffix;
};
