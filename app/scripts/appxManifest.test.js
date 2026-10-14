const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const manifests = [
    ["AppxManifest.xml", "x64"],
    ["AppxManifest-arm64.xml", "arm64"],
];

const attributes = (tag) => Object.fromEntries(
    Array.from(tag.matchAll(/([\w:]+)="([^"]*)"/g), match => [match[1], match[2]]),
);

for (const [filename, architecture] of manifests) {
    const source = readFileSync(path.join(__dirname, "../appx", filename), "utf8");

    test(`${filename} exposes the kernel through a classic desktop CLI alias`, () => {
        const extensions = Array.from(source.matchAll(/<uap3:Extension\b([^>]*)>([\s\S]*?)<\/uap3:Extension>/g))
            .filter(match => attributes(match[1]).Category === "windows.appExecutionAlias");
        assert.equal(extensions.length, 1);
        const extension = extensions[0];
        assert.deepEqual(attributes(extension[1]), {
            Category: "windows.appExecutionAlias",
            Executable: "app\\resources\\kernel\\SiYuan-Kernel.exe",
            EntryPoint: "Windows.FullTrustApplication",
        });
        assert.match(extension[2], /<uap3:AppExecutionAlias>\s*<desktop:ExecutionAlias\s+Alias="siyuan\.exe"\s*\/>\s*<\/uap3:AppExecutionAlias>/);
        assert.equal(Array.from(source.matchAll(/\bAlias="siyuan\.exe"/g)).length, 1);
    });

    test(`${filename} preserves the GUI entry, protocol and package compatibility`, () => {
        const packageAttributes = attributes(source.match(/<Package\b([^>]*)>/)[1]);
        assert.equal(packageAttributes["xmlns:uap3"], "http://schemas.microsoft.com/appx/manifest/uap/windows10/3");
        assert.equal(packageAttributes["xmlns:desktop"], "http://schemas.microsoft.com/appx/manifest/desktop/windows10");
        const ignorable = packageAttributes.IgnorableNamespaces.split(/\s+/);
        assert.ok(ignorable.includes("uap3"));
        assert.ok(ignorable.includes("desktop"));
        assert.equal(attributes(source.match(/<Identity\b([^>]*)\/>/)[1]).ProcessorArchitecture, architecture);
        const applications = Array.from(source.matchAll(/<Application\b([^>]*)>/g));
        assert.equal(applications.length, 1);
        assert.deepEqual(attributes(applications[0][1]), {
            Id: "SiYuan", Executable: "app\\SiYuan.exe", EntryPoint: "Windows.FullTrustApplication",
        });
        assert.match(source, /<uap:Extension\s+Category="windows\.protocol">\s*<uap:Protocol\s+Name="siyuan"\s*\/>\s*<\/uap:Extension>/);
        assert.match(source, /<rescap:Capability\s+Name="runFullTrust"\s*\/>/);
        assert.equal(attributes(source.match(/<TargetDeviceFamily\b([^>]*)\/>/)[1]).MinVersion, "10.0.14316.0");
    });
}
