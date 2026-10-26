const assert = require("node:assert/strict");
const {once} = require("node:events");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const {test} = require("node:test");

// Replace template data only; exercise the actual page markup and inline scripts.
const fixtureHTML = mode => {
    const access = mode !== "oidc";
    const oidc = mode !== "password";
    return readFileSync(path.join(__dirname, "../stage/auth.html"), "utf8")
        .replace(/{{if not \.accessAuthCodeEnabled}}([\s\S]*?){{end}}/g, (_, content) => access ? "" : content)
        .replace(/{{if \.accessAuthCodeEnabled}}([\s\S]*?){{end}}/g, (_, content) => access ? content : "")
        .replace(/{{if \.oidcEnabled}}([\s\S]*?){{end}}/g, (_, content) => oidc ? content : "")
        .replace(/{{\.appearanceModeOS}}/g, "false")
        .replace(/{{\.appearanceMode}}/g, "0")
        .replace(/{{\.trayMenuLangs}}/g, "{}")
        .replace(/{{\.l9}}/g, JSON.stringify("Auth code required"))
        .replace(/{{\.\w+}}/g, "Fixture");
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const requests = [];
        let response = {code: 1, msg: "Captcha required"};
        const server = http.createServer(async (req, res) => {
            const url = new URL(req.url, "http://localhost");
            if (url.pathname === "/check-auth" && req.method === "GET") {
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.end(fixtureHTML(url.searchParams.get("mode")));
            } else if (url.pathname === "/api/system/loginAuth") {
                let body = "";
                for await (const chunk of req) body += chunk;
                requests.push({method: req.method, body: JSON.parse(body)});
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(response));
            } else if (url.pathname === "/") {
                res.end("Signed in");
            } else {
                res.writeHead(404).end();
            }
        });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const origin = `http://127.0.0.1:${server.address().port}`;
        const win = new BrowserWindow({show: false, webPreferences: {offscreen: true, backgroundThrottling: false}});
        const evaluate = source => win.webContents.executeJavaScript(source);
        const waitFor = async predicate => {
            const deadline = Date.now() + 5000;
            while (!await predicate()) {
                assert.ok(Date.now() < deadline, "authentication page reached the expected state");
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        };
        try {
            for (const mode of ["password", "oidc", "combined"]) {
                await win.loadURL(`${origin}/check-auth?mode=${mode}`);
                const markup = await evaluate(`(() => {
                    const form = document.getElementById("authForm");
                    const password = document.getElementById("authCode");
                    return {method: form.method, action: form.getAttribute("action"),
                        password: [password.form === form, password.name, password.type, password.autocomplete],
                        captcha: document.getElementById("captcha").autocomplete,
                        submit: document.getElementById("authSubmit")?.type,
                        oidc: document.getElementById("oidcLogin")?.type,
                        exit: document.querySelector(".b3-button--white").type};
                })()`);
                assert.deepEqual(markup, {method: "post", action: "/check-auth",
                    password: [true, "password", "password", "current-password"], captcha: "off",
                    submit: mode === "oidc" ? undefined : "submit",
                    oidc: mode === "password" ? undefined : "button", exit: "button"});
            }
            await waitFor(() => evaluate("!document.getElementById('authPanel').inert"));
            await evaluate("document.getElementById('authSubmit').click()");
            assert.equal(requests.length, 0, "empty input does not send credentials");
            assert.equal(await evaluate("document.querySelector('#message').firstElementChild.textContent"), "Auth code required");

            await evaluate(`document.getElementById("authCode").value = "  secret  ";
                document.getElementById("rememberMe").checked = true;
                document.getElementById("authCode").focus();
                document.getElementById("authForm").requestSubmit();`);
            await waitFor(async () => requests.length === 1 && await evaluate("document.getElementById('authCode').value === ''"));
            assert.deepEqual(requests[0], {method: "POST", body: {authCode: "secret", captcha: "", rememberMe: true}});
            assert.equal(await evaluate("document.getElementById('captcha').parentElement.style.display"), "block");
            assert.equal(await evaluate("document.querySelector('#message').firstElementChild.textContent"), "Captcha required");

            response = {code: -1, msg: "Invalid credentials"};
            await evaluate(`document.getElementById("authCode").value = "secret";
                document.getElementById("captcha").value = "1234";
                document.getElementById("captcha").focus();
                document.getElementById("authForm").requestSubmit();`);
            await waitFor(async () => requests.length === 2 && await evaluate("document.getElementById('authCode').value === ''"));
            assert.deepEqual(requests[1].body, {authCode: "secret", captcha: "1234", rememberMe: true});
            assert.equal(await evaluate("document.getElementById('captcha').parentElement.style.display"), "none");
            assert.equal(await evaluate("document.getElementById('captcha').value"), "");
            assert.equal(win.webContents.getURL(), `${origin}/check-auth?mode=combined`, "failed authentication prevents native form navigation");

            response = {code: 0};
            await evaluate(`document.getElementById("authCode").value = "secret";
                document.getElementById("rememberMe").checked = false;
                document.getElementById("authSubmit").click();`);
            await waitFor(() => win.webContents.getURL() === `${origin}/`);
            assert.equal(requests.length, 3, "each button or form submission sends exactly one login request");
            assert.deepEqual(requests[2].body, {authCode: "secret", captcha: "", rememberMe: false});
            console.log("Auth form interactions passed");
            win.destroy();
            server.close();
            app.exit(0);
        } catch (error) {
            console.error(error);
            win.destroy();
            server.close();
            app.exit(1);
        }
    });
} else {
    test("auth form preserves login requests, captcha and error handling", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 30000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-auth-form-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 25000});
            assert.match(stdout, /Auth form interactions passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-auth-form-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
