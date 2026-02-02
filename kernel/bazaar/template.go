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
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/88250/go-humanize"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type Template struct {
	*Package
}

// Templates 返回集市模板列表
func Templates() (templates []*Template) {
	templates = []*Template{}
	result := getStageAndBazaar("templates")

	if !result.Online {
		return
	}
	if result.StageErr != nil {
		return
	}
	if 1 > len(result.BazaarIndex) {
		return
	}

	for _, repo := range result.StageIndex.Repos {
		if nil == repo.Package {
			continue
		}
		template := buildTemplateFromStageRepo(repo, result.BazaarIndex)
		if nil != template {
			templates = append(templates, template)
		}
	}

	templates = filterLegacyTemplates(templates)

	sort.Slice(templates, func(i, j int) bool { return templates[i].Updated > templates[j].Updated })
	return
}

// buildTemplateFromStageRepo 使用 stage 内嵌的 package 构建 *Template，不发起 HTTP 请求。
func buildTemplateFromStageRepo(repo *StageRepo, bazaarIndex map[string]*bazaarPackage) *Template {
	pkg := *repo.Package
	pkg.URL = strings.TrimSuffix(pkg.URL, "/")
	repoURLHash := strings.Split(repo.URL, "@")
	if 2 != len(repoURLHash) {
		return nil
	}
	pkg.RepoURL = "https://github.com/" + repoURLHash[0]
	pkg.RepoHash = repoURLHash[1]
	pkg.PreviewURL = util.BazaarOSSServer + "/package/" + repo.URL + "/preview.png?imageslim"
	pkg.PreviewURLThumb = util.BazaarOSSServer + "/package/" + repo.URL + "/preview.png?imageView2/2/w/436/h/232"
	pkg.IconURL = util.BazaarOSSServer + "/package/" + repo.URL + "/icon.png"
	pkg.Updated = repo.Updated
	pkg.Stars = repo.Stars
	pkg.OpenIssues = repo.OpenIssues
	pkg.Size = repo.Size
	pkg.HSize = humanize.BytesCustomCeil(uint64(pkg.Size), 2)
	pkg.InstallSize = repo.InstallSize
	pkg.HInstallSize = humanize.BytesCustomCeil(uint64(pkg.InstallSize), 2)
	pkg.HUpdated = formatUpdated(pkg.Updated)
	pkg.PreferredFunding = getPreferredFunding(pkg.Funding)
	pkg.PreferredName = GetPreferredName(&pkg)
	pkg.PreferredDesc = getPreferredDesc(pkg.Description)
	pkg.DisallowInstall = disallowInstallBazaarPackage(&pkg)
	pkg.DisallowUpdate = disallowInstallBazaarPackage(&pkg)
	pkg.UpdateRequiredMinAppVer = pkg.MinAppVersion
	if bp := bazaarIndex[repoURLHash[0]]; nil != bp {
		pkg.Downloads = bp.Downloads
	}
	packageInstallSizeCache.SetDefault(pkg.RepoURL, pkg.InstallSize)
	return &Template{Package: &pkg}
}

func InstalledTemplates() (ret []*Template) {
	ret = []*Template{}

	templatesPath := filepath.Join(util.DataDir, "templates")
	if !util.IsPathRegularDirOrSymlinkDir(templatesPath) {
		return
	}

	templateDirs, err := os.ReadDir(templatesPath)
	if err != nil {
		logging.LogWarnf("read templates folder failed: %s", err)
		return
	}

	bazaarTemplates := Templates()

	for _, templateDir := range templateDirs {
		if !util.IsDirRegularOrSymlink(templateDir) {
			continue
		}
		dirName := templateDir.Name()

		template, parseErr := TemplateJSON(dirName)
		if nil != parseErr || nil == template {
			continue
		}

		template.RepoURL = template.URL
		template.DisallowInstall = disallowInstallBazaarPackage(template.Package)
		if bazaarPkg := getBazaarTemplate(template.Name, bazaarTemplates); nil != bazaarPkg {
			template.DisallowUpdate = disallowInstallBazaarPackage(bazaarPkg.Package)
			template.UpdateRequiredMinAppVer = bazaarPkg.MinAppVersion
			template.RepoURL = bazaarPkg.RepoURL
		}

		installPath := filepath.Join(util.DataDir, "templates", dirName)
		template.Installed = true
		template.PreviewURL = "/templates/" + dirName + "/preview.png"
		template.PreviewURLThumb = "/templates/" + dirName + "/preview.png"
		template.IconURL = "/templates/" + dirName + "/icon.png"
		template.PreferredFunding = getPreferredFunding(template.Funding)
		template.PreferredName = GetPreferredName(template.Package)
		template.PreferredDesc = getPreferredDesc(template.Description)
		info, statErr := os.Stat(filepath.Join(installPath, "template.json"))
		if nil != statErr {
			logging.LogWarnf("stat install template.json failed: %s", statErr)
			continue
		}
		template.HInstallDate = info.ModTime().Format("2006-01-02")
		if installSize, ok := packageInstallSizeCache.Get(template.RepoURL); ok {
			template.InstallSize = installSize.(int64)
		} else {
			is, _ := util.SizeOfDirectory(installPath)
			template.InstallSize = is
			packageInstallSizeCache.SetDefault(template.RepoURL, is)
		}
		template.HInstallSize = humanize.BytesCustomCeil(uint64(template.InstallSize), 2)
		template.PreferredReadme = loadInstalledReadme(installPath, "/templates/"+dirName+"/", template.Readme)
		template.Outdated = isOutdatedTemplate(template, bazaarTemplates)
		ret = append(ret, template)
	}
	return
}

func getBazaarTemplate(name string, templates []*Template) *Template {
	for _, p := range templates {
		if p.Name == name {
			return p
		}
	}
	return nil
}

func InstallTemplate(repoURL, repoHash, installPath string, systemID string) error {
	repoURLHash := repoURL + "@" + repoHash
	data, err := downloadPackage(repoURLHash, true, systemID)
	if err != nil {
		return err
	}
	return installPackage(data, installPath, repoURLHash)
}

func UninstallTemplate(installPath string) error {
	return uninstallPackage(installPath)
}

func filterLegacyTemplates(templates []*Template) (ret []*Template) {
	verTime, _ := time.Parse("2006-01-02T15:04:05", "2021-05-12T00:00:00")
	for _, theme := range templates {
		if "" != theme.Updated {
			updated := theme.Updated[:len("2006-01-02T15:04:05")]
			t, err := time.Parse("2006-01-02T15:04:05", updated)
			if err != nil {
				logging.LogErrorf("convert update time [%s] failed: %s", updated, err)
				continue
			}
			if t.After(verTime) {
				ret = append(ret, theme)
			}
		}
	}
	return
}
