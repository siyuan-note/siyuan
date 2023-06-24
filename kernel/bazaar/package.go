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
	"bytes"
	"errors"
	"golang.org/x/mod/semver"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/araddon/dateparse"
	"github.com/imroc/req/v3"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	textUnicode "golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

type DisplayName struct {
	Default string `json:"default"`
	ZhCN    string `json:"zh_CN"`
	EnUS    string `json:"en_US"`
}

type Description struct {
	Default string `json:"default"`
	ZhCN    string `json:"zh_CN"`
	EnUS    string `json:"en_US"`
}

type Readme struct {
	Default string `json:"default"`
	ZhCN    string `json:"zh_CN"`
	EnUS    string `json:"en_US"`
}

type Funding struct {
	OpenCollective string   `json:"openCollective"`
	Patreon        string   `json:"patreon"`
	GitHub         string   `json:"github"`
	Custom         []string `json:"custom"`
}

type Package struct {
	Author        string       `json:"author"`
	URL           string       `json:"url"`
	Version       string       `json:"version"`
	MinAppVersion string       `json:"minAppVersion"`
	Backends      []string     `json:"backends"`
	Frontends     []string     `json:"frontends"`
	DisplayName   *DisplayName `json:"displayName"`
	Description   *Description `json:"description"`
	Readme        *Readme      `json:"readme"`
	Funding       *Funding     `json:"funding"`

	PreferredFunding string `json:"preferredFunding"`
	PreferredName    string `json:"preferredName"`
	PreferredDesc    string `json:"preferredDesc"`
	PreferredReadme  string `json:"preferredReadme"`

	Name            string `json:"name"`
	RepoURL         string `json:"repoURL"`
	RepoHash        string `json:"repoHash"`
	PreviewURL      string `json:"previewURL"`
	PreviewURLThumb string `json:"previewURLThumb"`
	IconURL         string `json:"iconURL"`

	Installed    bool   `json:"installed"`
	Outdated     bool   `json:"outdated"`
	Current      bool   `json:"current"`
	Updated      string `json:"updated"`
	Stars        int    `json:"stars"`
	OpenIssues   int    `json:"openIssues"`
	Size         int64  `json:"size"`
	HSize        string `json:"hSize"`
	InstallSize  int64  `json:"installSize"`
	HInstallSize string `json:"hInstallSize"`
	HInstallDate string `json:"hInstallDate"`
	HUpdated     string `json:"hUpdated"`
	Downloads    int    `json:"downloads"`

	Incompatible bool `json:"incompatible"`
}

type StagePackage struct {
	Author      string       `json:"author"`
	URL         string       `json:"url"`
	Version     string       `json:"version"`
	Description *Description `json:"description"`
	Readme      *Readme      `json:"readme"`
	I18N        []string     `json:"i18n"`
	Funding     *Funding     `json:"funding"`
}

type StageRepo struct {
	URL        string `json:"url"`
	Updated    string `json:"updated"`
	Stars      int    `json:"stars"`
	OpenIssues int    `json:"openIssues"`
	Size       int64  `json:"size"`

	Package *StagePackage `json:"package"`
}

type StageIndex struct {
	Repos []*StageRepo `json:"repos"`
}

func getPreferredReadme(readme *Readme) string {
	if nil == readme {
		return "README.md"
	}

	ret := readme.Default
	switch util.Lang {
	case "zh_CN":
		if "" != readme.ZhCN {
			ret = readme.ZhCN
		}
	case "zh_CHT":
		if "" != readme.ZhCN {
			ret = readme.ZhCN
		}
	case "en_US":
		if "" != readme.EnUS {
			ret = readme.EnUS
		}
	default:
		if "" != readme.EnUS {
			ret = readme.EnUS
		}
	}
	return ret
}

func getPreferredName(pkg *Package) string {
	if nil == pkg.DisplayName {
		return pkg.Name
	}

	ret := pkg.DisplayName.Default
	switch util.Lang {
	case "zh_CN":
		if "" != pkg.DisplayName.ZhCN {
			ret = pkg.DisplayName.ZhCN
		}
	case "zh_CHT":
		if "" != pkg.DisplayName.ZhCN {
			ret = pkg.DisplayName.ZhCN
		}
	case "en_US":
		if "" != pkg.DisplayName.EnUS {
			ret = pkg.DisplayName.EnUS
		}
	default:
		if "" != pkg.DisplayName.EnUS {
			ret = pkg.DisplayName.EnUS
		}
	}
	return ret
}

