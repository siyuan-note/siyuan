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
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/araddon/dateparse"
	"github.com/imroc/req/v3"
	gcache "github.com/patrickmn/go-cache"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/mod/semver"
	textUnicode "golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

// LocaleStrings 表示按语种 key 的字符串表，key 为语种如 "default"、"en_US"、"zh_CN" 等
type LocaleStrings map[string]string

type Funding struct {
	OpenCollective string   `json:"openCollective"`
	Patreon        string   `json:"patreon"`
	GitHub         string   `json:"github"`
	Custom         []string `json:"custom"`
}

type Package struct {
	Author            string        `json:"author"`
	URL               string        `json:"url"`
	Version           string        `json:"version"`
	MinAppVersion     string        `json:"minAppVersion"`
	DisabledInPublish bool          `json:"disabledInPublish"`
	Backends          []string      `json:"backends"`
	Frontends         []string      `json:"frontends"`
	DisplayName       LocaleStrings `json:"displayName"`
	Description       LocaleStrings `json:"description"`
	Readme            LocaleStrings `json:"readme"`
	Funding           *Funding      `json:"funding"`
	Keywords          []string      `json:"keywords"`

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

	Installed               bool   `json:"installed"`
	Outdated                bool   `json:"outdated"`
	Current                 bool   `json:"current"`
	Updated                 string `json:"updated"`
	Stars                   int    `json:"stars"`
	OpenIssues              int    `json:"openIssues"`
	Size                    int64  `json:"size"`
	HSize                   string `json:"hSize"`
	InstallSize             int64  `json:"installSize"`
	HInstallSize            string `json:"hInstallSize"`
	HInstallDate            string `json:"hInstallDate"`
	HUpdated                string `json:"hUpdated"`
	Downloads               int    `json:"downloads"`
	DisallowInstall         bool   `json:"disallowInstall"`
	DisallowUpdate          bool   `json:"disallowUpdate"`
	UpdateRequiredMinAppVer string `json:"updateRequiredMinAppVer"`

	Incompatible bool `json:"incompatible"`
}

type StagePackage struct {
	Author      string        `json:"author"`
	URL         string        `json:"url"`
	Version     string        `json:"version"`
	Description LocaleStrings `json:"description"`
	Readme      LocaleStrings `json:"readme"`
	I18N        []string      `json:"i18n"`
	Funding     *Funding      `json:"funding"`
}

type StageRepo struct {
	URL         string `json:"url"`
	Updated     string `json:"updated"`
	Stars       int    `json:"stars"`
	OpenIssues  int    `json:"openIssues"`
	Size        int64  `json:"size"`
	InstallSize int64  `json:"installSize"`

	Package *StagePackage `json:"package"`
}

type StageIndex struct {
	Repos []*StageRepo `json:"repos"`
}

// getPreferredLocaleString 从 LocaleStrings 中按当前语种取值，无则回退 default、en_US，再回退 fallback。
func getPreferredLocaleString(m LocaleStrings, fallback string) string {
	if len(m) == 0 {
		return fallback
	}
	if v := strings.TrimSpace(m[util.Lang]); "" != v {
		return v
	}
	if v := strings.TrimSpace(m["default"]); "" != v {
		return v
	}
	if v := strings.TrimSpace(m["en_US"]); "" != v {
		return v
	}
	return fallback
}

func GetPreferredName(pkg *Package) string {
	return getPreferredLocaleString(pkg.DisplayName, pkg.Name)
}

func getPreferredDesc(desc LocaleStrings) string {
	return getPreferredLocaleString(desc, "")
}

func getPreferredReadme(readme LocaleStrings) string {
	return getPreferredLocaleString(readme, "README.md")
}

func getPreferredFunding(funding *Funding) string {
	if nil == funding {
		return ""
	}

	if "" != funding.OpenCollective {
		if strings.HasPrefix(funding.OpenCollective, "http://") || strings.HasPrefix(funding.OpenCollective, "https://") {
			return funding.OpenCollective
		}
		return "https://opencollective.com/" + funding.OpenCollective
	}
	if "" != funding.Patreon {
		if strings.HasPrefix(funding.Patreon, "http://") || strings.HasPrefix(funding.Patreon, "https://") {
			return funding.Patreon
		}
		return "https://www.patreon.com/" + funding.Patreon
	}
	if "" != funding.GitHub {
		if strings.HasPrefix(funding.GitHub, "http://") || strings.HasPrefix(funding.GitHub, "https://") {
			return funding.GitHub
		}
		return "https://github.com/sponsors/" + funding.GitHub
	}
	if 0 < len(funding.Custom) {
		return funding.Custom[0]
	}
	return ""
}

func PluginJSON(pluginDirName string) (ret *Plugin, err error) {
	p := filepath.Join(util.DataDir, "plugins", pluginDirName, "plugin.json")
	if !filelock.IsExist(p) {
		err = os.ErrNotExist
		return
	}
	data, err := filelock.ReadFile(p)
	if err != nil {
		logging.LogErrorf("read plugin.json [%s] failed: %s", p, err)
		return
	}
	if err = gulu.JSON.UnmarshalJSON(data, &ret); err != nil {
		logging.LogErrorf("parse plugin.json [%s] failed: %s", p, err)
		return
	}

	ret.URL = strings.TrimSuffix(ret.URL, "/")
	return
}

