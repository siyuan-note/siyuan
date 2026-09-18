const fs = require("node:fs");
const path = require("node:path");
const {createRequire} = require("node:module");

async function main() {
    const [base, kernel, output, thumbprint, destination] = process.argv.slice(2);
    if (!base || !kernel || !output || !/^[0-9a-f]{40}$/i.test(thumbprint || "") || !destination) {
        throw new Error("Expected base config, kernel directory, output directory, certificate SHA1 and destination");
    }
    const project = path.dirname(path.resolve(base));
    const projectRequire = createRequire(path.join(project, "package.json"));
    const builderRequire = createRequire(projectRequire.resolve("electron-builder"));
    const library = path.dirname(builderRequire.resolve("app-builder-lib"));
    const {getConfig, validateConfiguration} = require(path.join(library, "util/config/config.js"));
    const config = await getConfig(project, path.resolve(base), null);
    // 先展开继承配置，再替换内核资源列表，避免合并时保留开发内核目录。
    delete config.extends;
    config.directories = {...config.directories, output: path.resolve(output)};
    config.forceCodeSigning = true;
    config.win.extraResources = [{from: path.resolve(kernel), to: "kernel"}];
    config.win.signtoolOptions = {...config.win.signtoolOptions, certificateSha1: thumbprint};
    delete config.win.signtoolOptions.certificateSubjectName;
    await validateConfiguration(config);
    fs.writeFileSync(destination, JSON.stringify(config, null, 2) + "\n", {encoding: "utf8", flag: "wx"});
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
