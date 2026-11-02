// 命令行参数解析。值中的等号必须保留，否则 `--remote=https://host/?token=a=b` 这类 URL 会被截断。
const getArgFrom = (args: string[], name: string): string | undefined => {
    const prefix = name + "=";
    const arg = args.find((item: string) => item === name || item.startsWith(prefix));
    if (!arg) {
        return;
    }
    return arg === name ? "" : arg.slice(prefix.length);
};

export {getArgFrom};
