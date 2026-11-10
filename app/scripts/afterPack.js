const fs = require("fs");
const fsPromises = fs.promises;
const path = require("path");
const {Arch} = require("electron-builder");
const unzipper = require("unzipper");

module.exports = async function afterPack(context) {
  const {appOutDir, arch, electronPlatformName, packager} = context;
  await extractPackagedPandoc(appOutDir, packager, electronPlatformName, arch);
};

async function extractPackagedPandoc(appOutDir, packager, platform, arch) {
  const resourcePath = getPackagedResourcePath(appOutDir, packager, platform);
  const archivePath = path.join(resourcePath, "pandoc.zip");
  try {
    await fsPromises.access(archivePath);
  } catch (error) {
    if (error.code === "ENOENT" && platform === "win32" && arch === Arch.arm64) {
      return;
    }
    if (error.code === "ENOENT") {
      throw new Error(`Packaged Pandoc archive not found: ${archivePath}`, {cause: error});
    }
    throw error;
  }

  const pandocDir = path.join(resourcePath, "pandoc");
  const pandocBin = path.join(pandocDir, "bin", platform === "win32" ? "pandoc.exe" : "pandoc");
  try {
    await fsPromises.rm(pandocDir, {force: true, recursive: true});
    await fsPromises.mkdir(pandocDir, {recursive: true});
    await fs.createReadStream(archivePath).pipe(unzipper.Extract({path: pandocDir})).promise();

    const stat = await fsPromises.stat(pandocBin);
    if (!stat.isFile() || stat.size === 0) {
      throw new Error(`invalid Pandoc executable: ${pandocBin}`);
    }
    if (platform !== "win32") {
      await fsPromises.chmod(pandocBin, 0o755);
    }
    await fsPromises.rm(archivePath);
    console.log(`Extracted packaged Pandoc: ${pandocBin}`);
  } catch (error) {
    throw new Error(`Failed to extract packaged Pandoc: ${error.message}`, {cause: error});
  }
}

function getPackagedResourcePath(appOutDir, packager, platform) {
  if (platform === "darwin") {
    return path.join(appOutDir, `${packager.appInfo.productFilename}.app`, "Contents", "Resources");
  }
  return path.join(appOutDir, "resources");
}

module.exports.extractPackagedPandoc = extractPackagedPandoc;
