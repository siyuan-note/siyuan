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

package bazaar

import (
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/88250/go-humanize"
	"github.com/88250/gulu"
	"github.com/araddon/dateparse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// LocaleStrings 表示按语种 key 的字符串表，key 为语种如 "default"、"en_US"、"zh_CN" 等
type LocaleStrings map[string]string

type Funding struct {
	OpenCollective string   `json:"openCollective"`
	Patreon        string   `json:"patreon"`
	GitHub         string   `json:"github"`
	Custom         []string `json:"custom"`
}

type Package struct {
	Author            string        `json:"author"`
	URL               string        `json:"url"`
	Version           string        `json:"version"`
	MinAppVersion     string        `json:"minAppVersion"`
	DisabledInPublish bool          `json:"disabledInPublish"`
	Backends          []string      `json:"backends"`
	Frontends         []string      `json:"frontends"`
	DisplayName       LocaleStrings `json:"displayName"`
	Description       LocaleStrings `json:"description"`
	Readme            LocaleStrings `json:"readme"`
	Funding           *Funding      `json:"funding"`
	Keywords          []string      `json:"keywords"`

	PreferredFunding string `json:"preferredFunding"`
	PreferredName    string `json:"preferredName"`
	PreferredDesc    string `json:"preferredDesc"`
	PreferredReadme  string `json:"preferredReadme"`

	Name            string `json:"name"`
	RepoURL         string `json:"repoURL"`
	RepoHash        string `json:"repoHash"`
	PreviewURL      string `json:"previewURL"`
	PreviewURLThumb string `json:"previewURLThumb"`
	IconURL         string `json:"iconURL"`

	Installed               bool   `json:"installed"`
	Outdated                bool   `json:"outdated"`
	Current                 bool   `json:"current"`
	Updated                 string `json:"updated"`
	Stars                   int    `json:"stars"`
	OpenIssues              int    `json:"openIssues"`
	Size                    int64  `json:"size"`
	HSize                   string `json:"hSize"`
	InstallSize             int64  `json:"installSize"`
	HInstallSize            string `json:"hInstallSize"`
	HInstallDate            string `json:"hInstallDate"`
	HUpdated                string `json:"hUpdated"`
	Downloads               int    `json:"downloads"`
	DisallowInstall         bool   `json:"disallowInstall"`
	DisallowUpdate          bool   `json:"disallowUpdate"`
	UpdateRequiredMinAppVer string `json:"updateRequiredMinAppVer"`

	// 专用字段，nil 时不序列化
	Incompatible *bool     `json:"incompatible,omitempty"` // Plugin：是否不兼容
	Enabled      *bool     `json:"enabled,omitempty"`      // Plugin：是否启用
	Modes        *[]string `json:"modes,omitempty"`        // Theme：支持的模式列表
}

type StageRepo struct {
	URL         string `json:"url"` // owner/repo@hash 形式
	Updated     string `json:"updated"`
	Stars       int    `json:"stars"`
	OpenIssues  int    `json:"openIssues"`
	Size        int64  `json:"size"`
	InstallSize int64  `json:"installSize"`

	// Package 与 stage/*.json 内嵌的完整 package 一致，可直接用于构建列表
	Package *Package `json:"package"`
}

type StageIndex struct {
	Repos []*StageRepo `json:"repos"`

	reposByURL map[string]*StageRepo // 不序列化，首次按 URL 查找时懒构建
	reposOnce  sync.Once
}

// ParsePackageJSON 解析集市包 JSON 文件
func ParsePackageJSON(filePath string) (ret *Package, err error) {
	if !filelock.IsExist(filePath) {
		err = os.ErrNotExist
		return
	}
	data, err := filelock.ReadFile(filePath)
	if err != nil {
		logging.LogErrorf("read [%s] failed: %s", filePath, err)
		return
	}
	if err = gulu.JSON.UnmarshalJSON(data, &ret); err != nil {
		logging.LogErrorf("parse [%s] failed: %s", filePath, err)
		return
	}

	ret.URL = strings.TrimSuffix(ret.URL, "/")
	return
}

// Packages 返回指定类型的集市包列表（plugins 类型需要传递 frontend 参数）
func Packages(pkgType string, frontend string) (packages []*Package) {
	result := getStageAndBazaar(pkgType)

	if !result.Online || nil != result.StageErr || nil == result.StageIndex {
		return make([]*Package, 0)
	}

	packages = make([]*Package, 0, len(result.StageIndex.Repos))
	for _, repo := range result.StageIndex.Repos {
		pkg := buildPackageWithOnlineMetadata(repo, result.BazaarStats, pkgType, frontend)
		if nil == pkg {
			continue
		}
		packages = append(packages, pkg)
	}

	// 通用排序
	sort.Slice(packages, func(i, j int) bool {
		return packages[i].Updated > packages[j].Updated
	})

	return
}

// buildPackageWithOnlineMetadata 从 StageRepo 构建带有在线元数据的集市包
func buildPackageWithOnlineMetadata(repo *StageRepo, bazaarStats map[string]*bazaarStats, pkgType string, frontend string) *Package {
	if nil == repo || nil == repo.Package {
		return nil
	}

	pkg := *repo.Package
	pkg.URL = strings.TrimSuffix(pkg.URL, "/")
	repoURLHash := strings.Split(repo.URL, "@")
	if 2 != len(repoURLHash) {
		return nil
	}
	pkg.RepoURL = "https://github.com/" + repoURLHash[0]
	pkg.RepoHash = repoURLHash[1]

	// 展示信息
	pkg.IconURL = util.BazaarOSSServer + "/package/" + repo.URL + "/icon.png"
	pkg.PreviewURL = util.BazaarOSSServer + "/package/" + repo.URL + "/preview.png?imageslim"
	pkg.PreviewURLThumb = util.BazaarOSSServer + "/package/" + repo.URL + "/preview.png?imageView2/2/w/436/h/232"
	pkg.PreferredName = GetPreferredLocaleString(pkg.DisplayName, pkg.Name)
	pkg.PreferredDesc = GetPreferredLocaleString(pkg.Description, "")
	pkg.PreferredFunding = getPreferredFunding(pkg.Funding)

	// 更新信息
	disallow := isBelowRequiredAppVersion(&pkg)
	pkg.DisallowInstall = disallow
	pkg.DisallowUpdate = disallow
	pkg.UpdateRequiredMinAppVer = pkg.MinAppVersion
	if "plugins" == pkgType {
		incompatible := IsIncompatiblePlugin(&pkg, frontend)
		pkg.Incompatible = &incompatible
	}

	// 统计信息
	pkg.Updated = repo.Updated
	pkg.HUpdated = formatUpdated(pkg.Updated)
	pkg.Stars = repo.Stars
	pkg.OpenIssues = repo.OpenIssues
	pkg.Size = repo.Size
	pkg.HSize = humanize.BytesCustomCeil(uint64(pkg.Size), 2)
	pkg.InstallSize = repo.InstallSize
	pkg.HInstallSize = humanize.BytesCustomCeil(uint64(pkg.InstallSize), 2)
	if stats := bazaarStats[repoURLHash[0]]; nil != stats {
		pkg.Downloads = stats.Downloads
	}
	packageInstallSizeCache.SetDefault(pkg.RepoURL, pkg.InstallSize)
	return &pkg
}

// formatUpdated 格式化更新时间字符串
func formatUpdated(updated string) (ret string) {
	t, e := dateparse.ParseIn(updated, time.Now().Location())
	if nil == e {
		ret = t.Format("2006-01-02")
	} else {
		if strings.Contains(updated, "T") {
			ret = updated[:strings.Index(updated, "T")]
		} else {
			ret = strings.ReplaceAll(strings.ReplaceAll(updated, "T", ""), "Z", "")
		}
	}
	return
}

// GetPreferredLocaleString 从 LocaleStrings 中按当前语种取值，无则回退 default、en_US，再回退 fallback。
func GetPreferredLocaleString(m LocaleStrings, fallback string) string {
	if len(m) == 0 {
		return fallback
	}
	if v := strings.TrimSpace(m[util.Lang]); "" != v {
		return v
	}
	if v := strings.TrimSpace(m["default"]); "" != v {
		return v
	}
	if v := strings.TrimSpace(m["en_US"]); "" != v {
		return v
	}
	return fallback
}

// getPreferredFunding 获取包的首选赞助链接
func getPreferredFunding(funding *Funding) string {
	if nil == funding {
		return ""
	}
	if v := normalizeFundingURL(funding.OpenCollective, "https://opencollective.com/"); "" != v {
		return v
	}
	if v := normalizeFundingURL(funding.Patreon, "https://www.patreon.com/"); "" != v {
		return v
	}
	if v := normalizeFundingURL(funding.GitHub, "https://github.com/sponsors/"); "" != v {
		return v
	}
	if 0 < len(funding.Custom) {
		return funding.Custom[0]
	}
	return ""
}

func normalizeFundingURL(s, base string) string {
	if "" == s {
		return ""
	}
	if strings.HasPrefix(s, "https://") || strings.HasPrefix(s, "http://") {
		return s
	}
	return base + s
}
