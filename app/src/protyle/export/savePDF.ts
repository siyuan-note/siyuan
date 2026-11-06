import {randomUUID} from "crypto";
import {promises as fs} from "fs";
import * as path from "path";

export const savePDF = async (filePath: string, data: Uint8Array,
                              processPDF: (temporaryPath: string) => Promise<boolean>) => {
    // 临时 PDF 与目标同目录，使附件相对路径有效，并在处理成功后替换目标文件。
    const temporaryPath = path.join(path.dirname(filePath), `.siyuan-pdf-${randomUUID()}.pdf`);
    const file = await fs.open(temporaryPath, "wx");
    try {
        try {
            await file.writeFile(data);
        } finally {
            await file.close();
        }
        if (!await processPDF(temporaryPath)) {
            return false;
        }
        await fs.rename(temporaryPath, filePath);
        return true;
    } finally {
        await fs.rm(temporaryPath, {force: true});
    }
};
