import {Constants} from "../../constants";
import {addScript} from "./addScript";

let pending: Promise<boolean> | undefined;

// 编辑器和设置页共用加载中的脚本，避免重复执行后丢失已有图表实例的注册信息。
export const loadECharts = (cdn = Constants.PROTYLE_CDN): Promise<boolean> => {
    if (window.echarts) {
        return Promise.resolve(true);
    }
    pending ??= addScript(`${cdn}/js/echarts/echarts.min.js?v=5.3.2`, "protyleEchartsScript")
        .then(() => Boolean(window.echarts))
        .finally(() => {
            pending = undefined;
        });
    return pending;
};
