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
	"html"
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

// PackageRating 描述集市包的公开评分汇总。
type PackageRating struct {
	Average      float64  `json:"average"`
	Count        int64    `json:"count"`
	Distribution [5]int64 `json:"distribution"`
}

func clearBazaarPackageRating(pkg *Package) {
	pkg.RatingAvailable = false
	pkg.Rating = nil
}

// Package 描述了集市包元数据和传递给前端的其他信息。
//   - 集市包新增元数据字段需要同步修改 bazaar 的工作流，参考
//     https://github.com/siyuan-note/bazaar/commit/aa36d0003139c52d8e767c6e18a635be006323e2
type Package struct {
	Author            string        `json:"author"`
	URL               string        `json:"url"`
	Version           string        `json:"version"`
	MinAppVersion     string        `json:"minAppVersion"`
	DisabledInPublish bool          `json:"disabledInPublish"`
	Kernels           []string      `json:"kernels"`
	Backends          []string      `json:"backends"`
	Frontends         []string      `json:"frontends"`
	DisplayName       LocaleStrings `json:"displayName"`
	Description       LocaleStrings `json:"description"`
	Readme            LocaleStrings `json:"readme"`
	Funding           *Funding      `json:"funding"`
	Keywords          []string      `json:"keywords"`
	Deprecated        bool          `json:"deprecated,omitempty"`
	DeprecatedReason  LocaleStrings `json:"deprecatedReason,omitempty"`
	Alternatives      []string      `json:"alternatives,omitempty"`

	PreferredFunding          string `json:"preferredFunding"`
	PreferredName             string `json:"preferredName"`
	PreferredDesc             string `json:"preferredDesc"`
	PreferredReadme           string `json:"preferredReadme"`
	PreferredDeprecatedReason string `json:"preferredDeprecatedReason,omitempty"`

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
	InstallTime             int64  `json:"installTime"`
	UpdateTime              int64  `json:"updateTime"`
	HInstallDate            string `json:"hInstallDate"`
	HUpdated                string `json:"hUpdated"`
	Downloads               int    `json:"downloads"`
	DisallowInstall         bool   `json:"disallowInstall"`
	DisallowUpdate          bool   `json:"disallowUpdate"`
	UpdateRequiredMinAppVer string `json:"updateRequiredMinAppVer,omitempty"` // 升级目标要求的最小应用版本
	InvalidReason           string `json:"invalidReason,omitempty"`           // 本地安装包异常原因

	RatingAvailable bool           `json:"ratingAvailable"`  // 在线集市公开评分是否可用
	Rating          *PackageRating `json:"rating,omitempty"` // 在线集市公开评分

	// 专用字段，nil 时不序列化
	InstalledIncompatible *bool     `json:"installedIncompatible,omitempty"` // 插件/主题：本地已安装版本是否不兼容
	BazaarIncompatible    *bool     `json:"bazaarIncompatible,omitempty"`    // 插件/主题：在线集市版本是否不兼容
	Enabled               *bool     `json:"enabled,omitempty"`               // Plugin：是否启用
	UserDisabledInPublish *bool     `json:"userDisabledInPublish,omitempty"` // Plugin：是否由用户在发布服务中禁用
	Modes                 *[]string `json:"modes,omitempty"`                 // Theme：支持的模式列表
}

const (
	PackageInvalidReasonMissingManifest = "missing-manifest"
	PackageInvalidReasonInvalidManifest = "invalid-manifest"
	PackageInvalidReasonNameMismatch    = "name-mismatch"
)

var reservedPackageNames = map[string]bool{
	"CON": true, "PRN": true, "AUX": true, "NUL": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true, "COM5": true,
	"COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true, "LPT5": true,
	"LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true,
}

// IsValidPackageName 判断包名是否可以安全地用作跨平台目录名。
func IsValidPackageName(packageName string) bool {
	if len(packageName) < 1 || len(packageName) > 255 || packageName[0] == '.' || packageName[0] == ' ' ||
		packageName[len(packageName)-1] == '.' || packageName[len(packageName)-1] == ' ' || strings.Contains(packageName, "..") {
		return false
	}
	for _, char := range []byte(packageName) {
		if char < 0x20 || char > 0x7E || strings.ContainsRune(`<>&'":/\|?*`, rune(char)) {
			return false
		}
	}
	return !reservedPackageNames[strings.ToUpper(packageName)]
}

// IsValidInstalledPackage 判断本地集市包的清单名是否与安装目录完全一致。
func IsValidInstalledPackage(pkg *Package, dirName string) bool {
	return pkg != nil && pkg.Name == dirName && IsValidPackageName(pkg.Name)
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

	reposByURL map[string]*StageRepo // 不序列化，首次按 URL 查找时懒构建，随整份索引一起过期
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
	clearPackageDeprecationMetadata(ret)
	return
}

