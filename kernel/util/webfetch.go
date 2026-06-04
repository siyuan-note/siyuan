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
	"strings"

	"github.com/siyuan-note/httpclient"
)

const (
	maxWebFetchBytes = 5 * 1024 * 1024 // 5MB
	maxWebFetchChars = 50000
)

func WebFetch(rawURL, format string) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return "", errors.New("URL must start with http:// or https://")
	}
	if u.Host == "" {
		return "", errors.New("URL has no host")
	}

	host := u.Hostname()
	ips, err := net.LookupIP(host)
	if err != nil {
		return "", errors.New("failed to resolve host: " + err.Error())
	}
	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsPrivate() || ip.IsUnspecified() {
			return "", errors.New("access to private/internal IP is prohibited")
		}
	}

	resp, err := httpclient.NewBrowserRequest().Get(rawURL)
	if err != nil {
		return "", errors.New("fetch failed: " + err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	if resp.ContentLength > maxWebFetchBytes {
		return "", errors.New("response too large (exceeds 5MB limit)")
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxWebFetchBytes))
	if err != nil {
		return "", errors.New("read body failed: " + err.Error())
	}

	contentType := resp.Header.Get("Content-Type")
	htmlStr := string(body)

	isHTML := strings.HasPrefix(contentType, "text/html")
	if !isHTML {
		return truncateRunes(htmlStr, maxWebFetchChars), nil
	}

	engine := NewLute()
	var result string
	switch format {
	case "text":
		result = engine.HTML2Text(htmlStr)
	default: // markdown
		md, mdErr := engine.HTML2Markdown(htmlStr)
		if mdErr != nil {
			return "", errors.New("HTML to Markdown conversion failed: " + mdErr.Error())
		}
		result = md
	}

	return truncateRunes(result, maxWebFetchChars), nil
}

func truncateRunes(s string, maxChars int) string {
	runes := []rune(s)
	if len(runes) <= maxChars {
		return s
	}
	return string(runes[:maxChars]) + "\n\n...content truncated, total length " + fmt.Sprintf("%d", len(runes)) + " characters..."
}
