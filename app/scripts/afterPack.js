const fsPromises = require("fs").promises;
const path = require("path");

module.exports = async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  await removeLanguagePacks(appOutDir, packager, electronPlatformName);
};

async function removeLanguagePacks(appOutDir, packager, platform) {
  // 支持的语言都要保留，否则影响开发者工具字体显示
  const wantedLanguages = ["ar_SA", "de_DE", "en_US", "es_ES", "fr_FR", "he_IL", "it_IT", "ja_JP", "ko_KR", "pl_PL", "pt_BR", "ru_RU", "tr_TR", "zh_CHT", "zh_CN"];
  const keepPrefixes = new Set(wantedLanguages.map(lang => lang.substring(0, 2)));

  let resourcePath;
  let fileExtension;
  let isDirectory = false;

  if (platform === "darwin") {
    const appName = packager.appInfo.productFilename;
    resourcePath = path.join(
      appOutDir,
      `${appName}.app`,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Versions",
      "A",
      "Resources"
    );
    fileExtension = ".lproj";
    isDirectory = true;
  } else if (platform === "win32" || platform === "linux") {
    resourcePath = path.join(appOutDir, "locales");
    fileExtension = ".pak";
    isDirectory = false;
  } else {
    return;
  }

  try {
    const entries = await fsPromises.readdir(resourcePath);
    const targetFiles = entries.filter(file => file.endsWith(fileExtension));

    if (targetFiles.length === 0) {
      return;
    }

    let deletedCount = 0;
    let deletedSize = 0;
    const deletePromises = entries.map(async (file) => {
      if (!file.endsWith(fileExtension)) return;

      const languageName = file.replace(new RegExp(`\\${fileExtension}$`), "");
      const langPrefix = languageName.substring(0, 2);

      if (keepPrefixes.has(langPrefix)) {
        return;
      }

      const filePath = path.join(resourcePath, file);

      const stats = await fsPromises.stat(filePath);
      const fileSize = isDirectory ? await getDirectorySize(filePath) : stats.size;

      await fsPromises.rm(filePath, {
        force: true,
        recursive: isDirectory,
      });

      deletedCount++;
      deletedSize += fileSize;
    });

    await Promise.all(deletePromises);

    if (deletedCount > 0) {
      console.log(`Removed ${deletedCount}/${targetFiles.length} language packs, saved ${formatBytes(deletedSize)}`);
    }
  } catch (error) {
    console.error("Failed to remove language packs:", error.message);
  }
}

async function getDirectorySize(dirPath) {
  let totalSize = 0;
  
  try {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        totalSize += await getDirectorySize(entryPath);
      } else {
        const stats = await fsPromises.stat(entryPath);
        totalSize += stats.size;
      }
    }
  } catch (error) {
    console.warn(`Failed to calculate directory size for ${dirPath}:`, error.message);
  }
  
  return totalSize;
}

function formatBytes(bytes) {
  if (bytes === 0) {
    return "0 B";
  }

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);

  const formattedSize = size % 1 === 0 ? size.toString() : size.toFixed(1);

  return `${formattedSize} ${sizes[i]}`;
}

