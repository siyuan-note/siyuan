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

package api

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/gin-gonic/gin"
	"github.com/jinzhu/copier"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func getNetwork(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	maskedConf, err := model.GetMaskedConf()
	if err != nil {
		ret.Code = -1
		ret.Msg = "get conf failed: " + err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"proxy": maskedConf.System.NetworkProxy,
	}
}

func getChangelog(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	data := map[string]interface{}{"show": false, "html": ""}
	ret.Data = data

	changelogsDir := filepath.Join(util.WorkingDir, "changelogs")
	if !gulu.File.IsDir(changelogsDir) {
		return
	}

	if !model.Conf.ShowChangelog {
		return
	}

	changelogPath := filepath.Join(changelogsDir, "v"+util.Ver, "v"+util.Ver+"_"+model.Conf.Lang+".md")
	if !gulu.File.IsExist(changelogPath) {
		changelogPath = filepath.Join(changelogsDir, "v"+util.Ver, "v"+util.Ver+".md")
		if !gulu.File.IsExist(changelogPath) {
			logging.LogErrorf("changelog not found: %s", changelogPath)
			return
		}
	}

	contentData, err := os.ReadFile(changelogPath)
	if err != nil {
		logging.LogErrorf("read changelog failed: %s", err)
		return
	}

	model.Conf.ShowChangelog = false
	luteEngine := lute.New()
	htmlContent := luteEngine.MarkdownStr("", string(contentData))
	htmlContent = util.LinkTarget(htmlContent, "")

	data["show"] = true
	data["html"] = htmlContent
	ret.Data = data
}

