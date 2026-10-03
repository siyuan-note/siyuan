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

package bazaar

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"golang.org/x/sync/singleflight"
)

const (
	// GitHub 的发行版接口，一次最多 100 条（GitHub 上限），够任何集市包的全部历史版本。
	githubReleasesURLFormat = "https://api.github.com/repos/%s/releases?per_page=100"
	// 发行版列表在内存里留多久：集市索引本身 1-3 小时才更新一次，半小时足够新。
	githubReleasesCacheSeconds = int64(30 * 60)
)

// githubAPIPrefixes 是 GitHub 接口的反代前缀，按可达性排序，仅作官方接口的兜底。
// 前缀式反代把「https:// 之后的完整地址」拼在自己域名后面，所以打到的仍是 GitHub 官方接口。
// 公益反代域名会变，这里是可随时替换的配置。
var githubAPIPrefixes = []string{
	"https://gh-proxy.com/",
	"https://ghproxy.vip/",
	"https://cdn.gh-proxy.com/",
}

// BazaarRelease 是集市包的一个发行版：标签、发布时间与渲染好的发行说明 HTML。
type BazaarRelease struct {
	Tag         string `json:"tag"`
	PublishedAt string `json:"publishedAt"`
	HTML        string `json:"html"`
}

type githubRelease struct {
	TagName     string `json:"tag_name"`
	Body        string `json:"body"`
	Draft       bool   `json:"draft"`
	PublishedAt string `json:"published_at"`
}

var (
	bazaarReleases           = map[string][]*BazaarRelease{}
	bazaarReleasesCacheTimes = map[string]int64{}
	bazaarReleasesLock       sync.RWMutex
	bazaarReleasesFlight     singleflight.Group
)

// githubAPIURLs 按优先级给出候选地址：GitHub 官方接口优先，反代依次兜底。
// 反代只是前缀式转发，请求仍打到 GitHub 官方接口，换的只是出网的那一跳。
func githubAPIURLs(u string) (ret []string) {
	ret = append(ret, u)
	for _, prefix := range githubAPIPrefixes {
		ret = append(ret, prefix+u)
	}
	return
}

// GithubOwnerRepo 从集市包的仓库地址里取出 owner/repo；不是 GitHub 仓库时返回 false。
// 地址由内核自己拼，调用方只能给 owner/repo，避免这个接口变成任意 URL 的转发器。
func GithubOwnerRepo(repoURL string) (string, bool) {
	const prefix = "https://github.com/"
	repoURL = strings.TrimSuffix(strings.TrimSpace(repoURL), "/")
	repoURL = strings.TrimSuffix(repoURL, ".git")
	if !strings.HasPrefix(repoURL, prefix) {
		return "", false
	}
	ownerRepo := strings.TrimPrefix(repoURL, prefix)
	if strings.Count(ownerRepo, "/") != 1 || strings.ContainsAny(ownerRepo, "?#") {
		return "", false
	}
	owner, repo, _ := strings.Cut(ownerRepo, "/")
	if "" == owner || "" == repo {
		return "", false
	}
	return owner + "/" + repo, true
}

// GetBazaarPackageReleases 获取集市包在 GitHub 上的发行版列表，发行说明已渲染为 HTML。
// 只认 https://github.com/owner/repo 形式的仓库地址；取不到时返回 nil，由调用方决定怎么提示。
func GetBazaarPackageReleases(ctx context.Context, repoURL string) (ret []*BazaarRelease) {
	ownerRepo, ok := GithubOwnerRepo(repoURL)
	if !ok {
		return
	}
	if cached, ok := getCachedBazaarReleases(ownerRepo); ok {
		return cached
	}

	value, err, _ := bazaarReleasesFlight.Do(ownerRepo, func() (any, error) {
		if cached, ok := getCachedBazaarReleases(ownerRepo); ok {
			return cached, nil
		}
		return fetchBazaarReleases(ctx, ownerRepo)
	})
	if err != nil {
		logging.LogWarnf("get bazaar package [%s] releases failed: %s", ownerRepo, err)
		return
	}
	return value.([]*BazaarRelease)
}

func fetchBazaarReleases(ctx context.Context, ownerRepo string) ([]*BazaarRelease, error) {
	u := fmt.Sprintf(githubReleasesURLFormat, ownerRepo)
	var lastErr error
	for _, candidate := range githubAPIURLs(u) {
		// 每次尝试都用新的切片：反代返回错误页时不能把上一跳的结果留在里面
		releases := []*githubRelease{}
		response, err := httpclient.NewCloudRequest30s().
			SetContext(ctx).
			SetHeader("Accept", "application/vnd.github+json").
			SetHeader("X-GitHub-Api-Version", "2022-11-28").
			SetSuccessResult(&releases).
			Get(candidate)
		if err != nil {
			// 连不上、超时、或者响应不是能解码的 JSON（反代回的错误页会走到这里）
			lastErr = err
			logging.LogWarnf("get GitHub releases [%s] failed: %s", candidate, err)
			continue
		}
		if 200 != response.StatusCode {
			lastErr = fmt.Errorf("HTTP %d", response.StatusCode)
			logging.LogWarnf("get GitHub releases [%s] failed: %d", candidate, response.StatusCode)
			continue
		}
		// 2xx 且解码成功就算这一跳成功：空数组是合法答案（该仓库确实没有发行版）
		ret := renderBazaarReleases(ownerRepo, releases)
		cacheBazaarReleases(ownerRepo, ret)
		return ret, nil
	}
	if nil == lastErr {
		lastErr = errors.New("no candidate URL is available")
	}
	return nil, lastErr
}

// renderBazaarReleases 过滤草稿、按发布时间倒序，并把发行说明渲染成 HTML。
func renderBazaarReleases(ownerRepo string, releases []*githubRelease) []*BazaarRelease {
	linkBase := "https://github.com/" + ownerRepo + "/"
	ret := make([]*BazaarRelease, 0, len(releases))
	for _, release := range releases {
		if nil == release || release.Draft || "" == release.TagName {
			continue
		}
		// 复用集市 README 的渲染器：相对链接补基地址、链接一律 target="_blank"、iframe 降级
		ret = append(ret, &BazaarRelease{
			Tag:         release.TagName,
			PublishedAt: release.PublishedAt,
			HTML:        renderPackageREADME(linkBase, []byte(release.Body)),
		})
	}
	// published_at 是 ISO 8601，字典序就是时间序；草稿已排除，所以它一定有值
	sort.SliceStable(ret, func(i, j int) bool { return ret[i].PublishedAt > ret[j].PublishedAt })
	return ret
}

func getCachedBazaarReleases(ownerRepo string) ([]*BazaarRelease, bool) {
	bazaarReleasesLock.RLock()
	defer bazaarReleasesLock.RUnlock()
	cached, ok := bazaarReleases[ownerRepo]
	if !ok || githubReleasesCacheSeconds < time.Now().Unix()-bazaarReleasesCacheTimes[ownerRepo] {
		return nil, false
	}
	return cached, true
}

func cacheBazaarReleases(ownerRepo string, releases []*BazaarRelease) {
	bazaarReleasesLock.Lock()
	defer bazaarReleasesLock.Unlock()
	bazaarReleases[ownerRepo] = releases
	bazaarReleasesCacheTimes[ownerRepo] = time.Now().Unix()
}
