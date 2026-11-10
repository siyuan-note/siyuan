// @electron/remote 在加载时访问 Electron 原生绑定，纯 Node 环境下导入模块即失败，因此按需加载。
// 建窗的两处调用（主窗口与独立窗口）共用这一份访问器，不要在各自模块里重复定义。
import type {WebContents} from "electron";

const requireElectronRemote = (): {enable: (contents: WebContents) => void} => require("@electron/remote/main");

export {requireElectronRemote};
