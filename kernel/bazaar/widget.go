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
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/dustin/go-humanize"
	ants "github.com/panjf2000/ants/v2"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type Widget struct {
	*Package
}

func Widgets() (widgets []*Widget) {
	widgets = []*Widget{}

	stageIndex, err := getStageIndex("widgets")
	if nil != err {
		return
	}
	bazaarIndex := getBazaarIndex()

	waitGroup := &sync.WaitGroup{}
	lock := &sync.Mutex{}
	p, _ := ants.NewPoolWithFunc(8, func(arg interface{}) {
		defer waitGroup.Done()

		repo := arg.(*StageRepo)
		repoURL := repo.URL

		widget := &Widget{}
		innerU := util.BazaarOSSServer + "/package/" + repoURL + "/widget.json"
		innerResp, innerErr := httpclient.NewBrowserRequest().SetSuccessResult(widget).Get(innerU)
		if nil != innerErr {
			logging.LogErrorf("get bazaar package [%s] failed: %s", repoURL, innerErr)
			return
		}
		if 200 != innerResp.StatusCode {
			logging.LogErrorf("get bazaar package [%s] failed: %d", innerU, innerResp.StatusCode)
			return
		}

		if disallowDisplayBazaarPackage(widget.Package) {
			return
		}

		widget.URL = strings.TrimSuffix(widget.URL, "/")
		repoURLHash := strings.Split(repoURL, "@")
		widget.RepoURL = "https://github.com/" + repoURLHash[0]
		widget.RepoHash = repoURLHash[1]
		widget.PreviewURL = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageslim"
		widget.PreviewURLThumb = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageView2/2/w/436/h/232"
		widget.IconURL = util.BazaarOSSServer + "/package/" + repoURL + "/icon.png"
		widget.Funding = repo.Package.Funding
		widget.PreferredFunding = getPreferredFunding(widget.Funding)
		widget.PreferredName = getPreferredName(widget.Package)
		widget.PreferredDesc = getPreferredDesc(widget.Description)
		widget.Updated = repo.Updated
		widget.Stars = repo.Stars
		widget.OpenIssues = repo.OpenIssues
		widget.Size = repo.Size
		widget.HSize = humanize.Bytes(uint64(widget.Size))
		widget.HUpdated = formatUpdated(widget.Updated)
		pkg := bazaarIndex[strings.Split(repoURL, "@")[0]]
		if nil != pkg {
			widget.Downloads = pkg.Downloads
		}
		lock.Lock()
		widgets = append(widgets, widget)
		lock.Unlock()
	})
	for _, repo := range stageIndex.Repos {
		waitGroup.Add(1)
		p.Invoke(repo)
	}
	waitGroup.Wait()
	p.Release()

	sort.Slice(widgets, func(i, j int) bool { return widgets[i].Updated > widgets[j].Updated })
	return
}

func InstalledWidgets() (ret []*Widget) {
	ret = []*Widget{}

	widgetsPath := filepath.Join(util.DataDir, "widgets")
	if !util.IsPathRegularDirOrSymlinkDir(widgetsPath) {
		return
	}

	widgetDirs, err := os.ReadDir(widgetsPath)
	if nil != err {
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

		installPath := filepath.Join(util.DataDir, "widgets", dirName)

		widget.Installed = true
		widget.RepoURL = widget.URL
		widget.PreviewURL = "/widgets/" + dirName + "/preview.png"
		widget.PreviewURLThumb = "/widgets/" + dirName + "/preview.png"
		widget.IconURL = "/widgets/" + dirName + "/icon.png"
		widget.PreferredFunding = getPreferredFunding(widget.Funding)
		widget.PreferredName = getPreferredName(widget.Package)
		widget.PreferredDesc = getPreferredDesc(widget.Description)
		info, statErr := os.Stat(filepath.Join(installPath, "README.md"))
		if nil != statErr {
			logging.LogWarnf("stat install theme README.md failed: %s", statErr)
			continue
		}
		widget.HInstallDate = info.ModTime().Format("2006-01-02")
		installSize, _ := util.SizeOfDirectory(installPath)
		widget.InstallSize = installSize
		widget.HInstallSize = humanize.Bytes(uint64(installSize))
		readmeFilename := getPreferredReadme(widget.Readme)
		readme, readErr := os.ReadFile(filepath.Join(installPath, readmeFilename))
		if nil != readErr {
			logging.LogWarnf("read installed README.md failed: %s", readErr)
			continue
		}

		widget.PreferredReadme, _ = renderREADME(widget.URL, readme)
		widget.Outdated = isOutdatedWidget(widget, bazaarWidgets)
		ret = append(ret, widget)
	}
	return
}

func InstallWidget(repoURL, repoHash, installPath string, systemID string) error {
	repoURLHash := repoURL + "@" + repoHash
	data, err := downloadPackage(repoURLHash, true, systemID)
	if nil != err {
		return err
	}
	return installPackage(data, installPath)
}

func UninstallWidget(installPath string) error {
	if err := os.RemoveAll(installPath); nil != err {
		logging.LogErrorf("remove widget [%s] failed: %s", installPath, err)
		return errors.New("remove community widget failed")
	}
	//logging.Logger.Infof("uninstalled widget [%s]", installPath)
	return nil
}
