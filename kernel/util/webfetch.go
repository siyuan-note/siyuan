// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute"
)

const (
	maxWebFetchBytes     = 5 * 1024 * 1024  // text/html, text/plain
	maxWebFetchFileBytes = 10 * 1024 * 1024 // file/image download
	maxWebFetchChars     = 50000
)

func WebFetch(rawURL, format string) (string, error) {
	return WebFetchContext(context.Background(), rawURL, format, 0)
}

func WebFetchContext(ctx context.Context, rawURL, format string, timeout int) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, time.Duration(NormalizeWebTimeout(timeout))*time.Second)
	defer cancel()
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return "", errors.New("URL must start with http:// or https://")
	}
	if u.Host == "" {
		return "", errors.New("URL has no host")
	}

	if err := checkHostSSRFContext(ctx, u.Hostname()); err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "text/markdown, text/html;q=0.9, application/xhtml+xml;q=0.9, application/xml;q=0.8, */*;q=0.7")
	// 复用安全传输层，由请求上下文控制整次抓取，避免共享客户端的默认期限截断较长配置。
	client := *ssrfSafeClient
	client.Timeout = 0
	resp, err := client.Do(req)
	if err != nil {
		return "", errors.New("fetch failed: " + err.Error())
	}
	defer resp.Body.Close()
	return readWebFetchResponse(resp, rawURL, format)
}

func readWebFetchResponse(resp *http.Response, rawURL, format string) (string, error) {
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	contentType, _, _ := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	isHTML := contentType == "text/html" || contentType == "application/xhtml+xml"
	isText := isHTML || contentType == "text/plain" || contentType == "text/markdown"
	maxReadBytes := int64(maxWebFetchBytes)
	if !isText {
		maxReadBytes = maxWebFetchFileBytes
	}
	if resp.ContentLength > maxReadBytes {
		return "", errors.New("response too large")
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxReadBytes+1))
	if err != nil {
		return "", errors.New("read body failed: " + err.Error())
	}
	if int64(len(body)) > maxReadBytes {
		return "", errors.New("response too large")
	}

	if !isText {
		filePath, werr := saveImportedFile(rawURL, contentType, body)
		if werr != nil {
			return "", werr
		}
		return fmt.Sprintf("Saved to: %s (%d bytes)", filePath, len(body)), nil
	}

	htmlStr := string(body)

	if !isHTML {
		return truncateRunes(htmlStr, maxWebFetchChars), nil
	}

	if htmlStr == "" {
		return "", errors.New("no meaningful content found in HTML; the page may require JavaScript")
	}
	// 清除脚本、样式等非正文内容，避免将页面代码作为正文交给模型。
	htmlStr = SanitizeHTML(htmlStr)

	engine := NewLute()
	var result string
	switch format {
	case "text":
		result, err = safeHTML2Text(engine, htmlStr)
		if err != nil {
			return "", errors.New("HTML to text conversion failed: " + err.Error())
		}
	default: // markdown
		md, mdErr := safeHTML2Markdown(engine, htmlStr)
		if mdErr != nil {
			return "", errors.New("HTML to Markdown conversion failed: " + mdErr.Error())
		}
		result = md
	}

	if strings.TrimSpace(result) == "" {
		return "", errors.New("no meaningful content found in HTML; the page may require JavaScript")
	}

	return truncateRunes(result, maxWebFetchChars), nil
}

func safeHTML2Markdown(engine *lute.Lute, htmlStr string) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("HTML to Markdown panicked: %v", r)
		}
	}()
	result, err = engine.HTML2Markdown(htmlStr)
	return
}

func safeHTML2Text(engine *lute.Lute, htmlStr string) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("HTML to text panicked: %v", r)
		}
	}()
	result = engine.HTML2Text(htmlStr)
	return
}

func truncateRunes(s string, maxChars int) string {
	length := utf8.RuneCountInString(s)
	if length <= maxChars {
		return s
	}
	return TruncateRunes(s, maxChars) + "\n\n...content truncated, total length " + fmt.Sprintf("%d", length) + " characters..."
}

func extractFilename(rawURL, contentType string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return gulu.Rand.String(7) + extByContentType(contentType)
	}
	// 反斜杠在 Windows 上是路径分隔符，而 path.Base 只按 "/" 切分，先归一再取基名。
	name := path.Base(strings.ReplaceAll(u.Path, `\`, "/"))
	if !isValidImportName(name) {
		name = gulu.Rand.String(7) + extByContentType(contentType)
	}
	if filepath.Ext(name) == "" {
		name += extByContentType(contentType)
	}
	return name
}

// saveImportedFile 把下载内容写入 temp/import 后返回文件路径。
// 文件名可能来自远端 URL，写入前必须确认最终路径仍在该目录内，避免写出目录。
func saveImportedFile(rawURL, contentType string, body []byte) (string, error) {
	importDir := filepath.Join(TempDir, "import")
	if err := os.MkdirAll(importDir, 0755); err != nil {
		return "", errors.New("create import dir failed: " + err.Error())
	}
	filePath := filepath.Join(importDir, extractFilename(rawURL, contentType))
	if !gulu.File.IsSubPath(importDir, filePath) {
		return "", errors.New("import path is not sub path of import dir")
	}
	if err := os.WriteFile(filePath, body, 0644); err != nil {
		return "", errors.New("write file failed: " + err.Error())
	}
	return filePath, nil
}

// isValidImportName 判断下载文件名是否为单个普通文件名，拒绝分隔符、上级目录和 Windows 特殊名称。
func isValidImportName(name string) bool {
	if name == "" || name == "." || name == ".." || name != strings.TrimSpace(name) ||
		strings.ContainsAny(name, `/\:`) || strings.Contains(name, "..") || strings.HasSuffix(name, ".") {
		return false
	}
	for _, r := range name {
		if r < 0x20 || r == 0x7f {
			return false
		}
	}
	switch strings.ToUpper(strings.TrimSuffix(name, filepath.Ext(name))) {
	case "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
		"LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9":
		return false
	}
	return true
}

func extByContentType(contentType string) string {
	ct, _, _ := strings.Cut(contentType, ";")
	if exts, _ := mime.ExtensionsByType(ct); len(exts) > 0 {
		return exts[0]
	}
	return ".bin"
}
