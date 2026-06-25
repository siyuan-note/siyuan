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

package util

import (
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/imroc/req/v3"
	"github.com/siyuan-note/httpclient"
)

const (
	maxHTTPRequestBytes     = 5 * 1024 * 1024  // text/html、text/plain、application/json 等文本类响应上限
	maxHTTPRequestFileBytes = 10 * 1024 * 1024 // 二进制响应落盘上限
	maxHTTPRequestChars     = 50000
)

// CheckHostSSRF 校验主机名解析出的 IP 不落在内网/回环等不可达地址段，
// 防止智能体被诱导发起 SSRF 攻击。web_fetch 与 http_request 共用此校验。
func CheckHostSSRF(host string) error {
	ips, err := net.LookupIP(host)
	if err != nil {
		return errors.New("failed to resolve host: " + err.Error())
	}
	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsPrivate() || ip.IsUnspecified() {
			return errors.New("access to private/internal IP is prohibited")
		}
	}
	return nil
}

// HTTPRequest 发起一次通用 HTTP 调用，供智能体 http_request 工具使用。
// 与 WebFetch 不同：本函数不做 HTML→Markdown 转换，文本类响应（含 JSON/XML）原样返回，
// 便于智能体直接消费 REST API 的 JSON 输出。method 取值：GET/POST/PUT/DELETE/PATCH。
// 返回的 text 为响应正文（文本类）或落盘后的文件路径（二进制类）。
func HTTPRequest(method, rawURL string, headers map[string]string, body string) (statusCode int, contentType string, text string, err error) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return 0, "", "", errors.New("URL must start with http:// or https://")
	}
	if u.Host == "" {
		return 0, "", "", errors.New("URL has no host")
	}

	if serr := CheckHostSSRF(u.Hostname()); serr != nil {
		return 0, "", "", serr
	}

	method = strings.ToUpper(strings.TrimSpace(method))
	if method == "" {
		method = "GET"
	}

	request := httpclient.NewBrowserRequest()
	for k, v := range headers {
		request.SetHeader(k, v)
	}
	if body != "" && method != "GET" && method != "HEAD" {
		request.SetBody(body)
	}

	resp, err := sendByMethod(request, method, rawURL)
	if err != nil {
		return 0, "", "", errors.New("request failed: " + err.Error())
	}
	if resp == nil {
		return 0, "", "", errors.New("nil response")
	}
	defer resp.Body.Close()

	statusCode = resp.StatusCode
	contentType = resp.Header.Get("Content-Type")

	maxReadBytes := int64(maxHTTPRequestBytes)
	if !isTextContentType(contentType) {
		maxReadBytes = maxHTTPRequestFileBytes
	}
	// ContentLength 为 -1（chunked）时跳过大小预检，交由 LimitReader 兜底截断。
	if resp.ContentLength > maxReadBytes {
		return statusCode, contentType, "", errors.New("response too large")
	}

	respBody, rerr := io.ReadAll(io.LimitReader(resp.Body, maxReadBytes))
	if rerr != nil {
		return statusCode, contentType, "", errors.New("read body failed: " + rerr.Error())
	}

	// 二进制响应落盘，返回文件路径，供智能体按需进一步处理。
	if !isTextContentType(contentType) {
		importDir := filepath.Join(TempDir, "import")
		if merr := os.MkdirAll(importDir, 0755); merr != nil {
			return statusCode, contentType, "", errors.New("create import dir failed: " + merr.Error())
		}
		filename := extractFilename(rawURL, contentType)
		filePath := filepath.Join(importDir, filename)
		if werr := os.WriteFile(filePath, respBody, 0644); werr != nil {
			return statusCode, contentType, "", errors.New("write file failed: " + werr.Error())
		}
		return statusCode, contentType, fmt.Sprintf("Saved to: %s (%d bytes)", filePath, len(respBody)), nil
	}

	return statusCode, contentType, truncateRunes(string(respBody), maxHTTPRequestChars), nil
}

// sendByMethod 按 method 分发请求，统一走 NewBrowserRequest 返回的 *req.Request。
func sendByMethod(request *req.Request, method, rawURL string) (*req.Response, error) {
	switch method {
	case "GET", "":
		return request.Get(rawURL)
	case "POST":
		return request.Post(rawURL)
	case "PUT":
		return request.Put(rawURL)
	case "DELETE":
		return request.Delete(rawURL)
	case "PATCH":
		return request.Patch(rawURL)
	default:
		return nil, fmt.Errorf("unsupported method: %s", method)
	}
}

// isTextContentType 判断 Content-Type 是否为可直接展示给智能体的文本类响应。
// 覆盖 text/*、application/json、application/xml、application/*+json 等。
func isTextContentType(contentType string) bool {
	ct := strings.ToLower(strings.TrimSpace(strings.SplitN(contentType, ";", 2)[0]))
	if ct == "" {
		return false
	}
	if strings.HasPrefix(ct, "text/") {
		return true
	}
	switch ct {
	case "application/json", "application/xml":
		return true
	}
	if strings.HasPrefix(ct, "application/") && (strings.HasSuffix(ct, "+json") || strings.HasSuffix(ct, "+xml")) {
		return true
	}
	return false
}