func getEmojiConf(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	builtConfPath := filepath.Join(util.AppearancePath, "emojis", "conf.json")
	data, err := os.ReadFile(builtConfPath)
	if err != nil {
		logging.LogErrorf("read emojis conf.json failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	var conf []map[string]interface{}
	if err = gulu.JSON.UnmarshalJSON(data, &conf); err != nil {
		logging.LogErrorf("unmarshal emojis conf.json failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	customConfDir := filepath.Join(util.DataDir, "emojis")
	custom := map[string]interface{}{
		"id":          "custom",
		"title":       "Custom",
		"title_zh_cn": "自定义",
		"title_ja_jp": "カスタム",
	}
	items := []map[string]interface{}{}
	custom["items"] = items
	if gulu.File.IsDir(customConfDir) {
		model.CustomEmojis = sync.Map{}
		customEmojis, err := os.ReadDir(customConfDir)
		if err != nil {
			logging.LogErrorf("read custom emojis failed: %s", err)
		} else {
			for _, customEmoji := range customEmojis {
				name := customEmoji.Name()
				if strings.HasPrefix(name, ".") {
					continue
				}

				if customEmoji.IsDir() {
					// 子级
					subCustomEmojis, err := os.ReadDir(filepath.Join(customConfDir, name))
					if err != nil {
						logging.LogErrorf("read custom emojis failed: %s", err)
						continue
					}

					for _, subCustomEmoji := range subCustomEmojis {
						if subCustomEmoji.IsDir() {
							continue
						}

						name = subCustomEmoji.Name()
						if strings.HasPrefix(name, ".") {
							continue
						}

						addCustomEmoji(customEmoji.Name()+"/"+name, &items)
					}
					continue
				}

				addCustomEmoji(name, &items)
			}
		}
	}
	custom["items"] = items
	conf = append([]map[string]interface{}{custom}, conf...)

	ret.Data = conf
	return
}

func addCustomEmoji(name string, items *[]map[string]interface{}) {
	ext := filepath.Ext(name)
	nameWithoutExt := strings.TrimSuffix(name, ext)
	emoji := map[string]interface{}{
		"unicode":           name,
		"description":       nameWithoutExt,
		"description_zh_cn": nameWithoutExt,
		"description_ja_jp": nameWithoutExt,
		"keywords":          nameWithoutExt,
	}
	*items = append(*items, emoji)

	imgSrc := "/emojis/" + name
	model.CustomEmojis.Store(nameWithoutExt, imgSrc)
}

func checkUpdate(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	showMsg := arg["showMsg"].(bool)
	model.CheckUpdate(showMsg)
}

func exportLog(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	zipPath := model.ExportSystemLog()
	ret.Data = map[string]interface{}{
		"zip": zipPath,
	}
}

func exportConf(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	logging.LogInfof("exporting conf...")

	name := "siyuan-conf-" + time.Now().Format("20060102150405") + ".json"
	tmpDir := filepath.Join(util.TempDir, "export")
	if err := os.MkdirAll(tmpDir, 0755); err != nil {
		logging.LogErrorf("export conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	clonedConf := &model.AppConf{}
	if err := copier.CopyWithOption(clonedConf, model.Conf, copier.Option{IgnoreEmpty: false, DeepCopy: true}); err != nil {
		logging.LogErrorf("export conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if nil != clonedConf.Appearance {
		clonedConf.Appearance.DarkThemes = nil
		clonedConf.Appearance.LightThemes = nil
		clonedConf.Appearance.Icons = nil
	}
	if nil != clonedConf.Editor {
		clonedConf.Editor.Emoji = []string{}
	}
	if nil != clonedConf.Export {
		clonedConf.Export.PandocBin = ""
	}
	clonedConf.UserData = ""
	clonedConf.Account = nil
	clonedConf.AccessAuthCode = ""
	if nil != clonedConf.System {
		clonedConf.System.ID = ""
		clonedConf.System.Name = ""
		clonedConf.System.OSPlatform = ""
		clonedConf.System.Container = ""
		clonedConf.System.IsMicrosoftStore = false
		clonedConf.System.IsInsider = false
	}
	clonedConf.Sync = nil
	clonedConf.Stat = nil
	clonedConf.Api = nil
	clonedConf.Repo = nil
	clonedConf.Publish = nil
	clonedConf.CloudRegion = 0
	clonedConf.DataIndexState = 0

	data, err := gulu.JSON.MarshalIndentJSON(clonedConf, "", "  ")
	if err != nil {
		logging.LogErrorf("export conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	tmp := filepath.Join(tmpDir, name)
	if err = os.WriteFile(tmp, data, 0644); err != nil {
		logging.LogErrorf("export conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	zipFile, err := gulu.Zip.Create(tmp + ".zip")
	if err != nil {
		logging.LogErrorf("export conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if err = zipFile.AddEntry(name, tmp); err != nil {
		logging.LogErrorf("export conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if err = zipFile.Close(); err != nil {
		logging.LogErrorf("export conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	logging.LogInfof("exported conf")

	zipPath := "/export/" + name + ".zip"
	ret.Data = map[string]interface{}{
		"name": name,
		"zip":  zipPath,
	}
}

func importConf(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(200, ret)

	logging.LogInfof("importing conf...")

	form, err := c.MultipartForm()
	if err != nil {
		logging.LogErrorf("read upload file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	files := form.File["file"]
	if 1 != len(files) {
		ret.Code = -1
		ret.Msg = "invalid upload file"
		return
	}

	f := files[0]
	fh, err := f.Open()
	if err != nil {
		logging.LogErrorf("read upload file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	data, err := io.ReadAll(fh)
	fh.Close()
	if err != nil {
		logging.LogErrorf("read upload file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	importDir := filepath.Join(util.TempDir, "import")
	if err = os.MkdirAll(importDir, 0755); err != nil {
		logging.LogErrorf("import conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	tmp := filepath.Join(importDir, f.Filename)
	if err = os.WriteFile(tmp, data, 0644); err != nil {
		logging.LogErrorf("import conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	tmpDir := filepath.Join(importDir, "conf")
	if err = gulu.Zip.Unzip(tmp, tmpDir); err != nil {
		logging.LogErrorf("import conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	entries, err := os.ReadDir(tmpDir)
	if err != nil {
		logging.LogErrorf("import conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if 1 != len(entries) {
		logging.LogErrorf("invalid conf package")
		ret.Code = -1
		ret.Msg = "invalid conf package"
		return
	}

	tmp = filepath.Join(tmpDir, entries[0].Name())
	data, err = os.ReadFile(tmp)
	if err != nil {
		logging.LogErrorf("import conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	importedConf := model.NewAppConf()
	if err = gulu.JSON.UnmarshalJSON(data, importedConf); err != nil {
		logging.LogErrorf("import conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if err = copier.CopyWithOption(model.Conf, importedConf, copier.Option{IgnoreEmpty: true, DeepCopy: true}); err != nil {
		logging.LogErrorf("import conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	logging.LogInfof("imported conf")
}

func getConf(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	maskedConf, err := model.GetMaskedConf()
	if err != nil {
		ret.Code = -1
		ret.Msg = "get conf failed: " + err.Error()
		return
	}

	if !maskedConf.Sync.Enabled || (0 == maskedConf.Sync.Provider && !model.IsSubscriber()) {
		maskedConf.Sync.Stat = model.Conf.Language(53)
	}

	// REF: https://github.com/siyuan-note/siyuan/issues/11364
	role := model.GetGinContextRole(c)
	if model.IsReadOnlyRole(role) {
		maskedConf.ReadOnly = true
	}
	if !model.IsValidRole(role, []model.Role{
		model.RoleAdministrator,
	}) {
		model.HideConfSecret(maskedConf)
	}

	ret.Data = map[string]interface{}{
		"conf":  maskedConf,
		"start": !util.IsUILoaded,
	}
}

func setUILayout(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	if util.ReadOnly {
		return
	}

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	param, err := gulu.JSON.MarshalJSON(arg["layout"])
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	uiLayout := &conf.UILayout{}
	if err = gulu.JSON.UnmarshalJSON(param, uiLayout); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	model.Conf.SetUILayout(uiLayout)
	model.Conf.Save()
}

func setAPIToken(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	token := arg["token"].(string)
	model.Conf.Api.Token = token
	model.Conf.Save()
}

func setAccessAuthCode(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	aac := arg["accessAuthCode"].(string)
	if model.MaskedAccessAuthCode == aac {
		aac = model.Conf.AccessAuthCode
	}

	model.Conf.AccessAuthCode = aac
	model.Conf.Save()

	session := util.GetSession(c)
	workspaceSession := util.GetWorkspaceSession(session)
	workspaceSession.AccessAuthCode = aac
	session.Save(c)
	go func() {
		time.Sleep(200 * time.Millisecond)
		util.ReloadUI()
	}()
	return
}

func setFollowSystemLockScreen(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	lockScreenMode := int(arg["lockScreenMode"].(float64))

	model.Conf.System.LockScreenMode = lockScreenMode
	model.Conf.Save()
	return
}

func getSysFonts(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	ret.Data = util.GetSysFonts(model.Conf.Lang)
}

func version(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	ret.Data = util.Ver
}

func currentTime(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	ret.Data = util.CurrentTimeMillis()
}

func bootProgress(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	progress, details := util.GetBootProgressDetails()
	ret.Data = map[string]interface{}{"progress": progress, "details": details}
}

func setAppearanceMode(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	mode := int(arg["mode"].(float64))
	model.Conf.Appearance.Mode = mode
	if 0 == mode {
		model.Conf.Appearance.ThemeJS = gulu.File.IsExist(filepath.Join(util.ThemesPath, model.Conf.Appearance.ThemeLight, "theme.js"))
	} else {
		model.Conf.Appearance.ThemeJS = gulu.File.IsExist(filepath.Join(util.ThemesPath, model.Conf.Appearance.ThemeDark, "theme.js"))
	}
	model.Conf.Save()

	ret.Data = map[string]interface{}{
		"appearance": model.Conf.Appearance,
	}
}

func setNetworkServe(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	networkServe := arg["networkServe"].(bool)
	model.Conf.System.NetworkServe = networkServe
	model.Conf.Save()

	util.PushMsg(model.Conf.Language(42), 1000*15)
	time.Sleep(time.Second * 3)
}

func setGoogleAnalytics(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	googleAnalytics := arg["googleAnalytics"].(bool)
	model.Conf.System.DisableGoogleAnalytics = !googleAnalytics
	model.Conf.Save()
}

func setUploadErrLog(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	uploadErrLog := arg["uploadErrLog"].(bool)
	model.Conf.System.UploadErrLog = uploadErrLog
	model.Conf.Save()

	util.PushMsg(model.Conf.Language(42), 1000*15)
	time.Sleep(time.Second * 3)
}

func setAutoLaunch(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	autoLaunch := int(arg["autoLaunch"].(float64))
	model.Conf.System.AutoLaunch2 = autoLaunch
	model.Conf.Save()
}

func setDownloadInstallPkg(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	downloadInstallPkg := arg["downloadInstallPkg"].(bool)
	model.Conf.System.DownloadInstallPkg = downloadInstallPkg
	model.Conf.Save()
}

func setNetworkProxy(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	scheme := arg["scheme"].(string)
	host := arg["host"].(string)
	port := arg["port"].(string)
	model.Conf.System.NetworkProxy = &conf.NetworkProxy{
		Scheme: scheme,
		Host:   host,
		Port:   port,
	}
	model.Conf.Save()

	proxyURL := model.Conf.System.NetworkProxy.String()
	util.SetNetworkProxy(proxyURL)
	util.PushMsg(model.Conf.Language(102), 3000)
}

func addUIProcess(c *gin.Context) {
	pid := c.Query("pid")
	util.UIProcessIDs.Store(pid, true)
}

func exit(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	forceArg := arg["force"]
	var force bool
	if nil != forceArg {
		force = forceArg.(bool)
	}

	execInstallPkgArg := arg["execInstallPkg"] // 0：默认检查新版本，1：不执行新版本安装，2：执行新版本安装
	execInstallPkg := 0
	if nil != execInstallPkgArg {
		execInstallPkg = int(execInstallPkgArg.(float64))
	}

	exitCode := model.Close(force, true, execInstallPkg)
	ret.Code = exitCode
	switch exitCode {
	case 0:
	case 1: // 同步执行失败
		ret.Msg = model.Conf.Language(96) + "<div class=\"fn__space\"></div><button class=\"b3-button b3-button--white\">" + model.Conf.Language(97) + "</button>"
		ret.Data = map[string]interface{}{"closeTimeout": 0}
	case 2: // 提示新安装包
		ret.Msg = model.Conf.Language(61)
		ret.Data = map[string]interface{}{"closeTimeout": 0}
	}
}
