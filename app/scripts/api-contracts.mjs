import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const kernel = fileURLToPath(new URL("../../kernel/", import.meta.url));
const result = spawnSync("go", ["run", "./apicontract/cmd/apigen", ...process.argv.slice(2)], {
    cwd: kernel,
    stdio: "inherit",
});
if (result.error) {
    console.error(result.error.message);
}
process.exit(result.status ?? 1);
