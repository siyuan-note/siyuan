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

	"github.com/88250/go-humanize"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type Widget struct {
	*Package
}

// Widgets 返回集市挂件列表
func Widgets() (widgets []*Widget) {
	widgets = []*Widget{}
	result := getStageAndBazaar("widgets")

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
		widget := buildWidgetFromStageRepo(repo, result.BazaarIndex)
		if nil != widget {
			widgets = append(widgets, widget)
		}
	}

	sort.Slice(widgets, func(i, j int) bool { return widgets[i].Updated > widgets[j].Updated })
	return
}

// buildWidgetFromStageRepo 使用 stage 内嵌的 package 构建 *Widget，不发起 HTTP 请求。
func buildWidgetFromStageRepo(repo *StageRepo, bazaarIndex map[string]*bazaarPackage) *Widget {
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
	return &Widget{Package: &pkg}
}

func InstalledWidgets() (ret []*Widget) {
	ret = []*Widget{}

	widgetsPath := filepath.Join(util.DataDir, "widgets")
	if !util.IsPathRegularDirOrSymlinkDir(widgetsPath) {
		return
	}

	widgetDirs, err := os.ReadDir(widgetsPath)
	if err != nil {
		logging.LogWarnf("read widgets folder failed: %s", err)
		return
	}

	bazaarWidgets := Widgets()

	for _, widgetDir := range widgetDirs {
		if !util.IsDirRegularOrSymlink(widgetDir) {
			continue
		}
		dirName := widgetDir.Name()

		widget, parseErr := WidgetJSON(dirName)
		if nil != parseErr || nil == widget {
			continue
		}

		widget.RepoURL = widget.URL
		widget.DisallowInstall = disallowInstallBazaarPackage(widget.Package)
		if bazaarPkg := getBazaarWidget(widget.Name, bazaarWidgets); nil != bazaarPkg {
			widget.DisallowUpdate = disallowInstallBazaarPackage(bazaarPkg.Package)
			widget.UpdateRequiredMinAppVer = bazaarPkg.MinAppVersion
			widget.RepoURL = bazaarPkg.RepoURL
		}

		installPath := filepath.Join(util.DataDir, "widgets", dirName)
		widget.Installed = true
		widget.PreviewURL = "/widgets/" + dirName + "/preview.png"
		widget.PreviewURLThumb = "/widgets/" + dirName + "/preview.png"
		widget.IconURL = "/widgets/" + dirName + "/icon.png"
		widget.PreferredFunding = getPreferredFunding(widget.Funding)
		widget.PreferredName = GetPreferredName(widget.Package)
		widget.PreferredDesc = getPreferredDesc(widget.Description)
		info, statErr := os.Stat(filepath.Join(installPath, "widget.json"))
		if nil != statErr {
			logging.LogWarnf("stat install widget.json failed: %s", statErr)
			continue
		}
		widget.HInstallDate = info.ModTime().Format("2006-01-02")
		if installSize, ok := packageInstallSizeCache.Get(widget.RepoURL); ok {
			widget.InstallSize = installSize.(int64)
		} else {
			is, _ := util.SizeOfDirectory(installPath)
			widget.InstallSize = is
			packageInstallSizeCache.SetDefault(widget.RepoURL, is)
		}
		widget.HInstallSize = humanize.BytesCustomCeil(uint64(widget.InstallSize), 2)
		widget.PreferredReadme = loadInstalledReadme(installPath, "/widgets/"+dirName+"/", widget.Readme)
		widget.Outdated = isOutdatedWidget(widget, bazaarWidgets)
		ret = append(ret, widget)
	}
	return
}

func getBazaarWidget(name string, widgets []*Widget) *Widget {
	for _, p := range widgets {
		if p.Name == name {
			return p
		}
	}
	return nil
}

func InstallWidget(repoURL, repoHash, installPath string, systemID string) error {
	repoURLHash := repoURL + "@" + repoHash
	data, err := downloadPackage(repoURLHash, true, systemID)
	if err != nil {
		return err
	}
	return installPackage(data, installPath, repoURLHash)
}

func UninstallWidget(installPath string) error {
	return uninstallPackage(installPath)
}
