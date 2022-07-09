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
	"sort"
	"strings"
	"sync"

	"github.com/dustin/go-humanize"
	ants "github.com/panjf2000/ants/v2"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type Icon struct {
	Author  string `json:"author"`
	URL     string `json:"url"`
	Version string `json:"version"`

	Name            string `json:"name"`
	RepoURL         string `json:"repoURL"`
	RepoHash        string `json:"repoHash"`
	PreviewURL      string `json:"previewURL"`
	PreviewURLThumb string `json:"previewURLThumb"`

	README string `json:"readme"`

	Installed  bool   `json:"installed"`
	Outdated   bool   `json:"outdated"`
	Current    bool   `json:"current"`
	Updated    string `json:"updated"`
	Stars      int    `json:"stars"`
	OpenIssues int    `json:"openIssues"`
	Size       int64  `json:"size"`
	HSize      string `json:"hSize"`
	HUpdated   string `json:"hUpdated"`
	Downloads  int    `json:"downloads"`
}

func Icons() (icons []*Icon) {
	icons = []*Icon{}
	result, err := util.GetRhyResult(false)
	if nil != err {
		return
	}

	bazaarIndex := getBazaarIndex()
	bazaarHash := result["bazaar"].(string)
	result = map[string]interface{}{}
	request := httpclient.NewBrowserRequest()
	u := util.BazaarOSSServer + "/bazaar@" + bazaarHash + "/stage/icons.json"
	resp, err := request.SetResult(&result).Get(u)
	if nil != err {
		util.LogErrorf("get community stage index [%s] failed: %s", u, err)
		return
	}
	if 200 != resp.StatusCode {
		util.LogErrorf("get community stage index [%s] failed: %d", u, resp.StatusCode)
		return
	}
	repos := result["repos"].([]interface{})
	waitGroup := &sync.WaitGroup{}
	lock := &sync.Mutex{}
	p, _ := ants.NewPoolWithFunc(2, func(arg interface{}) {
		defer waitGroup.Done()

		repo := arg.(map[string]interface{})
		repoURL := repo["url"].(string)

		icon := &Icon{}
		innerU := util.BazaarOSSServer + "/package/" + repoURL + "/icon.json"
		innerResp, innerErr := httpclient.NewBrowserRequest().SetResult(icon).Get(innerU)
		if nil != innerErr {
			util.LogErrorf("get bazaar package [%s] failed: %s", repoURL, innerErr)
			return
		}
		if 200 != innerResp.StatusCode {
			util.LogErrorf("get bazaar package [%s] failed: %d", innerU, innerResp.StatusCode)
			return
		}

		repoURLHash := strings.Split(repoURL, "@")
		icon.RepoURL = "https://github.com/" + repoURLHash[0]
		icon.RepoHash = repoURLHash[1]
		icon.PreviewURL = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageslim"
		icon.PreviewURLThumb = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageView2/2/w/436/h/232"
		icon.Updated = repo["updated"].(string)
		icon.Stars = int(repo["stars"].(float64))
		icon.OpenIssues = int(repo["openIssues"].(float64))
		icon.Size = int64(repo["size"].(float64))
		icon.HSize = humanize.Bytes(uint64(icon.Size))
		icon.HUpdated = formatUpdated(icon.Updated)
		pkg := bazaarIndex[strings.Split(repoURL, "@")[0]]
		if nil != pkg {
			icon.Downloads = pkg.Downloads
		}
		lock.Lock()
		icons = append(icons, icon)
		lock.Unlock()
	})
	for _, repo := range repos {
		waitGroup.Add(1)
		p.Invoke(repo)
	}
	waitGroup.Wait()
	p.Release()

	sort.Slice(icons, func(i, j int) bool { return icons[i].Updated > icons[j].Updated })
	return
}

func InstallIcon(repoURL, repoHash, installPath string, chinaCDN bool, systemID string) error {
	repoURLHash := repoURL + "@" + repoHash
	data, err := downloadPackage(repoURLHash, chinaCDN, true, systemID)
	if nil != err {
		return err
	}
	return installPackage(data, installPath)
}

func UninstallIcon(installPath string) error {
	if err := os.RemoveAll(installPath); nil != err {
		util.LogErrorf("remove icon [%s] failed: %s", installPath, err)
		return errors.New("remove community icon failed")
	}
	//util.Logger.Infof("uninstalled icon [%s]", installPath)
	return nil
}
