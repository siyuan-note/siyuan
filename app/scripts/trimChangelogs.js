const fsPromises = require("fs").promises;
const path = require("path");

// 裁剪 changelog，只保留顶层 changelogs/v{version}/。
// 版本号须与 package.json、kernel/util/working.go 的 Ver 一致（内核按此路径读取）。
async function trimChangelogs(changelogsDir, version) {
  try {
    await fsPromises.access(changelogsDir);
  } catch {
    return {ok: false, reason: "directory not found"};
  }

  const verName = `v${version}`;
  const destDir = path.join(changelogsDir, verName);
  const entries = await fsPromises.readdir(changelogsDir, {withFileTypes: true});
  let hasTarget = false;
  const obsolete = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name === verName) {
      hasTarget = true;
    } else {
      obsolete.push(entry.name);
    }
  }

  if (!hasTarget) {
    return {ok: false, reason: `changelog directory not found: ${destDir}`};
  }

  await Promise.all(
    obsolete.map((name) => fsPromises.rm(path.join(changelogsDir, name), {recursive: true, force: true}))
  );
  return {ok: true, path: destDir};
}

module.exports = { trimChangelogs };

// CLI：node scripts/trimChangelogs.js（Docker 镜像构建用）
if (require.main === module) {
  const changelogsDir = path.resolve(process.cwd(), "changelogs");
  const version = require(path.join(__dirname, "..", "package.json")).version;
  trimChangelogs(changelogsDir, version).then((result) => {
    if (!result.ok) {
      console.error(`trimChangelogs: ${result.reason}`);
      return;
    }
    console.log(`trimChangelogs: ${result.path}`);
  }).catch((error) => {
    console.error("trimChangelogs failed:", error.message);
  });
}
