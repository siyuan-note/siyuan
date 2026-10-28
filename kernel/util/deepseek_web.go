// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/siyuan-note/httpclient"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

const deepSeekWebURL = "https://api.deepseek.com/v1/tools/"
const deepSeekSearchCount = 5
const deepSeekSearchChars = 8000

type DeepSeekWebOptions struct {
	APIKey  string
	Timeout int
}

type deepSeekSearchResult struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Date    string `json:"date"`
	Summary string `json:"summary"`
	Snippet string `json:"snippet"`
}

var deepSeekWebHTTPClient = func() *http.Client {
	client := httpclient.NewUserAgentClient(nil)
	// 搜索词、目标网址和凭据仅发送到固定的官方端点，不跟随重定向。
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return client
}()

func deepSeekWebRequest(ctx context.Context, options DeepSeekWebOptions, action string, payload, result any) error {
	key := strings.TrimSpace(options.APIKey)
	if key == "" {
		return errors.New("DeepSeek web API key is not configured")
	}
	timeout := NormalizeWebTimeout(options.Timeout)
	ctx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
	defer cancel()
	body, err := json.Marshal(payload)
	if err != nil {
		return errors.New("could not encode DeepSeek web request")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, deepSeekWebURL+action, bytes.NewReader(body))
	if err != nil {
		return errors.New("could not create DeepSeek web request")
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := deepSeekWebHTTPClient.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("DeepSeek web request failed; check the network")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("DeepSeek %s returned HTTP %d; check credentials, balance, limits and service availability", action, resp.StatusCode)
	}
	body, err = io.ReadAll(io.LimitReader(resp.Body, maxWebFetchBytes+1))
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("could not read DeepSeek web response")
	}
	if len(body) > maxWebFetchBytes {
		return errors.New("DeepSeek web response exceeds 5 MiB")
	}
	if !utf8.Valid(body) || json.Unmarshal(body, result) != nil {
		return errors.New("DeepSeek web API returned invalid JSON")
	}
	return nil
}

func DeepSeekWebSearch(ctx context.Context, options DeepSeekWebOptions, query string) (string, error) {
	if strings.TrimSpace(query) == "" || !utf8.ValidString(query) || utf8.RuneCountInString(query) > 128 {
		return "", errors.New("DeepSeek search query must contain 1 to 128 Unicode characters")
	}
	request := struct {
		Query       string `json:"query"`
		Count       int    `json:"count"`
		NeedContent bool   `json:"need_content"`
	}{query, deepSeekSearchCount, false}
	var response struct {
		Results []deepSeekSearchResult `json:"results"`
	}
	if err := deepSeekWebRequest(ctx, options, "search", request, &response); err != nil {
		return "", err
	}
	if response.Results == nil {
		return "", errors.New("DeepSeek search response is missing results")
	}
	if len(response.Results) == 0 {
		return "No search results found. Please try a different query.", nil
	}
	var output strings.Builder
	remaining := deepSeekSearchChars
	for _, item := range response.Results[:min(len(response.Results), deepSeekSearchCount)] {
		u, err := url.Parse(item.URL)
		if err != nil || u.Host == "" || u.User != nil || u.Scheme != "http" && u.Scheme != "https" {
			continue
		}
		// 保留完整链接；预算不足时略过该条，不能把截断的网址交给模型继续抓取。
		header := fmt.Sprintf("Title: %s\nURL: %s\nDate: %s\nSummary: ",
			clipWebText(item.Title, 200), item.URL, clipWebText(item.Date, 64))
		headerChars := utf8.RuneCountInString(header) + 2
		if headerChars >= remaining {
			continue
		}
		summary := item.Summary
		if strings.TrimSpace(summary) == "" {
			summary = item.Snippet
		}
		entry := header + clipWebText(summary, min(800, remaining-headerChars)) + "\n\n"
		output.WriteString(entry)
		remaining -= utf8.RuneCountInString(entry)
	}
	if output.Len() == 0 {
		return "", errors.New("DeepSeek search returned no usable result links")
	}
	return output.String(), nil
}

func clipWebText(text string, limit int) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	marker := strings.Repeat(".", min(3, max(0, limit)))
	return string(runes[:max(0, limit-len(marker))]) + marker
}

func DeepSeekWebFetch(ctx context.Context, options DeepSeekWebOptions, rawURL, format string) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" || u.User != nil || u.Scheme != "http" && u.Scheme != "https" ||
		utf8.RuneCountInString(rawURL) > 8192 {
		return "", errors.New("DeepSeek fetch requires an HTTP/HTTPS URL without credentials, up to 8192 characters")
	}
	if err = CheckHostSSRF(u.Hostname()); err != nil {
		return "", err
	}
	var response struct {
		Title   string  `json:"title"`
		Content *string `json:"content"`
	}
	if err = deepSeekWebRequest(ctx, options, "fetch", struct {
		URL string `json:"url"`
	}{rawURL}, &response); err != nil {
		return "", err
	}
	if response.Content == nil || strings.TrimSpace(*response.Content) == "" {
		return "", errors.New("DeepSeek fetch returned no page content; use direct fetch for file downloads")
	}
	result := *response.Content
	if format == "text" {
		engine := NewStdLute()
		engine.SetCodeSyntaxHighlight(false)
		result, err = deepSeekWebText(SanitizeHTML(engine.MarkdownStr("", result)))
		if err != nil {
			return "", errors.New("DeepSeek Markdown to text conversion failed")
		}
	}
	if strings.TrimSpace(result) == "" {
		return "", errors.New("DeepSeek fetch returned no meaningful page text")
	}
	return truncateRunes(result, maxWebFetchChars), nil
}

// 按 HTML 结构提取文本，保留块间换行、表格单元格间隔和代码中的字面字符。
func deepSeekWebText(source string) (string, error) {
	document, err := html.Parse(strings.NewReader(source))
	if err != nil {
		return "", err
	}
	var output strings.Builder
	var walk func(*html.Node, bool)
	walk = func(node *html.Node, preserveWhitespace bool) {
		preserveWhitespace = preserveWhitespace || node.Type == html.ElementNode &&
			(node.DataAtom == atom.Pre || node.DataAtom == atom.Code)
		if node.Type == html.TextNode {
			if preserveWhitespace || strings.TrimSpace(node.Data) != "" || !strings.ContainsAny(node.Data, "\r\n\t") {
				output.WriteString(node.Data)
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child, preserveWhitespace)
		}
		if node.Type != html.ElementNode {
			return
		}
		switch node.DataAtom {
		case atom.P, atom.Div, atom.H1, atom.H2, atom.H3, atom.H4, atom.H5, atom.H6,
			atom.Li, atom.Ul, atom.Ol, atom.Blockquote, atom.Pre, atom.Tr, atom.Table, atom.Br, atom.Hr:
			output.WriteByte('\n')
		case atom.Td, atom.Th:
			output.WriteByte('\t')
		}
	}
	walk(document, false)
	return strings.TrimSpace(output.String()), nil
}
