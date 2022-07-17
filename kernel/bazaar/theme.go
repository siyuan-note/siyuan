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
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type Theme struct {
	Author  string   `json:"author"`
	URL     string   `json:"url"`
	Version string   `json:"version"`
	Modes   []string `json:"modes"`

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

func Themes() (ret []*Theme) {
	ret = []*Theme{}
	result, err := util.GetRhyResult(false)
	if nil != err {
		return
	}

	bazaarIndex := getBazaarIndex()
	bazaarHash := result["bazaar"].(string)
	result = map[string]interface{}{}
	request := httpclient.NewBrowserRequest()
	u := util.BazaarOSSServer + "/bazaar@" + bazaarHash + "/stage/themes.json"
	resp, reqErr := request.SetResult(&result).Get(u)
	if nil != reqErr {
		logging.LogErrorf("get community stage index [%s] failed: %s", u, reqErr)
		return
	}
	if 200 != resp.StatusCode {
		logging.LogErrorf("get community stage index [%s] failed: %d", u, resp.StatusCode)
		return
	}

	repos := result["repos"].([]interface{})
	waitGroup := &sync.WaitGroup{}
	lock := &sync.Mutex{}
	p, _ := ants.NewPoolWithFunc(8, func(arg interface{}) {
		defer waitGroup.Done()

		repo := arg.(map[string]interface{})
		repoURL := repo["url"].(string)

		theme := &Theme{}
		innerU := util.BazaarOSSServer + "/package/" + repoURL + "/theme.json"
		innerResp, innerErr := httpclient.NewBrowserRequest().SetResult(theme).Get(innerU)
		if nil != innerErr {
			logging.LogErrorf("get bazaar package [%s] failed: %s", innerU, innerErr)
			return
		}
		if 200 != innerResp.StatusCode {
			logging.LogErrorf("get bazaar package [%s] failed: %d", innerU, resp.StatusCode)
			return
		}

		repoURLHash := strings.Split(repoURL, "@")
		theme.RepoURL = "https://github.com/" + repoURLHash[0]
		theme.RepoHash = repoURLHash[1]
		theme.PreviewURL = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageslim"
		theme.PreviewURLThumb = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageView2/2/w/436/h/232"
		theme.Updated = repo["updated"].(string)
		theme.Stars = int(repo["stars"].(float64))
		theme.OpenIssues = int(repo["openIssues"].(float64))
		theme.Size = int64(repo["size"].(float64))
		theme.HSize = humanize.Bytes(uint64(theme.Size))
		theme.HUpdated = formatUpdated(theme.Updated)
		pkg := bazaarIndex[strings.Split(repoURL, "@")[0]]
		if nil != pkg {
			theme.Downloads = pkg.Downloads
		}
		lock.Lock()
		ret = append(ret, theme)
		lock.Unlock()
	})
	for _, repo := range repos {
		waitGroup.Add(1)
		p.Invoke(repo)
	}
	waitGroup.Wait()
	p.Release()

	sort.Slice(ret, func(i, j int) bool { return ret[i].Updated > ret[j].Updated })
	return
}

func InstallTheme(repoURL, repoHash, installPath string, chinaCDN bool, systemID string) error {
	repoURLHash := repoURL + "@" + repoHash
	data, err := downloadPackage(repoURLHash, chinaCDN, true, systemID)
	if nil != err {
		return err
	}
	return installPackage(data, installPath)
}

func UninstallTheme(installPath string) error {
	if err := os.RemoveAll(installPath); nil != err {
		logging.LogErrorf("remove theme [%s] failed: %s", installPath, err)
		return errors.New("remove community theme failed")
	}
	//logging.Logger.Infof("uninstalled theme [%s]", installPath)
	return nil
}
