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
	"time"

	"github.com/dustin/go-humanize"
	"github.com/panjf2000/ants/v2"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type Template struct {
	*Package
}

func Templates() (templates []*Template) {
	templates = []*Template{}

	stageIndex, err := getStageIndex("templates")
	if nil != err {
		return
	}
	bazaarIndex := getBazaarIndex()
	waitGroup := &sync.WaitGroup{}
	lock := &sync.Mutex{}
	p, _ := ants.NewPoolWithFunc(2, func(arg interface{}) {
		defer waitGroup.Done()

		repo := arg.(*StageRepo)
		repoURL := repo.URL

		template := &Template{}
		innerU := util.BazaarOSSServer + "/package/" + repoURL + "/template.json"
		innerResp, innerErr := httpclient.NewBrowserRequest().SetSuccessResult(template).Get(innerU)
		if nil != innerErr {
			logging.LogErrorf("get community template [%s] failed: %s", repoURL, innerErr)
			return
		}
		if 200 != innerResp.StatusCode {
			logging.LogErrorf("get bazaar package [%s] failed: %d", innerU, innerResp.StatusCode)
			return
		}

		if disallowDisplayBazaarPackage(template.Package) {
			return
		}

		template.URL = strings.TrimSuffix(template.URL, "/")
		repoURLHash := strings.Split(repoURL, "@")
		template.RepoURL = "https://github.com/" + repoURLHash[0]
		template.RepoHash = repoURLHash[1]
		template.PreviewURL = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageslim"
		template.PreviewURLThumb = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageView2/2/w/436/h/232"
		template.IconURL = util.BazaarOSSServer + "/package/" + repoURL + "/icon.png"
		template.Funding = repo.Package.Funding
		template.PreferredFunding = getPreferredFunding(template.Funding)
		template.PreferredName = getPreferredName(template.Package)
		template.PreferredDesc = getPreferredDesc(template.Description)
		template.Updated = repo.Updated
		template.Stars = repo.Stars
		template.OpenIssues = repo.OpenIssues
		template.Size = repo.Size
		template.HSize = humanize.Bytes(uint64(template.Size))
		template.HUpdated = formatUpdated(template.Updated)
		pkg := bazaarIndex[strings.Split(repoURL, "@")[0]]
		if nil != pkg {
			template.Downloads = pkg.Downloads
		}
		lock.Lock()
		templates = append(templates, template)
		lock.Unlock()
	})
	for _, repo := range stageIndex.Repos {
		waitGroup.Add(1)
		p.Invoke(repo)
	}
	waitGroup.Wait()
	p.Release()

	templates = filterLegacyTemplates(templates)

	sort.Slice(templates, func(i, j int) bool { return templates[i].Updated > templates[j].Updated })
	return
}

func InstalledTemplates() (ret []*Template) {
	ret = []*Template{}

	templatesPath := filepath.Join(util.DataDir, "templates")
	if !util.IsPathRegularDirOrSymlinkDir(templatesPath) {
		return
	}

	templateDirs, err := os.ReadDir(templatesPath)
	if nil != err {
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

		installPath := filepath.Join(util.DataDir, "templates", dirName)

		template.Installed = true
		template.RepoURL = template.URL
		template.PreviewURL = "/templates/" + dirName + "/preview.png"
		template.PreviewURLThumb = "/templates/" + dirName + "/preview.png"
		template.IconURL = "/templates/" + dirName + "/icon.png"
		template.PreferredFunding = getPreferredFunding(template.Funding)
		template.PreferredName = getPreferredName(template.Package)
		template.PreferredDesc = getPreferredDesc(template.Description)
		info, statErr := os.Stat(filepath.Join(installPath, "README.md"))
		if nil != statErr {
			logging.LogWarnf("stat install theme README.md failed: %s", statErr)
			continue
		}
		template.HInstallDate = info.ModTime().Format("2006-01-02")
		installSize, _ := util.SizeOfDirectory(installPath)
		template.InstallSize = installSize
		template.HInstallSize = humanize.Bytes(uint64(installSize))
		readmeFilename := getPreferredReadme(template.Readme)
		readme, readErr := os.ReadFile(filepath.Join(installPath, readmeFilename))
		if nil != readErr {
			logging.LogWarnf("read installed README.md failed: %s", readErr)
			continue
		}

		template.PreferredReadme, _ = renderREADME(template.URL, readme)
		template.Outdated = isOutdatedTemplate(template, bazaarTemplates)
		ret = append(ret, template)
	}
	return
}

func InstallTemplate(repoURL, repoHash, installPath string, systemID string) error {
	repoURLHash := repoURL + "@" + repoHash
	data, err := downloadPackage(repoURLHash, true, systemID)
	if nil != err {
		return err
	}
	return installPackage(data, installPath)
}

func UninstallTemplate(installPath string) error {
	if err := os.RemoveAll(installPath); nil != err {
		logging.LogErrorf("remove template [%s] failed: %s", installPath, err)
		return errors.New("remove community template failed")
	}
	return nil
}

func filterLegacyTemplates(templates []*Template) (ret []*Template) {
	verTime, _ := time.Parse("2006-01-02T15:04:05", "2021-05-12T00:00:00")
	for _, theme := range templates {
		if "" != theme.Updated {
			updated := theme.Updated[:len("2006-01-02T15:04:05")]
			t, err := time.Parse("2006-01-02T15:04:05", updated)
			if nil != err {
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
