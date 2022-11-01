// SiYuan - Build Your Eternal Digital Garden
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
	Package
}

func Templates() (templates []*Template) {
	templates = []*Template{}

	pkgIndex, err := getPkgIndex("templates")
	if nil != err {
		return
	}
	bazaarIndex := getBazaarIndex()
	repos := pkgIndex["repos"].([]interface{})
	waitGroup := &sync.WaitGroup{}
	lock := &sync.Mutex{}
	p, _ := ants.NewPoolWithFunc(2, func(arg interface{}) {
		defer waitGroup.Done()

		repo := arg.(map[string]interface{})
		repoURL := repo["url"].(string)

		template := &Template{}
		innerU := util.BazaarOSSServer + "/package/" + repoURL + "/template.json"
		innerResp, innerErr := httpclient.NewBrowserRequest().SetResult(template).Get(innerU)
		if nil != innerErr {
			logging.LogErrorf("get community template [%s] failed: %s", repoURL, innerErr)
			return
		}
		if 200 != innerResp.StatusCode {
			logging.LogErrorf("get bazaar package [%s] failed: %d", innerU, innerResp.StatusCode)
			return
		}

		repoURLHash := strings.Split(repoURL, "@")
		template.RepoURL = "https://github.com/" + repoURLHash[0]
		template.RepoHash = repoURLHash[1]
		template.PreviewURL = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageslim"
		template.PreviewURLThumb = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageView2/2/w/436/h/232"
		template.Updated = repo["updated"].(string)
		template.Stars = int(repo["stars"].(float64))
		template.OpenIssues = int(repo["openIssues"].(float64))
		template.Size = int64(repo["size"].(float64))
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
	for _, repo := range repos {
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
	templateDirs, err := os.ReadDir(filepath.Join(util.DataDir, "templates"))
	if nil != err {
		logging.LogWarnf("read templates folder failed: %s", err)
		return
	}

	bazaarTemplates := Templates()

	for _, templateDir := range templateDirs {
		if !templateDir.IsDir() {
			continue
		}
		dirName := templateDir.Name()

		templateConf, parseErr := TemplateJSON(dirName)
		if nil != parseErr || nil == templateConf {
			continue
		}

		installPath := filepath.Join(util.DataDir, "templates", dirName)

		template := &Template{}
		template.Installed = true
		template.Name = templateConf["name"].(string)
		template.Author = templateConf["author"].(string)
		template.URL = templateConf["url"].(string)
		template.Version = templateConf["version"].(string)
		template.RepoURL = template.URL
		template.PreviewURL = "/templates/" + dirName + "/preview.png"
		template.PreviewURLThumb = "/templates/" + dirName + "/preview.png"
		info, statErr := os.Stat(filepath.Join(installPath, "README.md"))
		if nil != statErr {
			logging.LogWarnf("stat install theme README.md failed: %s", statErr)
			continue
		}
		template.HInstallDate = info.ModTime().Format("2006-01-02")
		installSize, _ := util.SizeOfDirectory(installPath)
		template.InstallSize = installSize
		template.HInstallSize = humanize.Bytes(uint64(installSize))
		readme, readErr := os.ReadFile(filepath.Join(installPath, "README.md"))
		if nil != readErr {
			logging.LogWarnf("read install template README.md failed: %s", readErr)
			continue
		}
		template.README, _ = renderREADME(template.URL, readme)
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