func getPreferredDesc(desc *Description) string {
	if nil == desc {
		return ""
	}

	ret := desc.Default
	switch util.Lang {
	case "zh_CN":
		if "" != desc.ZhCN {
			ret = desc.ZhCN
		}
	case "zh_CHT":
		if "" != desc.ZhCN {
			ret = desc.ZhCN
		}
	case "en_US":
		if "" != desc.EnUS {
			ret = desc.EnUS
		}
	default:
		if "" != desc.EnUS {
			ret = desc.EnUS
		}
	}
	return ret
}

func getPreferredFunding(funding *Funding) string {
	if nil == funding {
		return ""
	}

	if "" != funding.OpenCollective {
		return "https://opencollective.com/" + funding.OpenCollective
	}
	if "" != funding.Patreon {
		return "https://www.patreon.com/" + funding.Patreon
	}
	if "" != funding.GitHub {
		return "https://github.com/sponsors/" + funding.GitHub
	}
	if 0 < len(funding.Custom) {
		return funding.Custom[0]
	}
	return ""
}

func PluginJSON(pluginDirName string) (ret *Plugin, err error) {
	p := filepath.Join(util.DataDir, "plugins", pluginDirName, "plugin.json")
	if !gulu.File.IsExist(p) {
		err = os.ErrNotExist
		return
	}
	data, err := os.ReadFile(p)
	if nil != err {
		logging.LogErrorf("read plugin.json [%s] failed: %s", p, err)
		return
	}
	if err = gulu.JSON.UnmarshalJSON(data, &ret); nil != err {
		logging.LogErrorf("parse plugin.json [%s] failed: %s", p, err)
		return
	}

	ret.URL = strings.TrimSuffix(ret.URL, "/")
	return
}

func WidgetJSON(widgetDirName string) (ret *Widget, err error) {
	p := filepath.Join(util.DataDir, "widgets", widgetDirName, "widget.json")
	if !gulu.File.IsExist(p) {
		err = os.ErrNotExist
		return
	}
	data, err := os.ReadFile(p)
	if nil != err {
		logging.LogErrorf("read widget.json [%s] failed: %s", p, err)
		return
	}
	if err = gulu.JSON.UnmarshalJSON(data, &ret); nil != err {
		logging.LogErrorf("parse widget.json [%s] failed: %s", p, err)
		return
	}

	ret.URL = strings.TrimSuffix(ret.URL, "/")
	return
}

func IconJSON(iconDirName string) (ret *Icon, err error) {
	p := filepath.Join(util.IconsPath, iconDirName, "icon.json")
	if !gulu.File.IsExist(p) {
		err = os.ErrNotExist
		return
	}
	data, err := os.ReadFile(p)
	if nil != err {
		logging.LogErrorf("read icon.json [%s] failed: %s", p, err)
		return
	}
	if err = gulu.JSON.UnmarshalJSON(data, &ret); nil != err {
		logging.LogErrorf("parse icon.json [%s] failed: %s", p, err)
		return
	}

	ret.URL = strings.TrimSuffix(ret.URL, "/")
	return
}

func TemplateJSON(templateDirName string) (ret *Template, err error) {
	p := filepath.Join(util.DataDir, "templates", templateDirName, "template.json")
	if !gulu.File.IsExist(p) {
		err = os.ErrNotExist
		return
	}
	data, err := os.ReadFile(p)
	if nil != err {
		logging.LogErrorf("read template.json [%s] failed: %s", p, err)
		return
	}
	if err = gulu.JSON.UnmarshalJSON(data, &ret); nil != err {
		logging.LogErrorf("parse template.json [%s] failed: %s", p, err)
		return
	}

	ret.URL = strings.TrimSuffix(ret.URL, "/")
	return
}

func ThemeJSON(themeDirName string) (ret *Theme, err error) {
	p := filepath.Join(util.ThemesPath, themeDirName, "theme.json")
	if !gulu.File.IsExist(p) {
		err = os.ErrNotExist
		return
	}
	data, err := os.ReadFile(p)
	if nil != err {
		logging.LogErrorf("read theme.json [%s] failed: %s", p, err)
		return
	}

	ret = &Theme{}
	if err = gulu.JSON.UnmarshalJSON(data, &ret); nil != err {
		logging.LogErrorf("parse theme.json [%s] failed: %s", p, err)
		return
	}

	ret.URL = strings.TrimSuffix(ret.URL, "/")
	return
}

var cachedStageIndex = map[string]*StageIndex{}
var stageIndexCacheTime int64
var stageIndexLock = sync.Mutex{}

