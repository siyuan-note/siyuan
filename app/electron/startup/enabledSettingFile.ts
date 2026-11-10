import * as fs from "node:fs";
import {writeJsonAtomically} from "../shared/atomicJsonFile";

// 读取形如 {"enabled": true} 的本机开关文件。文件不存在时视为关闭。
const readEnabledSetting = (file: string): boolean => {
    try {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        if (typeof data?.enabled !== "boolean") {
            throw new Error("Invalid setting file: " + file);
        }
        return data.enabled;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return false;
        }
        throw error;
    }
};

// 先写临时文件再改名，避免断电或崩溃留下半个 JSON；权限限定为当前用户可读写。
const writeEnabledSetting = (file: string, enabled: boolean): void => {
    if (typeof enabled !== "boolean") {
        throw new TypeError("Invalid setting value: " + file);
    }
    writeJsonAtomically(file, {enabled});
};

export {readEnabledSetting, writeEnabledSetting};
