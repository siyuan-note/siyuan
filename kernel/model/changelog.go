// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/88250/lute"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/mod/semver"
	"golang.org/x/sync/singleflight"
)

const releaseChangelogTimeout = 10 * time.Second
const maxReleaseChangelogSize = 1024 * 1024

type cachedReleaseChangelog struct {
	html      string
	expiresAt time.Time
}

type releaseChangelogSource struct {
	client *http.Client
	cache  sync.Map
	flight singleflight.Group
}

var releaseChangelogs = &releaseChangelogSource{client: newReleaseChangelogClient()}

func newReleaseChangelogClient() *http.Client {
	client := httpclient.NewUserAgentClient(nil)
	client.Timeout = releaseChangelogTimeout
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	return client
}

func GetReleaseChangelog(ctx context.Context, version string) (string, error) {
	return releaseChangelogs.get(ctx, version)
}

func (source *releaseChangelogSource) get(ctx context.Context, version string) (string, error) {
	tag := "v" + version
	if !semver.IsValid(tag) || semver.Prerelease(tag) == "" {
		return "", errors.New("invalid prerelease version")
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if cached, ok := source.cache.Load(tag); ok && time.Now().Before(cached.(cachedReleaseChangelog).expiresAt) {
		return cached.(cachedReleaseChangelog).html, nil
	}
	result := source.flight.DoChan(tag, func() (any, error) {
		if cached, ok := source.cache.Load(tag); ok && time.Now().Before(cached.(cachedReleaseChangelog).expiresAt) {
			return cached.(cachedReleaseChangelog).html, nil
		}
		// 多个窗口共享请求，单个窗口关闭不会取消其他窗口正在等待的结果。
		requestContext, cancel := context.WithTimeout(context.Background(), releaseChangelogTimeout)
		defer cancel()
		content, err := source.fetch(requestContext, tag)
		if err != nil {
			return "", err
		}
		source.cache.Store(tag, cachedReleaseChangelog{html: content, expiresAt: time.Now().Add(6 * time.Hour)})
		return content, nil
	})
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case value := <-result:
		if value.Err != nil {
			return "", value.Err
		}
		return value.Val.(string), nil
	}
}

func (source *releaseChangelogSource) fetch(ctx context.Context, tag string) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://api.github.com/repos/siyuan-note/siyuan/releases/tags/"+url.PathEscape(tag), nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	response, err := source.client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("get release changelog failed: HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxReleaseChangelogSize+1))
	if err != nil {
		return "", err
	}
	if len(data) > maxReleaseChangelogSize {
		return "", errors.New("release changelog is too large")
	}
	var release struct {
		TagName string `json:"tag_name"`
		Draft   bool   `json:"draft"`
		Body    string `json:"body"`
	}
	if err = json.Unmarshal(data, &release); err != nil {
		return "", err
	}
	if release.TagName != tag || release.Draft || strings.TrimSpace(release.Body) == "" {
		return "", errors.New("release changelog is unavailable for the requested version")
	}
	luteEngine := lute.New()
	luteEngine.SetSanitize(true)
	luteEngine.SetCodeSyntaxHighlight(false)
	const linkBase = "https://github.com/siyuan-note/siyuan/"
	luteEngine.SetLinkBase(linkBase)
	return util.LinkTarget(luteEngine.MarkdownStr("", release.Body), linkBase), nil
}
