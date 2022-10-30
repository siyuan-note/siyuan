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

package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func getEmojiConf(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	builtConfPath := filepath.Join(util.AppearancePath, "emojis", "conf.json")
	data, err := os.ReadFile(builtConfPath)
	if nil != err {
		logging.LogErrorf("read emojis conf.json failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	var conf []map[string]interface{}
	if err = gulu.JSON.UnmarshalJSON(data, &conf); nil != err {
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
	}
	items := []map[string]interface{}{}
	custom["items"] = items
	if gulu.File.IsDir(customConfDir) {
		model.CustomEmojis = sync.Map{}
		customEmojis, err := os.ReadDir(customConfDir)
		if nil != err {
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
					if nil != err {
						logging.LogErrorf("read custom emojis failed: %s", err)
						continue
					}

					for _, subCustomEmoji := range subCustomEmojis {
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

var start = true // 是否是启动
func getConf(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	maskedConf, err := model.GetMaskedConf()
	if nil != err {
		ret.Code = -1
		ret.Msg = "get conf failed: " + err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"conf":  maskedConf,
		"start": start,
	}

	if start {
		start = false
	}
}

func getLocalStorage(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	lsPath := filepath.Join(util.DataDir, "storage/local.json")
	if !gulu.File.IsExist(lsPath) {
		return
	}

	data, err := filelock.ReadFile(lsPath)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ls := map[string]interface{}{}
	if err = gulu.JSON.UnmarshalJSON(data, &ls); nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = ls
}

func setLocalStorage(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	val := arg["val"].(interface{})

	dirPath := filepath.Join(util.DataDir, "storage")
	if err := os.MkdirAll(dirPath, 0755); nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	data, err := gulu.JSON.MarshalJSON(val)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	lsPath := filepath.Join(dirPath, "local.json")
	err = filelock.WriteFile(lsPath, data)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func setUILayout(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	param, err := gulu.JSON.MarshalJSON(arg["layout"])
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	uiLayout := &conf.UILayout{}
	if err = gulu.JSON.UnmarshalJSON(param, uiLayout); nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	model.Conf.UILayout = uiLayout
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
	session.AccessAuthCode = aac
	session.Save(c)
	go func() {
		time.Sleep(200 * time.Millisecond)
		util.ReloadUI()
	}()
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

func setFixedPort(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	fixedPort := arg["fixedPort"].(bool)
	model.Conf.System.FixedPort = fixedPort
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

	util.PushMsg(model.Conf.Language(42), 1000*15)
	time.Sleep(time.Second * 3)
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

	exitCode := model.Close(force, execInstallPkg)
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
