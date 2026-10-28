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
		importDir := filepath.Join(TempDir, "import")
		if merr := os.MkdirAll(importDir, 0755); merr != nil {
			return "", errors.New("create import dir failed: " + merr.Error())
		}
		filename := extractFilename(rawURL, contentType)
		filePath := filepath.Join(importDir, filename)
		if werr := os.WriteFile(filePath, body, 0644); werr != nil {
			return "", errors.New("write file failed: " + werr.Error())
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
	runes := []rune(s)
	if len(runes) <= maxChars {
		return s
	}
	return string(runes[:maxChars]) + "\n\n...content truncated, total length " + fmt.Sprintf("%d", len(runes)) + " characters..."
}

func extractFilename(rawURL, contentType string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return gulu.Rand.String(7) + extByContentType(contentType)
	}
	name := path.Base(u.Path)
	if name == "" || name == "." || name == "/" {
		name = gulu.Rand.String(7) + extByContentType(contentType)
	}
	if filepath.Ext(name) == "" {
		name += extByContentType(contentType)
	}
	return name
}

func extByContentType(contentType string) string {
	ct, _, _ := strings.Cut(contentType, ";")
	if exts, _ := mime.ExtensionsByType(ct); len(exts) > 0 {
		return exts[0]
	}
	return ".bin"
}
