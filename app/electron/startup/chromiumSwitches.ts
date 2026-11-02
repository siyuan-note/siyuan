import {app} from "electron";

// 功能列表与内置选项合并，其他参数只在第一个等号处分隔名称和值。
const appendChromiumSwitch = (arg: string): boolean => {
    if (!arg.startsWith("--") || arg === "--") {
        return false;
    }
    const {commandLine} = app;
    const separator = arg.indexOf("=");
    const name = arg.slice(2, separator < 0 ? undefined : separator);
    let value: string | undefined = separator < 0 ? undefined : arg.slice(separator + 1);
    if (name === "enable-features" || name === "disable-features") {
        value = [...new Set([commandLine.getSwitchValue(name), value || ""]
            .flatMap(features => features.split(",").map(feature => feature.trim()).filter(Boolean)))].join(",");
    }
    if (value === undefined) {
        commandLine.appendSwitch(name);
    } else {
        commandLine.appendSwitch(name, value);
    }
    return true;
};

export {appendChromiumSwitch};
