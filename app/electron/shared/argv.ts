// 命令行参数解析。值中的等号必须保留，否则 `--remote=https://host/?token=a=b` 这类 URL 会被截断。
const getArgFrom = (args: string[], name: string): string | undefined => {
    const prefix = name + "=";
    const index = args.findIndex((item: string) => item === name || item.startsWith(prefix));
    if (index < 0) {
        return;
    }
    const arg = args[index];
    if (arg !== name) {
        return arg.slice(prefix.length);
    }
    const value = args[index + 1];
    return value !== undefined && !value.startsWith("-") ? value : "";
};

export {getArgFrom};
