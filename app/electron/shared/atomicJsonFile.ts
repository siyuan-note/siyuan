// 本机 JSON 配置的原子写入：先写同目录临时文件再改名，避免断电或崩溃留下半个文件。
// 临时文件权限限定为当前用户可读写，改名失败时清理残留。
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

/** indent 省略时写入紧凑格式，与读取方只解析结构、不比对格式。 */
const writeJsonAtomically = (file: string, value: unknown, indent?: number): void => {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temporary = file + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
    try {
        fs.writeFileSync(temporary, JSON.stringify(value, null, indent), {mode: 0o600});
        fs.renameSync(temporary, file);
    } finally {
        if (fs.existsSync(temporary)) {
            fs.unlinkSync(temporary);
        }
    }
};

export {writeJsonAtomically};
