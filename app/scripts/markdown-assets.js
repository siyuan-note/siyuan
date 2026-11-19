const fs = require("node:fs");
const path = require("node:path");
const {createRequire} = require("node:module");

const VDITOR_VERSION = "4.0.2-alpha.9";
const appRoot = path.resolve(__dirname, "..");
const LEGACY_LUTE_ASSET = "vditor/dist/js/lute/lute.min.js";
const SHARED_LUTE_ASSET = "stage/protyle/js/lute/lute.min.js";
const VDITOR_DIRECTORIES = ["css/content-theme", "js/i18n", "js/highlight.js", "js/katex"];
const APPEARANCE_FILES = ["themes/daylight/theme.css", "themes/midnight/theme.css", "icons/litheness/icon.js", "icons/litheness/icon.LICENSE"];
const REQUIRED_ASSETS = ["vditor/LICENSE", "vditor/dist/index.css", "vditor/dist/js/i18n/en_US.js",
    "vditor/licenses/KaTeX-LICENSE", "vditor/licenses/KaTeX-fonts-LICENSE", "vditor/licenses/KaTeX-mhchem-NOTICE",
    "vditor/licenses/Apache-2.0-LICENSE", "vditor/licenses/diff-match-patch-LICENSE", "vditor/licenses/Lucide-LICENSE",
    "vditor/dist/js/icons/ant.js", "vditor/dist/js/highlight.js/highlight.min.js",
    "vditor/dist/js/katex/katex.min.js", "vditor/dist/js/katex/katex.min.css", "vditor/dist/js/katex/mhchem.min.js",
    ...APPEARANCE_FILES.map(name => "appearance/" + name)];

// Vditor resolves optional renderers, fonts, icons and languages below cdn/dist.
// Keep that layout intact so an offline document never falls back to a CDN.
const markdownAssetFiles = ({
    packageRoot = path.dirname(require.resolve("vditor/package.json")),
    lutePath = path.join(appRoot, SHARED_LUTE_ASSET),
    appearanceRoot = path.join(appRoot, "appearance"),
} = {}) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
    if (pkg.version !== VDITOR_VERSION) throw new Error(`Expected Vditor ${VDITOR_VERSION}, found ${pkg.version}`);
    if (!fs.statSync(lutePath).isFile()) throw new Error(`Invalid shared Lute asset: ${lutePath}`);
    const files = [];
    const walk = (directory, relative) => {
        for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
            const source = path.join(directory, entry.name);
            const name = `${relative}/${entry.name}`;
            if (entry.isSymbolicLink()) throw new Error(`Linked Markdown asset is not supported: ${source}`);
            if (entry.isDirectory()) walk(source, name);
            else if (entry.isFile() && !/\.(?:map|d\.ts)$/.test(entry.name) && name !== LEGACY_LUTE_ASSET) {
                files.push({name, source});
            }
        }
    };
    // The standalone editor uses KaTeX and highlighting. Diagram renderers stay
    // as source code, and remote media/export features are disabled by the UI.
    for (const directory of VDITOR_DIRECTORIES) {
        walk(path.join(packageRoot, "dist", directory), "vditor/dist/" + directory);
    }
    for (const name of ["index.css", "js/icons/ant.js"]) {
        files.push({name: "vditor/dist/" + name, source: path.join(packageRoot, "dist", name)});
    }
    files.push({name: "vditor/LICENSE", source: path.join(packageRoot, "LICENSE")});
    files.push({name: "vditor/licenses/Lucide-LICENSE", source: path.join(packageRoot, "dist/js/icons/LICENSE-lucide.txt")});
    const dependencyRequire = createRequire(path.join(packageRoot, "package.json"));
    const diffRoot = path.dirname(dependencyRequire.resolve("diff-match-patch/package.json"));
    files.push({name: "vditor/licenses/diff-match-patch-LICENSE", source: path.join(diffRoot, "LICENSE")});
    files.push({name: "vditor/licenses/Apache-2.0-LICENSE", source: path.join(diffRoot, "LICENSE")});
    for (const name of ["KaTeX-LICENSE", "KaTeX-fonts-LICENSE", "KaTeX-mhchem-NOTICE"]) {
        files.push({name: "vditor/licenses/" + name, source: path.join(__dirname, "markdown-licenses", name)});
    }
    for (const name of APPEARANCE_FILES) {
        files.push({name: "appearance/" + name, source: path.join(appearanceRoot, name)});
    }
    // Native hosts map the exact Vditor Lute URL to SHARED_LUTE_ASSET in the
    // same installation. Neither the npm copy nor another physical copy is emitted.
    for (const name of REQUIRED_ASSETS) {
        if (!files.some(file => file.name === name)) throw new Error(`Missing Markdown asset: ${name}`);
    }
    for (const file of files) {
        if (!fs.statSync(file.source).isFile()) throw new Error(`Invalid Markdown asset: ${file.source}`);
    }
    return files.sort((a, b) => a.name.localeCompare(b.name, "en"));
};

