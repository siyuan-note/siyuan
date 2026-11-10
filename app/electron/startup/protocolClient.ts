// siyuan:// 协议注册。Windows 的 `electron main.js` 开发运行必须同时登记可执行文件与 main.js，
// 否则 siyuan:// 会被当成相对路径处理；其余情况只登记协议名。
import * as path from "node:path";
import {app} from "electron";

const registerProtocolClient = ({
    isDevEnv, defaultApp, platform = process.platform, execPath = process.execPath, argv = process.argv,
}: {
    isDevEnv: boolean;
    /** 是否为 `electron main.js` 形式的开发运行；生产打包后为 false。 */
    defaultApp: boolean;
    platform?: NodeJS.Platform;
    execPath?: string;
    argv?: string[];
}): void => {
    if (!isDevEnv || !defaultApp || argv.length < 2 || platform !== "win32") {
        app.setAsDefaultProtocolClient("siyuan");
        return;
    }
    const mainScript = path.resolve(argv[1]);
    app.removeAsDefaultProtocolClient("siyuan", execPath, [mainScript]);
    app.setAsDefaultProtocolClient("siyuan", execPath, [mainScript]);
};

export {registerProtocolClient};
