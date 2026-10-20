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
  for (const target of ["mobile", "desktop", "export"]) {
    const directory = path.join(stageDir, "build", target);
    const names = readdirSync(directory);
    const required = target === "export" ? ["protyle-method.js", "base.css"] : ["index.html"];
    for (const name of required) {
      if (!names.includes(name)) throw new Error(`Missing Android resource: ${directory}/${name}`);
    }
    const hashed = names.filter(name => /\.[a-f\d]{8,}\./i.test(name) && !name.endsWith(".map"));
    const selected = new Set(names.filter(name => !/\.[a-f\d]{8,}\./i.test(name) && !name.endsWith(".map")));
    // Follow references from the current HTML and selected scripts/styles.
    for (const name of selected) {
      if (!/\.(html|js|css)$/.test(name)) continue;
      const content = readFileSync(path.join(directory, name), "utf8");
      for (const candidate of hashed) {
        if (content.includes(candidate)) selected.add(candidate);
      }
      for (const match of content.matchAll(/(?:main|startup|base)\.[a-f\d]{8,}\.(?:js|css)\b/gi)) {
        if (!names.includes(match[0])) throw new Error(`Missing Android resource: ${directory}/${match[0]}`);
      }
    }
    for (const name of selected) result.push(`stage/build/${target}/${name}`);
  }
  return result.sort();
}
