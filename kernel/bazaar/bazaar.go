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
	"errors"
	"net/url"
	"path"
	"strings"
	"time"
	"unicode"

	"github.com/88250/go-humanize"
	"github.com/araddon/dateparse"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// GetBazaarPackages 返回指定类型的在线集市包列表（plugins 和 themes 类型需要传递 frontend 参数）。
func GetBazaarPackages(pkgType string, frontend string) (packages []*Package) {
	packages, _ = getBazaarPackages(pkgType, frontend, true)
	return
}

func getBazaarPackages(pkgType, frontend string, showError bool) (packages []*Package, err error) {
	result := getStageAndBazaar(pkgType, showError)
	if !result.Online || nil != result.StageErr || nil == result.StageIndex {
		if nil != result.StageErr {
			err = result.StageErr
		} else {
			err = errors.New("bazaar is offline")
		}
		return make([]*Package, 0), err
	}

	packages = make([]*Package, 0, len(result.StageIndex.Repos))
	for _, repo := range result.StageIndex.Repos {
		pkg := buildBazaarPackageWithMetadata(repo, result.BazaarStats, result.BazaarRatings,
			result.RatingAvailable, pkgType, frontend)
		if nil == pkg {
			continue
		}
		packages = append(packages, pkg)
	}
	return
}

// GetBazaarPackagesMap 返回按包名索引的在线集市包映射（plugins 和 themes 类型需要传递 frontend 参数）。
func GetBazaarPackagesMap(pkgType, frontend string) (packagesMap map[string]*Package, err error) {
	packages, err := getBazaarPackages(pkgType, frontend, false)
	if err != nil {
		return map[string]*Package{}, err
	}
	packagesMap = make(map[string]*Package, len(packages))
	for _, pkg := range packages {
		if "" != pkg.Name {
			packagesMap[pkg.Name] = pkg
		}
	}
	return
}

// isValidStageRepoURL 判断 stage 仓库 URL（owner/repo@hash）是否仅包含安全字符，
// 防止拼装图标、预览图等展示链接时混入恶意内容
func isValidStageRepoURL(url string) bool {
	parts := strings.Split(url, "@")
	if 2 != len(parts) || !isValidBazaarRepo(parts[0]) {
		return false
	}
	hash := parts[1]
	if "" == hash || 64 < len(hash) {
		return false
	}
	for _, char := range []byte(hash) {
		if ('a' > char || char > 'z') && ('A' > char || char > 'Z') && ('0' > char || char > '9') &&
			'-' != char && '_' != char && '.' != char {
			return false
		}
	}
	return true
}

func packageImageName(configured *string, legacyName string) string {
	if configured == nil {
		return legacyName
	}
	return *configured
}

func isSupportedPackageImageName(name string) bool {
	if name == "" || name != strings.TrimSpace(name) || path.Base(name) != name || strings.ContainsRune(name, '\\') {
		return false
	}
	switch strings.ToLower(path.Ext(name)) {
	case ".png", ".jpg", ".jpeg", ".webp", ".avif":
		return true
	}
	return false
}

func onlinePackageImageURL(repoURL, imageName string) string {
	if !isSupportedPackageImageName(imageName) {
		return ""
	}
	return util.BazaarOSSServer + "/package/" + repoURL + "/" + url.PathEscape(imageName)
}

func onlinePackagePreviewURL(repoURL, imageName string) string {
	previewURL := onlinePackageImageURL(repoURL, imageName)
	if previewURL == "" {
		return ""
	}
	switch strings.ToLower(path.Ext(imageName)) {
	case ".png", ".jpg", ".jpeg":
		return previewURL + "?imageslim"
	}
	return previewURL
}

func normalizeGitHubPackageSource(repoURL, repoRef string) (string, string) {
	const githubPrefix = "https://github.com/"
	repoURL = strings.TrimSuffix(repoURL, "/")
	if !strings.HasPrefix(repoURL, githubPrefix) || !isValidBazaarRepo(strings.TrimPrefix(repoURL, githubPrefix)) {
		return "", ""
	}
	if repoRef == "" {
		return repoURL, ""
	}
	if len(repoRef) > 256 || repoRef != strings.TrimSpace(repoRef) {
		return "", ""
	}
	for _, r := range repoRef {
		if unicode.IsControl(r) {
			return "", ""
		}
	}
	return repoURL, repoRef
}

// buildBazaarPackageWithMetadata 从 StageRepo 构建带有在线元数据的集市包。
func buildBazaarPackageWithMetadata(repo *StageRepo, bazaarStats map[string]*bazaarStats,
	bazaarRatings map[string]*PackageRating, ratingsAvailable bool, pkgType string, frontend string) *Package {
	if nil == repo || nil == repo.Package || !isValidStageRepoURL(repo.URL) {
		return nil
	}

	pkg := *repo.Package
	clearBazaarPackageRating(&pkg)
	pkg.URL = strings.TrimSuffix(pkg.URL, "/")
	repoURLHash := strings.Split(repo.URL, "@")
	if 2 != len(repoURLHash) {
		return nil
	}
	pkg.RepoURL = "https://github.com/" + repoURLHash[0]
	pkg.RepoHash = repoURLHash[1]
	pkg.RepoRef = repo.RepoRef

	// 展示信息
	pkg.IconURL = onlinePackageImageURL(repo.URL, packageImageName(pkg.Icon, "icon.png"))
	pkg.PreviewURL = onlinePackagePreviewURL(repo.URL, packageImageName(pkg.Preview, "preview.png"))
	pkg.PreferredName = GetPreferredLocaleString(pkg.DisplayName, pkg.Name)
	pkg.PreferredDesc = GetPreferredLocaleString(pkg.Description, "")
	pkg.PreferredFunding = getPreferredFunding(pkg.Funding)
	setPreferredPackageDeprecationMetadata(&pkg)

	// 更新信息
	disallowVer := isBelowRequiredAppVersion(&pkg)
	pkg.DisallowInstall = disallowVer
	pkg.DisallowUpdate = disallowVer
	pkg.UpdateRequiredMinAppVer = pkg.MinAppVersion
	if "plugins" == pkgType || "themes" == pkgType {
		bazaarIncompatible := IsIncompatibleTheme(&pkg, frontend)
		if "plugins" == pkgType {
			bazaarIncompatible = IsIncompatiblePlugin(&pkg, frontend)
		}
		pkg.BazaarIncompatible = &bazaarIncompatible
		if bazaarIncompatible {
			pkg.DisallowInstall = true
			pkg.DisallowUpdate = true
		}
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
	stats := bazaarStats[pkg.Name]
	if nil == stats {
		stats = bazaarStats[strings.ToLower(repoURLHash[0])] // 兼容旧版索引中的 owner/repo 下载统计
	}
	if nil != stats {
		pkg.Downloads = stats.Downloads
	}
	pkg.RatingAvailable = ratingsAvailable
	if ratingsAvailable {
		if rating := bazaarRatings[pkg.Name]; nil != rating {
			pkg.Rating = clonePackageRating(rating)
		}
	}
	return &pkg
}

// formatUpdated 格式化发布日期字符串。
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
