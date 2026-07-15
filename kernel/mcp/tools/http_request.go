// SiYuan - Refactor your thinking
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

package tools

import (
	"fmt"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// HTTPRequestTool 通用 HTTP 调用工具，供智能体访问需要鉴权的 REST API（如微信读书网关）。
// 与 web_fetch 的区别：支持自定义 method/headers/body，且文本类响应（含 JSON）原样返回而非转 Markdown。
// 用 action 承载 method（get/post/put/delete/patch），从而零改动复用 agent 的确认机制——
// GET 命中 safeActions["get"] 免确认，POST 等写操作触发 UI 确认 + 写前快照。
var HTTPRequestTool = &Tool{
	Name:        "http_request",
	Description: "Send an HTTP request to a REST API and return the raw text response (JSON is kept as-is). action (HTTP method): get (default)/post/put/delete/patch. url (http/https), headers (object), body (string). Use this instead of web_fetch when you need POST, custom headers (e.g. Authorization), or raw JSON responses.",
	EffectScope: EffectScopeExternal,
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action": {
				Type:        "string",
				Description: "HTTP method. Defaults to get.",
				Enum:        []string{"get", "post", "put", "delete", "patch"},
			},
			"url": {Type: "string", Description: "The request URL (must start with http:// or https://)"},
			"headers": {
				Type:        "object",
				Description: "Optional request headers, e.g. {\"Authorization\":\"Bearer ...\", \"Content-Type\":\"application/json\"}.",
				Properties:  map[string]Property{},
			},
			"body": {Type: "string", Description: "Optional request body for post/put/patch."},
		},
		Required: []string{"url"},
	},
	Handler: httpRequestHandler,
}

func init() {
	register(HTTPRequestTool)
}

func httpRequestHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	rawURL, _ := args["url"].(string)

	headers := map[string]string{}
	if hs, ok := args["headers"].(map[string]any); ok {
		for k, v := range hs {
			headers[k] = fmt.Sprintf("%v", v)
		}
	}
	body, _ := args["body"].(string)

	// 对 url/headers/body 中的 {{secrets.NAME}}、{{vars.NAME}} 占位符插值，
	// 密钥/变量明文只进入出站请求，不进入 LLM 上下文。
	resolve := func(s string) string {
		return conf.ResolveSecretsVars(model.Conf.Secrets, model.Conf.Variables, s)
	}
	rawURL = resolve(rawURL)
	for k, v := range headers {
		headers[k] = resolve(v)
	}
	body = resolve(body)

	statusCode, contentType, text, err := util.HTTPRequest(action, rawURL, headers, body)
	if err != nil {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: "http_request error: " + err.Error()}},
			IsError: true,
		}, nil
	}

	result := fmt.Sprintf("HTTP %d %s\n\n%s", statusCode, contentType, text)
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: result}},
	}, nil
}
