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
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/PuerkitoBio/goquery"
	"github.com/araddon/dateparse"
	"github.com/imroc/req/v3"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/siyuan/kernel/util"
	textUnicode "golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

func GetPackageREADME(repoURL, repoHash string, chinaCDN bool, systemID string) (ret string) {
	repoURLHash := repoURL + "@" + repoHash
	data, err := downloadPackage(repoURLHash+"/README.md", chinaCDN, false, systemID)
	if nil != err {
		ret = "Load bazaar package's README.md failed: " + err.Error()
		return
	}

	if 2 < len(data) {
		if 255 == data[0] && 254 == data[1] {
			data, _, err = transform.Bytes(textUnicode.UTF16(textUnicode.LittleEndian, textUnicode.ExpectBOM).NewDecoder(), data)
		} else if 254 == data[1] && 255 == data[0] {
			data, _, err = transform.Bytes(textUnicode.UTF16(textUnicode.BigEndian, textUnicode.ExpectBOM).NewDecoder(), data)
		}
	}

	luteEngine := lute.New()
	luteEngine.SetSoftBreak2HardBreak(false)
	luteEngine.SetCodeSyntaxHighlight(false)
	linkBase := repoURL + "/blob/main/"
	luteEngine.SetLinkBase(linkBase)
	ret = luteEngine.Md2HTML(string(data))
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(ret))
	if nil != err {
		util.LogErrorf("parse HTML failed: %s", err)
		return ret
	}

	doc.Find("a").Each(func(i int, selection *goquery.Selection) {
		if href, ok := selection.Attr("href"); ok && util.IsRelativePath(href) {
			selection.SetAttr("href", linkBase+href)
		}
	})

	ret, _ = doc.Find("body").Html()
	return
}

func downloadPackage(repoURLHash string, chinaCDN, pushProgress bool, systemID string) (data []byte, err error) {
	// repoURLHash: https://github.com/88250/Comfortably-Numb@6286912c381ef3f83e455d06ba4d369c498238dc
	pushID := repoURLHash[:strings.LastIndex(repoURLHash, "@")]
	repoURLHash = strings.TrimPrefix(repoURLHash, "https://github.com/")
	u := util.BazaarOSSFileServer + "/package/" + repoURLHash
	if chinaCDN {
		u = util.BazaarOSSServer + "/package/" + repoURLHash
	}
	buf := &bytes.Buffer{}
	resp, err := httpclient.NewBrowserDownloadRequest().SetOutput(buf).SetDownloadCallback(func(info req.DownloadInfo) {
		if pushProgress {
			util.PushDownloadProgress(pushID, float32(info.DownloadedSize)/float32(info.Response.ContentLength))
		}
	}).Get(u)
	if nil != err {
		u = util.BazaarOSSServer + "/package/" + repoURLHash
		resp, err = httpclient.NewBrowserDownloadRequest().SetOutput(buf).SetDownloadCallback(func(info req.DownloadInfo) {
			if pushProgress {
				util.PushDownloadProgress(pushID, float32(info.DownloadedSize)/float32(info.Response.ContentLength))
			}
		}).Get(u)
		if nil != err {
			util.LogErrorf("get bazaar package [%s] failed: %s", u, err)
			return nil, errors.New("get bazaar package failed")
		}
	}
	if 200 != resp.StatusCode {
		util.LogErrorf("get bazaar package [%s] failed: %d", u, resp.StatusCode)
		return nil, errors.New("get bazaar package failed")
	}
	data = buf.Bytes()

	go incPackageDownloads(repoURLHash, systemID)
	return
}

func incPackageDownloads(repoURLHash, systemID string) {
	if strings.Contains(repoURLHash, ".md") {
		return
	}

	repo := strings.Split(repoURLHash, "@")[0]
	u := util.AliyunServer + "/apis/siyuan/bazaar/addBazaarPackageDownloadCount"
	httpclient.NewCloudRequest().SetBody(
		map[string]interface{}{
			"systemID": systemID,
			"repo":     repo,
		}).Post(u)
}

func installPackage(data []byte, installPath string) (err error) {
	dir := filepath.Join(util.TempDir, "bazaar", "package")
	if err = os.MkdirAll(dir, 0755); nil != err {
		return
	}
	name := gulu.Rand.String(7)
	tmp := filepath.Join(dir, name+".zip")
	if err = os.WriteFile(tmp, data, 0644); nil != err {
		return
	}

	unzipPath := filepath.Join(dir, name)
	if err = gulu.Zip.Unzip(tmp, unzipPath); nil != err {
		util.LogErrorf("write file [%s] failed: %s", installPath, err)
		err = errors.New("write file failed")
		return
	}

	dirs, err := os.ReadDir(unzipPath)
	if nil != err {
		return
	}
	for _, d := range dirs {
		if d.IsDir() && strings.Contains(d.Name(), "-") {
			dir = d.Name()
			break
		}
	}
	srcPath := filepath.Join(unzipPath, dir)
	if err = gulu.File.Copy(srcPath, installPath); nil != err {
		return
	}
	return
}

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

type bazaarPackage struct {
	Name      string `json:"name"`
	Downloads int    `json:"downloads"`
}

var cachedBazaarIndex = map[string]*bazaarPackage{}
var bazaarIndexCacheTime int64
var bazaarIndexLock = sync.Mutex{}

func getBazaarIndex() map[string]*bazaarPackage {
	bazaarIndexLock.Lock()
	defer bazaarIndexLock.Unlock()

	now := time.Now().Unix()
	if 3600 >= now-bazaarIndexCacheTime {
		return cachedBazaarIndex
	}

	request := httpclient.NewBrowserRequest()
	u := util.BazaarStatServer + "/bazaar/index.json"
	resp, reqErr := request.SetResult(&cachedBazaarIndex).Get(u)
	if nil != reqErr {
		util.LogErrorf("get bazaar index [%s] failed: %s", u, reqErr)
		return cachedBazaarIndex
	}
	if 200 != resp.StatusCode {
		util.LogErrorf("get bazaar index [%s] failed: %d", u, resp.StatusCode)
		return cachedBazaarIndex
	}
	bazaarIndexCacheTime = now
	return cachedBazaarIndex
}
