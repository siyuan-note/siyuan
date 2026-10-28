// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"fmt"
	"net/url"
	"strconv"

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
	confVariablesReadSnapshot := model.Conf.LoadVariables()

	action, _ := args["action"].(string)
	rawURL, _ := args["url"].(string)

	headers := map[string]string{}
	if hs, ok := args["headers"].(map[string]any); ok {
		parsed, err := parseHeaderValues(hs)
		if err != nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
		}
		headers = parsed
	}
	body, _ := args["body"].(string)

	// URL 只插值非敏感的 {{vars.NAME}} 变量，绝不插值 {{secrets.NAME}}：目标地址完全由
	// 智能体/MCP 客户端控制，插值密钥会让明文被发送到任意公网主机。
	// headers/body 中的密钥插值按目标主机限定（见 ResolveSecretsVarsForHost），
	// 只有目标主机在密钥的允许主机列表内才插值，密钥明文只进入出站请求，不进入 LLM 上下文。
	rawURL = confVariablesReadSnapshot.Resolve(rawURL)
	host := ""
	if u, err := url.Parse(rawURL); err == nil {
		host = u.Hostname()
	}
	resolve := func(s string) string {
		return conf.ResolveSecretsVarsForHost(model.Conf.Secrets.Load(), confVariablesReadSnapshot, host, s)
	}
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

// parseHeaderValues 把请求头收敛成字符串。嵌套对象与数组必须报错：直接格式化会把 Go 的
// 内部表示（map[a:1]、[a b]）当成头值发出去，调用方看到成功却发了一段自己没写过的内容。
// 标量按可读形式接受，与 attr 工具对属性值的处理保持一致。
func parseHeaderValues(values map[string]any) (map[string]string, error) {
	headers := make(map[string]string, len(values))
	for name, value := range values {
		switch typed := value.(type) {
		case string:
			headers[name] = typed
		case bool:
			headers[name] = strconv.FormatBool(typed)
		case float64:
			// JSON 数字统一解析为 float64，用最短往返表示避免出现 5.000000。
			headers[name] = strconv.FormatFloat(typed, 'f', -1, 64)
		case nil:
			return nil, fmt.Errorf("header %q must be a string, number or boolean (got null)", name)
		default:
			return nil, fmt.Errorf("header %q must be a string, number or boolean (got %T)", name, value)
		}
	}
	return headers, nil
}
