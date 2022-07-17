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

type Widget struct {
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

func Widgets() (widgets []*Widget) {
	widgets = []*Widget{}
	result, err := util.GetRhyResult(false)
	if nil != err {
		return
	}

	bazaarIndex := getBazaarIndex()
	bazaarHash := result["bazaar"].(string)
	result = map[string]interface{}{}
	request := httpclient.NewBrowserRequest()
	u := util.BazaarOSSServer + "/bazaar@" + bazaarHash + "/stage/widgets.json"
	resp, err := request.SetResult(&result).Get(u)
	if nil != err {
		logging.LogErrorf("get community stage index [%s] failed: %s", u, err)
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

		widget := &Widget{}
		innerU := util.BazaarOSSServer + "/package/" + repoURL + "/widget.json"
		innerResp, innerErr := httpclient.NewBrowserRequest().SetResult(widget).Get(innerU)
		if nil != innerErr {
			logging.LogErrorf("get bazaar package [%s] failed: %s", repoURL, innerErr)
			return
		}
		if 200 != innerResp.StatusCode {
			logging.LogErrorf("get bazaar package [%s] failed: %d", innerU, innerResp.StatusCode)
			return
		}

		repoURLHash := strings.Split(repoURL, "@")
		widget.RepoURL = "https://github.com/" + repoURLHash[0]
		widget.RepoHash = repoURLHash[1]
		widget.PreviewURL = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageslim"
		widget.PreviewURLThumb = util.BazaarOSSServer + "/package/" + repoURL + "/preview.png?imageView2/2/w/436/h/232"
		widget.Updated = repo["updated"].(string)
		widget.Stars = int(repo["stars"].(float64))
		widget.OpenIssues = int(repo["openIssues"].(float64))
		widget.Size = int64(repo["size"].(float64))
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
	for _, repo := range repos {
		waitGroup.Add(1)
		p.Invoke(repo)
	}
	waitGroup.Wait()
	p.Release()

	sort.Slice(widgets, func(i, j int) bool { return widgets[i].Updated > widgets[j].Updated })
	return
}

func InstallWidget(repoURL, repoHash, installPath string, chinaCDN bool, systemID string) error {
	repoURLHash := repoURL + "@" + repoHash
	data, err := downloadPackage(repoURLHash, chinaCDN, true, systemID)
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