func getStageIndex(pkgType string) (ret *StageIndex, err error) {
	rhyRet, err := util.GetRhyResult(false)
	if nil != err {
		return
	}

	stageIndexLock.Lock()
	defer stageIndexLock.Unlock()

	now := time.Now().Unix()
	if 3600 >= now-stageIndexCacheTime && nil != cachedStageIndex[pkgType] {
		ret = cachedStageIndex[pkgType]
		return
	}

	bazaarHash := rhyRet["bazaar"].(string)
	ret = &StageIndex{}
	request := httpclient.NewBrowserRequest()
	u := util.BazaarOSSServer + "/bazaar@" + bazaarHash + "/stage/" + pkgType + ".json"
	resp, reqErr := request.SetSuccessResult(ret).Get(u)
	if nil != reqErr {
		logging.LogErrorf("get community stage index [%s] failed: %s", u, reqErr)
		return
	}
	if 200 != resp.StatusCode {
		logging.LogErrorf("get community stage index [%s] failed: %d", u, resp.StatusCode)
		return
	}

	stageIndexCacheTime = now
	cachedStageIndex[pkgType] = ret
	return
}

func isOutdatedTheme(theme *Theme, bazaarThemes []*Theme) bool {
	if !strings.HasPrefix(theme.URL, "https://github.com/") {
		return false
	}

	repo := strings.TrimPrefix(theme.URL, "https://github.com/")
	parts := strings.Split(repo, "/")
	if 2 != len(parts) || "" == strings.TrimSpace(parts[1]) {
		return false
	}

	for _, pkg := range bazaarThemes {
		if theme.URL == pkg.URL && theme.Name == pkg.Name && theme.Author == pkg.Author && theme.Version < pkg.Version {
			theme.RepoHash = pkg.RepoHash
			return true
		}
	}
	return false
}

func isOutdatedIcon(icon *Icon, bazaarIcons []*Icon) bool {
	if !strings.HasPrefix(icon.URL, "https://github.com/") {
		return false
	}

	repo := strings.TrimPrefix(icon.URL, "https://github.com/")
	parts := strings.Split(repo, "/")
	if 2 != len(parts) || "" == strings.TrimSpace(parts[1]) {
		return false
	}

	for _, pkg := range bazaarIcons {
		if icon.URL == pkg.URL && icon.Name == pkg.Name && icon.Author == pkg.Author && icon.Version < pkg.Version {
			icon.RepoHash = pkg.RepoHash
			return true
		}
	}
	return false
}

func isOutdatedPlugin(plugin *Plugin, bazaarPlugins []*Plugin) bool {
	if !strings.HasPrefix(plugin.URL, "https://github.com/") {
		return false
	}

	repo := strings.TrimPrefix(plugin.URL, "https://github.com/")
	parts := strings.Split(repo, "/")
	if 2 != len(parts) || "" == strings.TrimSpace(parts[1]) {
		return false
	}

	for _, pkg := range bazaarPlugins {
		if plugin.URL == pkg.URL && plugin.Name == pkg.Name && plugin.Author == pkg.Author && plugin.Version < pkg.Version {
			plugin.RepoHash = pkg.RepoHash
			return true
		}
	}
	return false
}

func isOutdatedWidget(widget *Widget, bazaarWidgets []*Widget) bool {
	if !strings.HasPrefix(widget.URL, "https://github.com/") {
		return false
	}

	repo := strings.TrimPrefix(widget.URL, "https://github.com/")
	parts := strings.Split(repo, "/")
	if 2 != len(parts) || "" == strings.TrimSpace(parts[1]) {
		return false
	}

	for _, pkg := range bazaarWidgets {
		if widget.URL == pkg.URL && widget.Name == pkg.Name && widget.Author == pkg.Author && widget.Version < pkg.Version {
			widget.RepoHash = pkg.RepoHash
			return true
		}
	}
	return false
}

func isOutdatedTemplate(template *Template, bazaarTemplates []*Template) bool {
	if !strings.HasPrefix(template.URL, "https://github.com/") {
		return false
	}

	repo := strings.TrimPrefix(template.URL, "https://github.com/")
	parts := strings.Split(repo, "/")
	if 2 != len(parts) || "" == strings.TrimSpace(parts[1]) {
		return false
	}

	for _, pkg := range bazaarTemplates {
		if template.URL == pkg.URL && template.Name == pkg.Name && template.Author == pkg.Author && template.Version < pkg.Version {
			template.RepoHash = pkg.RepoHash
			return true
		}
	}
	return false
}

func GetPackageREADME(repoURL, repoHash, packageType string) (ret string) {
	repoURLHash := repoURL + "@" + repoHash

	stageIndex := cachedStageIndex[packageType]
	if nil == stageIndex {
		return
	}

	url := strings.TrimPrefix(repoURLHash, "https://github.com/")
	var repo *StageRepo
	for _, r := range stageIndex.Repos {
		if r.URL == url {
			repo = r
			break
		}
	}
	if nil == repo {
		return
	}

	readme := getPreferredReadme(repo.Package.Readme)

	data, err := downloadPackage(repoURLHash+"/"+readme, false, "")
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

	ret, err = renderREADME(repoURL, data)
	return
}

