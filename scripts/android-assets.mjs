import {readdirSync, readFileSync} from "node:fs";
import path from "node:path";

// Keep development output intact: open PC windows may still use older hashes.
export function androidStageFiles(stageDir) {
  const result = [];
  function walk(directory, relative = "") {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (name === "build") continue;
      if (entry.isDirectory()) walk(path.join(directory, entry.name), name);
      else result.push(`stage/${name}`);
    }
  }
  walk(stageDir);
  if (!result.includes("stage/protyle/js/lute/lute.min.js")) {
    throw new Error(`Missing Android resource: ${stageDir}/protyle/js/lute/lute.min.js`);
  }
  for (const target of ["mobile", "desktop", "export", "markdown"]) {
    const directory = path.join(stageDir, "build", target);
    const names = [];
    const collect = (folder, relative = "") => {
      for (const entry of readdirSync(folder, {withFileTypes: true})) {
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) throw new Error(`Linked Android resource: ${folder}/${entry.name}`);
        if (entry.isDirectory()) collect(path.join(folder, entry.name), name);
        else if (entry.isFile()) names.push(name);
      }
    };
    collect(directory);
    const required = target === "export" ? ["protyle-method.js", "base.css"] : ["index.html"];
    if (target === "markdown") {
      if (names.includes("vditor/dist/js/lute/lute.min.js")) throw new Error(`Duplicate Markdown Lute resource: ${directory}`);
      if (names.some(name => name.startsWith("vditor/dist/images/emoji/"))) throw new Error(`Obsolete Markdown emoji resource: ${directory}`);
      required.push("vditor/LICENSE", "vditor/dist/js/i18n/en_US.js",
        "vditor/licenses/KaTeX-LICENSE", "vditor/licenses/KaTeX-fonts-LICENSE", "vditor/licenses/KaTeX-mhchem-NOTICE",
        "vditor/licenses/Apache-2.0-LICENSE", "vditor/licenses/diff-match-patch-LICENSE", "vditor/dist/index.css",
        "vditor/dist/js/icons/ant.js", "vditor/dist/js/katex/katex.min.js", "vditor/dist/js/katex/katex.min.css",
        "vditor/dist/js/katex/mhchem.min.js", "appearance/icons/litheness/icon.LICENSE",
        "vditor/dist/js/highlight.js/highlight.min.js", "appearance/themes/daylight/theme.css",
        "appearance/themes/midnight/theme.css", "appearance/icons/litheness/icon.js");
    }
    for (const name of required) {
      if (!names.includes(name)) throw new Error(`Missing Android resource: ${directory}/${name}`);
    }
    const hashed = names.filter(name => /\.[a-f\d]{8,}\./i.test(name) && !name.endsWith(".map"));
    const selected = new Set(names.filter(name => !/\.[a-f\d]{8,}\./i.test(name) && !name.endsWith(".map")));
    // 从当前入口递归收集静态引用和 Webpack 运行时拼接的资源名。
    for (const name of selected) {
      if (!/\.(html|js|css)$/.test(name)) continue;
      const content = readFileSync(path.join(directory, name), "utf8");
      for (const candidate of hashed) {
        if (content.includes(candidate) || content.includes(path.posix.relative(path.posix.dirname(name), candidate))) selected.add(candidate);
      }
      for (const match of content.matchAll(/(?:main|startup|base)\.[a-f\d]{8,}\.(?:js|css)\b/gi)) {
        if (!names.includes(match[0])) throw new Error(`Missing Android resource: ${directory}/${match[0]}`);
      }
      for (const runtime of content.matchAll(/\{((?:\s*(?:\d+|["'][\w-]+["'])\s*:\s*["'][a-f\d]{8,}["']\s*,?)+)\}\s*\[[^\]]+\]\s*\+\s*["']\.(js|css)["']/gi)) {
        for (const chunk of runtime[1].matchAll(/(\d+|["'][\w-]+["'])\s*:\s*["']([a-f\d]{8,})["']/gi)) {
          const resource = path.posix.join(path.posix.dirname(name), `${chunk[1].replace(/["']/g, "")}.${chunk[2]}.${runtime[2]}`);
          if (!names.includes(resource)) throw new Error(`Missing Android resource: ${directory}/${resource}`);
          selected.add(resource);
        }
      }
    }
    for (const name of selected) result.push(`stage/build/${target}/${name}`);
  }
  return result.sort();
}
