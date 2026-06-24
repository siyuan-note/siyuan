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
	"mime"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/siyuan-note/httpclient"
)

const (
	maxWebFetchBytes     = 5 * 1024 * 1024  // text/html, text/plain
	maxWebFetchFileBytes = 10 * 1024 * 1024 // file/image download
	maxWebFetchChars     = 50000
)

func WebFetch(rawURL, format string) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return "", errors.New("URL must start with http:// or https://")
	}
	if u.Host == "" {
		return "", errors.New("URL has no host")
	}

	if err := CheckHostSSRF(u.Hostname()); err != nil {
		return "", err
	}

	resp, err := httpclient.NewBrowserRequest().Get(rawURL)
	if err != nil {
		return "", errors.New("fetch failed: " + err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	contentType := resp.Header.Get("Content-Type")
	maxReadBytes := int64(maxWebFetchBytes)
	if !strings.HasPrefix(contentType, "text/html") && !strings.HasPrefix(contentType, "text/plain") {
		maxReadBytes = maxWebFetchFileBytes
	}
	if resp.ContentLength > maxReadBytes {
		return "", errors.New("response too large")
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxReadBytes))
	if err != nil {
		return "", errors.New("read body failed: " + err.Error())
	}

	if !strings.HasPrefix(contentType, "text/html") && !strings.HasPrefix(contentType, "text/plain") {
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

	isHTML := strings.HasPrefix(contentType, "text/html")
	if !isHTML {
		return truncateRunes(htmlStr, maxWebFetchChars), nil
	}

	if htmlStr == "" {
		return "", nil
	}

	engine := NewLute()
	var result string
	switch format {
	case "text":
		result, _ = safeHTML2Text(engine, htmlStr)
	default: // markdown
		md, mdErr := safeHTML2Markdown(engine, htmlStr)
		if mdErr != nil {
			return "", errors.New("HTML to Markdown conversion failed: " + mdErr.Error())
		}
		result = md
	}

	if result == "" {
		return htmlStr, nil
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
	ct := strings.SplitN(contentType, ";", 2)[0]
	if exts, _ := mime.ExtensionsByType(ct); len(exts) > 0 {
		return exts[0]
	}
	return ".bin"
}