func WidgetJSON(widgetDirName string) (ret *Widget, err error) {
	p := filepath.Join(util.DataDir, "widgets", widgetDirName, "widget.json")
	if !filelock.IsExist(p) {
		err = os.ErrNotExist
		return
	}
	data, err := filelock.ReadFile(p)
	if err != nil {
		logging.LogErrorf("read widget.json [%s] failed: %s", p, err)
		return
	}
	if err = gulu.JSON.UnmarshalJSON(data, &ret); err != nil {
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
	if err != nil {
		logging.LogErrorf("read icon.json [%s] failed: %s", p, err)
		return
	}
	if err = gulu.JSON.UnmarshalJSON(data, &ret); err != nil {
		logging.LogErrorf("parse icon.json [%s] failed: %s", p, err)
		return
	}

	ret.URL = strings.TrimSuffix(ret.URL, "/")
	return
}

func TemplateJSON(templateDirName string) (ret *Template, err error) {
	p := filepath.Join(util.DataDir, "templates", templateDirName, "template.json")
	if !filelock.IsExist(p) {
		err = os.ErrNotExist
		return
	}
	data, err := filelock.ReadFile(p)
	if err != nil {
		logging.LogErrorf("read template.json [%s] failed: %s", p, err)
		return
	}
	if err = gulu.JSON.UnmarshalJSON(data, &ret); err != nil {
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
	if err != nil {
		logging.LogErrorf("read theme.json [%s] failed: %s", p, err)
		return
	}

	ret = &Theme{}
	if err = gulu.JSON.UnmarshalJSON(data, &ret); err != nil {
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
	if err != nil {
		return
	}

	stageIndexLock.Lock()
	defer stageIndexLock.Unlock()

	now := time.Now().Unix()
	if util.RhyCacheDuration >= now-stageIndexCacheTime && nil != cachedStageIndex[pkgType] {
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
		if theme.Name == pkg.Name && 0 > semver.Compare("v"+theme.Version, "v"+pkg.Version) {
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
		if icon.Name == pkg.Name && 0 > semver.Compare("v"+icon.Version, "v"+pkg.Version) {
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
		if plugin.Name == pkg.Name && 0 > semver.Compare("v"+plugin.Version, "v"+pkg.Version) {
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
		if widget.Name == pkg.Name && 0 > semver.Compare("v"+widget.Version, "v"+pkg.Version) {
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
		if template.Name == pkg.Name && 0 > semver.Compare("v"+template.Version, "v"+pkg.Version) {
			template.RepoHash = pkg.RepoHash
			return true
		}
	}
	return false
}

func isBazzarOnline() (ret bool) {
	// Improve marketplace loading when offline https://github.com/siyuan-note/siyuan/issues/12050
	ret = util.IsOnline(util.BazaarOSSServer, true, 3000)
	if !ret {
		util.PushErrMsg(util.Langs[util.Lang][24], 5000)
	}
	return
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
	if err != nil {
		ret = fmt.Sprintf("Load bazaar package's preferred README(%s) failed: %s", readme, err.Error())
		// 回退到 Default README
		var defaultReadme string
		if len(repo.Package.Readme) > 0 {
			defaultReadme = repo.Package.Readme["default"]
		}
		if "" == strings.TrimSpace(defaultReadme) {
			defaultReadme = "README.md"
		}
		if readme != defaultReadme {
			data, err = downloadPackage(repoURLHash+"/"+defaultReadme, false, "")
			if err != nil {
				ret += fmt.Sprintf("<br>Load bazaar package's default README(%s) failed: %s", defaultReadme, err.Error())
			}
		}
		// 回退到 README.md
		if err != nil && readme != "README.md" && defaultReadme != "README.md" {
			data, err = downloadPackage(repoURLHash+"/README.md", false, "")
			if err != nil {
				ret += fmt.Sprintf("<br>Load bazaar package's README.md failed: %s", err.Error())
				return
			}
		} else if err != nil {
			return
		}
	}

	if 2 < len(data) {
		if 255 == data[0] && 254 == data[1] {
			data, _, err = transform.Bytes(textUnicode.UTF16(textUnicode.LittleEndian, textUnicode.ExpectBOM).NewDecoder(), data)
		} else if 254 == data[0] && 255 == data[1] {
			data, _, err = transform.Bytes(textUnicode.UTF16(textUnicode.BigEndian, textUnicode.ExpectBOM).NewDecoder(), data)
		}
	}

	ret, err = renderREADME(repoURL, data)
	return
}

func loadInstalledReadme(installPath, basePath string, readme LocaleStrings) (ret string) {
	readmeFilename := getPreferredReadme(readme)
	readmeData, readErr := os.ReadFile(filepath.Join(installPath, readmeFilename))
	if nil == readErr {
		ret, _ = renderLocalREADME(basePath, readmeData)
		return
	}

	logging.LogWarnf("read installed %s failed: %s", readmeFilename, readErr)
	ret = fmt.Sprintf("File %s not found", readmeFilename)
	// 回退到 Default README
	var defaultReadme string
	if len(readme) > 0 {
		defaultReadme = strings.TrimSpace(readme["default"])
	}
	if "" == defaultReadme {
		defaultReadme = "README.md"
	}
	if readmeFilename != defaultReadme {
		readmeData, readErr = os.ReadFile(filepath.Join(installPath, defaultReadme))
		if nil == readErr {
			ret, _ = renderLocalREADME(basePath, readmeData)
			return
		}
		logging.LogWarnf("read installed %s failed: %s", defaultReadme, readErr)
		ret += fmt.Sprintf("<br>File %s not found", defaultReadme)
	}
	// 回退到 README.md
	if nil != readErr && readmeFilename != "README.md" && defaultReadme != "README.md" {
		readmeData, readErr = os.ReadFile(filepath.Join(installPath, "README.md"))
		if nil == readErr {
			ret, _ = renderLocalREADME(basePath, readmeData)
			return
		}
		logging.LogWarnf("read installed README.md failed: %s", readErr)
		ret += "<br>File README.md not found"
	}
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

func renderLocalREADME(basePath string, mdData []byte) (ret string, err error) {
	luteEngine := lute.New()
	luteEngine.SetSoftBreak2HardBreak(false)
	luteEngine.SetCodeSyntaxHighlight(false)
	linkBase := basePath
	luteEngine.SetLinkBase(linkBase)
	ret = luteEngine.Md2HTML(string(mdData))
	ret = util.LinkTarget(ret, linkBase)
	return
}

var (
	packageLocks     = map[string]*sync.Mutex{}
	packageLocksLock = sync.Mutex{}
)

func downloadPackage(repoURLHash string, pushProgress bool, systemID string) (data []byte, err error) {
	packageLocksLock.Lock()
	defer packageLocksLock.Unlock()

	// repoURLHash: https://github.com/88250/Comfortably-Numb@6286912c381ef3f83e455d06ba4d369c498238dc
	repoURL := repoURLHash[:strings.LastIndex(repoURLHash, "@")]
	lock, ok := packageLocks[repoURLHash]
	if !ok {
		lock = &sync.Mutex{}
		packageLocks[repoURLHash] = lock
	}
	lock.Lock()
	defer lock.Unlock()

	repoURLHash = strings.TrimPrefix(repoURLHash, "https://github.com/")
	u := util.BazaarOSSServer + "/package/" + repoURLHash
	buf := &bytes.Buffer{}
	resp, err := httpclient.NewCloudFileRequest2m().SetOutput(buf).SetDownloadCallback(func(info req.DownloadInfo) {
		if pushProgress {
			progress := float32(info.DownloadedSize) / float32(info.Response.ContentLength)
			//logging.LogDebugf("downloading bazaar package [%f]", progress)
			util.PushDownloadProgress(repoURL, progress)
		}
	}).Get(u)
	if err != nil {
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

func uninstallPackage(installPath string) (err error) {
	if err = os.RemoveAll(installPath); err != nil {
		logging.LogErrorf("remove [%s] failed: %s", installPath, err)
		return fmt.Errorf("remove community package [%s] failed", filepath.Base(installPath))
	}
	packageCache.Flush()
	return
}

func installPackage(data []byte, installPath, repoURLHash string) (err error) {
	err = installPackage0(data, installPath)
	if err != nil {
		return
	}

	packageCache.Delete(strings.TrimPrefix(repoURLHash, "https://github.com/"))
	return
}

func installPackage0(data []byte, installPath string) (err error) {
	tmpPackage := filepath.Join(util.TempDir, "bazaar", "package")
	if err = os.MkdirAll(tmpPackage, 0755); err != nil {
		return
	}
	name := gulu.Rand.String(7)
	tmp := filepath.Join(tmpPackage, name+".zip")
	if err = os.WriteFile(tmp, data, 0644); err != nil {
		return
	}

	unzipPath := filepath.Join(tmpPackage, name)
	if err = gulu.Zip.Unzip(tmp, unzipPath); err != nil {
		logging.LogErrorf("write file [%s] failed: %s", installPath, err)
		return
	}

	dirs, err := os.ReadDir(unzipPath)
	if err != nil {
		return
	}

	srcPath := unzipPath
	if 1 == len(dirs) && dirs[0].IsDir() {
		srcPath = filepath.Join(unzipPath, dirs[0].Name())
	}

	if err = filelock.Copy(srcPath, installPath); err != nil {
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

func disallowInstallBazaarPackage(pkg *Package) bool {
	if "" == pkg.MinAppVersion {
		pkg.MinAppVersion = defaultMinAppVersion
	}

	if 0 < semver.Compare("v"+pkg.MinAppVersion, "v"+util.Ver) {
		return true
	}
	return false
}

var packageCache = gcache.New(6*time.Hour, 30*time.Minute) // [repoURL]*Package

func CleanBazaarPackageCache() {
	packageCache.Flush()
}

var packageInstallSizeCache = gcache.New(48*time.Hour, 6*time.Hour) // [repoURL]*int64
