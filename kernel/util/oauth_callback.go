// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package util

import "html"

// RenderOAuthCallbackPage 渲染 OAuth 和 OIDC 共用的回调结果页面。
func RenderOAuthCallbackPage(lang, title, message string, success bool) []byte {
	markClass, mark := " mark--error", "!"
	if success {
		markClass, mark = "", "✓"
	}
	return []byte(`<!doctype html><html lang="` + html.EscapeString(lang) + `"><head><meta charset="utf-8">` +
		`<meta name="viewport" content="width=device-width,initial-scale=1"><title>` + html.EscapeString(title) + `</title>` +
		`<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f5f5;color:#202124;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}` +
		`main{box-sizing:border-box;width:min(480px,calc(100vw - 32px));padding:40px 32px;text-align:center;background:#fff;border:1px solid #ddd;border-radius:12px;box-shadow:0 8px 24px #00000014}` +
		`.brand{margin:0 0 28px;font-size:28px;font-weight:700;letter-spacing:-.5px}` +
		`.mark{display:grid;place-items:center;width:56px;height:56px;margin:0 auto 24px;border-radius:50%;background:#2e7d32;color:#fff;font-size:32px}.mark--error{background:#c62828}` +
		`h1{margin:0 0 12px;font-size:24px;font-weight:600}p{margin:0;color:#5f6368;font-size:15px;line-height:1.7}` +
		`@media(prefers-color-scheme:dark){body{background:#171717;color:#eee}main{background:#242424;border-color:#3c3c3c;box-shadow:none}p{color:#bbb}}</style>` +
		`</head><body><main><div class="brand">SiYuan</div><div class="mark` + markClass + `" aria-hidden="true">` + mark + `</div><h1>` + html.EscapeString(title) +
		`</h1><p>` + html.EscapeString(message) + `</p></main></body></html>`)
}
