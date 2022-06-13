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
		util.LogErrorf("read emojis conf.json failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	var conf []map[string]interface{}
	if err = gulu.JSON.UnmarshalJSON(data, &conf); nil != err {
		util.LogErrorf("unmarshal emojis conf.json failed: %s", err)
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
			util.LogErrorf("read custom emojis failed: %s", err)
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
						util.LogErrorf("read custom emojis failed: %s", err)
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

func getConf(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	ret.Data = model.Conf
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

func setE2EEPasswd(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var passwd string
	mode := int(arg["mode"].(float64))
	if 0 == mode { // 使用内建的密码生成
		passwd = model.GetBuiltInE2EEPasswd()
	} else { // 使用自定义密码
		passwd = arg["e2eePasswd"].(string)
		passwd = strings.TrimSpace(passwd)
	}

	if "" == passwd {
		ret.Code = -1
		ret.Msg = model.Conf.Language(39)
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}

	newPasswd := util.AESEncrypt(passwd)
	if model.Conf.E2EEPasswd == newPasswd {
		util.PushMsg(model.Conf.Language(92), 3000)
		return
	}

	msgId := util.PushMsg(model.Conf.Language(102), 1000*7)
	if err := os.RemoveAll(model.Conf.Backup.GetSaveDir()); nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if err := os.MkdirAll(model.Conf.Backup.GetSaveDir(), 0755); nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if err := os.RemoveAll(model.Conf.Sync.GetSaveDir()); nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if err := os.MkdirAll(model.Conf.Sync.GetSaveDir(), 0755); nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if err := os.RemoveAll(filepath.Join(util.TempDir, "incremental")); nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if err := os.MkdirAll(filepath.Join(util.TempDir, "incremental"), 0755); nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	time.Sleep(1 * time.Second)
	model.Conf.E2EEPasswd = newPasswd
	model.Conf.E2EEPasswdMode = mode
	model.Conf.Save()
	util.PushUpdateMsg(msgId, model.Conf.Language(92), 3000)
	time.Sleep(1 * time.Second)
	model.SyncData(false, false, true)
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

	err := model.Close(force)
	if nil != err {
		ret.Code = 1
		ret.Msg = err.Error() + "<div class=\"fn__space\"></div><button class=\"b3-button b3-button--white\">" + model.Conf.Language(97) + "</button>"
		ret.Data = map[string]interface{}{"closeTimeout": 0}
		return
	}
}
