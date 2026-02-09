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
	"path"
	"strings"
	"sync"

	"github.com/88250/gulu"
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

// 如果某个类型的集市包 json 新增字段，需要同步修改 bazaar 的工作流，参考 https://github.com/siyuan-note/bazaar/commit/aa36d0003139c52d8e767c6e18a635be006323e2
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

	Name       string `json:"name"`    // 包名，不一定是仓库名
	RepoURL    string `json:"repoURL"` // 形式为 https://github.com/owner/repo
	RepoHash   string `json:"repoHash"`
	PreviewURL string `json:"previewURL"`
	IconURL    string `json:"iconURL"`

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

// FilterPackages 按关键词过滤集市包列表
func FilterPackages(packages []*Package, keyword string) []*Package {
	keywords := getSearchKeywords(keyword)
	if 0 == len(keywords) {
		return packages
	}
	ret := []*Package{}
	for _, pkg := range packages {
		if packageContainsKeywords(pkg, keywords) {
			ret = append(ret, pkg)
		}
	}
	return ret
}

func getSearchKeywords(query string) (ret []string) {
	query = strings.TrimSpace(query)
	if "" == query {
		return
	}
	keywords := strings.Split(query, " ")
	for _, k := range keywords {
		if "" != k {
			ret = append(ret, strings.ToLower(k))
		}
	}
	return
}

func packageContainsKeywords(pkg *Package, keywords []string) bool {
	if 0 == len(keywords) {
		return true
	}
	if nil == pkg {
		return false
	}
	for _, kw := range keywords {
		if !packageContainsKeyword(pkg, kw) {
			return false
		}
	}
	return true
}

func packageContainsKeyword(pkg *Package, kw string) bool {
	if strings.Contains(strings.ToLower(pkg.Name), kw) || // https://github.com/siyuan-note/siyuan/issues/10515
		strings.Contains(strings.ToLower(pkg.Author), kw) { // https://github.com/siyuan-note/siyuan/issues/11673
		return true
	}
	for _, s := range pkg.DisplayName {
		if strings.Contains(strings.ToLower(s), kw) {
			return true
		}
	}
	for _, s := range pkg.Description {
		if strings.Contains(strings.ToLower(s), kw) {
			return true
		}
	}
	for _, s := range pkg.Keywords {
		if strings.Contains(strings.ToLower(s), kw) {
			return true
		}
	}
	if strings.Contains(strings.ToLower(path.Base(pkg.RepoURL)), kw) { // 仓库名，不一定是包名
		return true
	}
	return false
}