func renderREADME(repoURL string, mdData []byte) (ret string, err error) {
	luteEngine := lute.New()
	luteEngine.SetSoftBreak2HardBreak(false)
	luteEngine.SetCodeSyntaxHighlight(false)
	linkBase := "https://cdn.jsdelivr.net/gh/" + strings.TrimPrefix(repoURL, "https://github.com/")
	luteEngine.SetLinkBase(linkBase)
	ret = luteEngine.Md2HTML(string(mdData))
	ret = util.LinkTarget(ret, linkBase)
	return
}

func downloadPackage(repoURLHash string, pushProgress bool, systemID string) (data []byte, err error) {
	// repoURLHash: https://github.com/88250/Comfortably-Numb@6286912c381ef3f83e455d06ba4d369c498238dc
	pushID := repoURLHash[:strings.LastIndex(repoURLHash, "@")]
	repoURLHash = strings.TrimPrefix(repoURLHash, "https://github.com/")
	u := util.BazaarOSSServer + "/package/" + repoURLHash
	buf := &bytes.Buffer{}
	resp, err := httpclient.NewBrowserRequest().SetOutput(buf).SetDownloadCallback(func(info req.DownloadInfo) {
		if pushProgress {
			progress := float32(info.DownloadedSize) / float32(info.Response.ContentLength)
			//logging.LogDebugf("downloading bazaar package [%f]", progress)
			util.PushDownloadProgress(pushID, progress)
		}
	}).Get(u)
	if nil != err {
		logging.LogErrorf("get bazaar package [%s] failed: %s", u, err)
		return nil, errors.New("get bazaar package failed, please check your network")
	}
	if 200 != resp.StatusCode {
		logging.LogErrorf("get bazaar package [%s] failed: %d", u, resp.StatusCode)
		return nil, errors.New("get bazaar package failed: " + resp.Status)
	}
	data = buf.Bytes()

	go incPackageDownloads(repoURLHash, systemID)
	return
}

func incPackageDownloads(repoURLHash, systemID string) {
	if strings.Contains(repoURLHash, ".md") || "" == systemID {
		return
	}

	repo := strings.Split(repoURLHash, "@")[0]
	u := util.GetCloudServer() + "/apis/siyuan/bazaar/addBazaarPackageDownloadCount"
	httpclient.NewCloudRequest30s().SetBody(
		map[string]interface{}{
			"systemID": systemID,
			"repo":     repo,
		}).Post(u)
}

func installPackage(data []byte, installPath string) (err error) {
	tmpPackage := filepath.Join(util.TempDir, "bazaar", "package")
	if err = os.MkdirAll(tmpPackage, 0755); nil != err {
		return
	}
	name := gulu.Rand.String(7)
	tmp := filepath.Join(tmpPackage, name+".zip")
	if err = os.WriteFile(tmp, data, 0644); nil != err {
		return
	}

	unzipPath := filepath.Join(tmpPackage, name)
	if err = gulu.Zip.Unzip(tmp, unzipPath); nil != err {
		logging.LogErrorf("write file [%s] failed: %s", installPath, err)
		return
	}

	dirs, err := os.ReadDir(unzipPath)
	if nil != err {
		return
	}

	srcPath := unzipPath
	if 1 == len(dirs) && dirs[0].IsDir() {
		srcPath = filepath.Join(unzipPath, dirs[0].Name())
	}

	if err = filelock.Copy(srcPath, installPath); nil != err {
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
	resp, reqErr := request.SetSuccessResult(&cachedBazaarIndex).Get(u)
	if nil != reqErr {
		logging.LogErrorf("get bazaar index [%s] failed: %s", u, reqErr)
		return cachedBazaarIndex
	}
	if 200 != resp.StatusCode {
		logging.LogErrorf("get bazaar index [%s] failed: %d", u, resp.StatusCode)
		return cachedBazaarIndex
	}
	bazaarIndexCacheTime = now
	return cachedBazaarIndex
}

// defaultMinAppVersion 如果集市包中缺失 minAppVersion 项，则使用该值作为最低支持的版本号，小于该版本号时不显示集市包
// Add marketplace package config item `minAppVersion` https://github.com/siyuan-note/siyuan/issues/8330
const defaultMinAppVersion = "2.9.0"

func disallowDisplayBazaarPackage(pkg *Package) bool {
	if "" == pkg.MinAppVersion { // 目前暂时放过所有不带 minAppVersion 的集市包，后续版本会使用 defaultMinAppVersion
		return false
	}
	if 0 < semver.Compare("v"+pkg.MinAppVersion, "v"+util.Ver) {
		return true
	}

	if 0 < len(pkg.Backends) {

	}

	return false
}
