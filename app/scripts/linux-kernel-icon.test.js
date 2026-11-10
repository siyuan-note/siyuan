const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {createRequire} = require("node:module");
const {test} = require("node:test");

const project = path.resolve(__dirname, "..");
const builderRequire = createRequire(require.resolve("electron-builder"));
const {Arch, LinuxPackager} = builderRequire("app-builder-lib");
const library = path.dirname(builderRequire.resolve("app-builder-lib"));
const {getConfig, validateConfiguration} = require(path.join(library, "util/config/config.js"));
const {LinuxTargetHelper} = require(path.join(library, "targets/LinuxTargetHelper.js"));
const FpmTarget = require(path.join(library, "targets/FpmTarget.js")).default;
const sizes = [16, 32, 48, 64, 128, 256, 512];

for (const [name, arch, packageArch] of [
    ["electron-builder-linux.yml", Arch.x64, {deb: "amd64", rpm: "amd64"}],
    ["electron-builder-linux-arm64.yml", Arch.arm64, {deb: "arm64", rpm: "aarch64"}],
]) {
    for (const format of ["deb", "rpm"]) {
        test(`${name} includes package-owned kernel icons in ${format} without replacing application icons`, async () => {
            const output = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-linux-icons-"));
            try {
                const config = await getConfig(project, path.join(project, name), null);
                await validateConfiguration(config);
                config.directories.output = output;
                const appOutDir = path.join(output, "unpacked");
                fs.mkdirSync(path.join(appOutDir, "resources"), {recursive: true});
                let args;
                let temporaryIndex = 0;
                const packager = new LinuxPackager({
                    config,
                    projectDir: project,
                    buildResourcesDir: path.join(project, "build"),
                    metadata: JSON.parse(fs.readFileSync(path.join(project, "package.json"), "utf8")),
                    framework: {name: "electron"},
                    tempDirManager: {getTempFile: async ({suffix}) => path.join(output, `${temporaryIndex++}-${suffix}`)},
                    emitArtifactBuildStarted: async () => {},
                    options: {
                        prepackaged: appOutDir,
                        // 使用真实 FPM 参数生成流程，在调用外部打包工具前停止，不编译或启动应用。
                        effectiveOptionComputed: async ([computed]) => {
                            args = computed;
                            return true;
                        },
                    },
                });
                const helper = new LinuxTargetHelper(packager);
                const target = new FpmTarget(format, packager, helper, output);
                await target.build(appOutDir, arch);
                assert.ok(args, "FPM argument generation must reach its verification hook");
                assert.equal(args[args.indexOf("--architecture") + 1], packageArch[format]);
                const kernelIcons = args.filter(value => value.endsWith("/apps/SiYuan-Kernel.png"));
                assert.equal(kernelIcons.length, sizes.length);
                for (const size of sizes) {
                    const destination = `/usr/share/icons/hicolor/${size}x${size}/apps/SiYuan-Kernel.png`;
                    const mappings = kernelIcons.filter(value => value.endsWith(`=${destination}`));
                    assert.equal(mappings.length, 1, destination);
                    const source = path.resolve(project, mappings[0].split("=")[0]);
                    assert.equal(source, path.join(project, `src/assets/icon/${size}x${size}.png`));
                    assert.ok(fs.statSync(source).isFile());
                    const icon = fs.readFileSync(source);
                    assert.equal(icon.subarray(1, 4).toString(), "PNG");
                    assert.equal(icon.readUInt32BE(16), size);
                    assert.equal(icon.readUInt32BE(20), size);
                    const applicationIcon = args.find(value => value.endsWith(
                        `=/usr/share/icons/hicolor/${size}x${size}/apps/siyuan.png`));
                    assert.ok(applicationIcon, "the normal application icon remains installed");
                    assert.deepEqual(icon, fs.readFileSync(applicationIcon.split("=")[0]));
                }
                assert.ok(args.includes(`${appOutDir}/=/opt/SiYuan`));
                assert.ok(args.some(value => value.endsWith(`=/usr/share/applications/${helper.getDesktopFileName()}.desktop`)));
                assert.equal(target.options.afterInstall, undefined);
                assert.equal(target.options.afterRemove, undefined);
                assert.equal(config.linux.executableName, "siyuan");
                assert.equal(config.linux.fpm, undefined);
                assert.equal(config.appImage.fpm, undefined);
                assert.deepEqual(config.linux.target.map(entry => entry.target), ["tar.gz", "AppImage", "deb", "rpm"]);
                if (format === "rpm") {
                    assert.equal(args[args.indexOf("--rpm-rpmbuild-define") + 1], "_build_id_links none");
                }
            } finally {
                fs.rmSync(output, {recursive: true, force: true});
            }
        });
    }
}
