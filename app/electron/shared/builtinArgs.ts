// 内置命令行参数由主进程自己消费：启动时不转发给 Chromium，切换连接时也不沿用。
// 启动开关与连接切换共用这一份名单，新增内置参数只改这里。
const BUILTIN_ARG_NAMES = [
    "--workspace", "--openAsHidden", "--port", "--safe-mode", "--lang",
    "--connection-session", "--remote", "--trust-remote-extensions", "--markdown",
];

// 内置参数可以写成裸名（--openAsHidden）或 name=value，比较时只看等号前的名字。
const argName = (arg: string): string => arg.split("=", 1)[0];

// 深链不是 name=value 形式，按协议前缀判断。
const isDeepLink = (arg: string): boolean => arg.startsWith("siyuan://");

// 命令行里的第一个深链参数，没有时返回 undefined。
const findDeepLink = (args: string[]): string | undefined => args.find(isDeepLink);

const isBuiltinArg = (arg: string): boolean => isDeepLink(arg) || BUILTIN_ARG_NAMES.includes(argName(arg));

// 语言由目标连接重新给出，因此切换连接时不丢弃，local 目标沿用原来的值。
const RECOMPUTED_ON_SWITCH = new Set(["--lang"]);

// 独立 Markdown 的文件请求与连接无关，切换连接后重启仍应重新打开这些文件。
const PRESERVED_ON_SWITCH = new Set(["--markdown"]);

// 不在内置名单里、但切换连接时必须丢弃：系统代理由启动开关按当前内核模式重新决定。
const RESET_ON_SWITCH = new Set(["--no-proxy-server"]);

const isDroppedOnConnectionSwitch = (arg: string): boolean => RESET_ON_SWITCH.has(argName(arg)) ||
    (isBuiltinArg(arg) && !RECOMPUTED_ON_SWITCH.has(argName(arg)) && !PRESERVED_ON_SWITCH.has(argName(arg)));

export {isBuiltinArg, isDroppedOnConnectionSwitch, argName, findDeepLink, isDeepLink};