// clearPackageDeprecationMetadata 清除只能由在线集市索引生成的弃用元数据。
func clearPackageDeprecationMetadata(pkg *Package) {
	if pkg == nil {
		return
	}
	pkg.Deprecated = false
	pkg.DeprecatedReason = nil
	pkg.Alternatives = nil
	pkg.PreferredDeprecatedReason = ""
}

// unescapePackageDisplayStrings 将在线 stage 中已 HTML 转义的展示字段还原为原文，与本地 JSON 一致。
func unescapePackageDisplayStrings(pkg *Package) {
	if pkg == nil {
		return
	}
	pkg.Name = html.UnescapeString(pkg.Name)
	pkg.Author = html.UnescapeString(pkg.Author)
	pkg.Version = html.UnescapeString(pkg.Version)
	for k, v := range pkg.DisplayName {
		pkg.DisplayName[k] = html.UnescapeString(v)
	}
	for k, v := range pkg.Description {
		pkg.Description[k] = html.UnescapeString(v)
	}
	for k, v := range pkg.DeprecatedReason {
		pkg.DeprecatedReason[k] = html.UnescapeString(v)
	}
	if pkg.Funding != nil {
		pkg.Funding.OpenCollective = html.UnescapeString(pkg.Funding.OpenCollective)
		pkg.Funding.Patreon = html.UnescapeString(pkg.Funding.Patreon)
		pkg.Funding.GitHub = html.UnescapeString(pkg.Funding.GitHub)
		for i, v := range pkg.Funding.Custom {
			pkg.Funding.Custom[i] = html.UnescapeString(v)
		}
	}
	for i, kw := range pkg.Keywords {
		pkg.Keywords[i] = html.UnescapeString(kw)
	}
}

// setPreferredPackageDeprecationMetadata 计算弃用原因并防御性过滤无效替代包。
func setPreferredPackageDeprecationMetadata(pkg *Package) {
	if pkg == nil || !pkg.Deprecated {
		clearPackageDeprecationMetadata(pkg)
		return
	}
	pkg.PreferredDeprecatedReason = GetPreferredLocaleString(pkg.DeprecatedReason, "")
	alternatives := make([]string, 0, len(pkg.Alternatives))
	seen := make(map[string]struct{}, len(pkg.Alternatives))
	for _, alternative := range pkg.Alternatives {
		identity := strings.ToLower(alternative)
		if !IsValidPackageName(alternative) || strings.EqualFold(alternative, pkg.Name) {
			continue
		}
		if _, duplicate := seen[identity]; duplicate {
			continue
		}
		seen[identity] = struct{}{}
		alternatives = append(alternatives, alternative)
	}
	pkg.Alternatives = alternatives
}

// GetPreferredLocaleString 从 LocaleStrings 中按当前语种取值，无则回退 default、en、en_US（历史命名兼容），再回退 fallback。
func GetPreferredLocaleString(m LocaleStrings, fallback string) string {
	if len(m) == 0 {
		return fallback
	}
	if v := strings.TrimSpace(m[util.Lang]); "" != v {
		return v
	}
	// 兼容集市 JSON 数据中历史下划线 key（zh_CN、en_US 等）
	if v := strings.TrimSpace(m[util.LangToLegacy(util.Lang)]); "" != v {
		return v
	}
	if v := strings.TrimSpace(m["default"]); "" != v {
		return v
	}
	if v := strings.TrimSpace(m["en"]); "" != v {
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
	for _, v := range funding.Custom {
		if !unsafeFundingURI(v) && "" != strings.TrimSpace(v) {
			return v
		}
	}
	return ""
}

// unsafeFundingURI 判断自定义赞助信息是否包含危险或不受支持的 URI 协议。
func unsafeFundingURI(s string) bool {
	s = strings.TrimSpace(strings.ToLower(s))
	if "" == s || strings.HasPrefix(s, "https://") || strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "mailto:") {
		return false
	}

	i := strings.IndexByte(s, ':')
	if i <= 0 {
		return false
	}
	scheme := s[:i]
	for _, r := range scheme {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '+' && r != '-' && r != '.' {
			return false
		}
	}
	if scheme[0] < 'a' || scheme[0] > 'z' {
		return false
	}
	switch scheme {
	case "javascript", "data", "file", "vbscript", "blob":
		return true
	}
	return strings.HasPrefix(s[i:], "://")
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
	keywords := strings.SplitSeq(query, " ")
	for k := range keywords {
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