const removeLegacyMarkdownAssets = outputDirectory => {
    // Reused outputs may contain removed assets. Remove only these two fixed
    // locations, never follow an output subdirectory symlink elsewhere.
    for (const name of [LEGACY_LUTE_ASSET, "vditor/dist/images/emoji"]) {
        const legacy = path.join(outputDirectory, name);
        try {
            const root = fs.realpathSync(outputDirectory);
            const parent = fs.realpathSync(path.dirname(legacy));
            if (parent !== path.join(root, path.dirname(name))) {
                throw new Error(`Linked obsolete Markdown asset: ${legacy}`);
            }
            // rm removes a target symlink itself; it never recurses into its destination.
            fs.rmSync(path.join(parent, path.basename(legacy)), {recursive: true, force: true});
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
    }
};

// Also usable by resource/package checks without running Webpack or touching a
// live development bundle. Callers can prepare an isolated output directory.
const prepareMarkdownAssets = (outputDirectory, options) => {
    const files = markdownAssetFiles(options);
    removeLegacyMarkdownAssets(outputDirectory);
    for (const file of files) {
        const destination = path.join(outputDirectory, file.name);
        fs.mkdirSync(path.dirname(destination), {recursive: true});
        fs.copyFileSync(file.source, destination);
    }
    return files.map(file => file.name);
};

class MarkdownAssetsPlugin {
    apply(compiler) {
        // The clean plugin caches its previous file inventory. Explicitly remove
        // the obsolete runtime and image emoji after every preserved watch build.
        compiler.hooks.afterEmit.tap("MarkdownAssetsPlugin", () => removeLegacyMarkdownAssets(compiler.options.output.path));
        compiler.hooks.thisCompilation.tap("MarkdownAssetsPlugin", compilation => {
            compilation.fileDependencies.add(path.join(appRoot, SHARED_LUTE_ASSET));
            compilation.hooks.processAssets.tap({
                name: "MarkdownAssetsPlugin",
                stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
            }, () => {
                for (const file of markdownAssetFiles()) {
                    compilation.fileDependencies.add(file.source);
                    // 离线库的全局导出依赖原有脚本作用域，构建时保留其原始产物。
                    compilation.emitAsset(file.name, new compiler.webpack.sources.RawSource(fs.readFileSync(file.source)),
                        {minimized: true});
                }
            });
        });
    }
}

if (require.main === module) {
    const directory = path.resolve(process.argv[2] || path.join(appRoot, "stage/build/markdown"));
    const files = prepareMarkdownAssets(directory);
    console.log(`Prepared ${files.length} offline Markdown assets in ${directory}`);
}

module.exports = {VDITOR_VERSION, REQUIRED_ASSETS, SHARED_LUTE_ASSET, LEGACY_LUTE_ASSET,
    markdownAssetFiles, prepareMarkdownAssets, MarkdownAssetsPlugin};
