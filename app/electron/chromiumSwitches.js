// 功能列表与内置选项合并，其他参数只在第一个等号处分隔名称和值。
const appendChromiumSwitch = (commandLine, arg) => {
    if (!arg.startsWith("--") || arg === "--") {
        return false;
    }
    const separator = arg.indexOf("=");
    const name = arg.slice(2, separator < 0 ? undefined : separator);
    let value = separator < 0 ? undefined : arg.slice(separator + 1);
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

module.exports = {appendChromiumSwitch};
