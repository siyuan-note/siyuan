import {Constants} from "../../constants";
import {addScriptSync} from "./addScript";

// 创建编辑器或执行依赖 Lute 的扩展脚本前，等待引擎加载完成。
export const ensureLute = async () => {
    if (typeof Lute !== "undefined") {
        return;
    }
    await addScriptSync(`${Constants.PROTYLE_CDN}/js/lute/lute.min.js?v=${Constants.SIYUAN_VERSION}`, "protyleLuteScript");
    if (typeof Lute === "undefined") {
        throw new Error("Could not load Lute");
    }
};
