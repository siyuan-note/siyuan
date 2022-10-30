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
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func listWorkspaceDirs(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	userHomeConfDir := filepath.Join(util.HomeDir, ".config", "siyuan")
	workspaceConf := filepath.Join(userHomeConfDir, "workspace.json")
	data, err := os.ReadFile(workspaceConf)
	if nil != err {
		logging.LogErrorf("read workspace conf [%s] failed: %s", workspaceConf, err)
		return
	}

	var workspacePaths []string
	if err = gulu.JSON.UnmarshalJSON(data, &workspacePaths); nil != err {
		logging.LogErrorf("unmarshal workspace conf [%s] failed: %s", workspaceConf, err)
		return
	}
	ret.Data = workspacePaths
}

func setWorkspaceDir(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	path := arg["path"].(string)
	if util.WorkspaceDir == path {
		ret.Code = -1
		ret.Msg = model.Conf.Language(78)
		ret.Data = map[string]interface{}{"closeTimeout": 3000}
		return
	}

	if gulu.OS.IsWindows() {
		installDir := filepath.Dir(util.WorkingDir)
		if strings.HasPrefix(path, installDir) {
			ret.Code = -1
			ret.Msg = model.Conf.Language(98)
			ret.Data = map[string]interface{}{"closeTimeout": 5000}
			return
		}
	}

	var workspacePaths []string
	workspaceConf := filepath.Join(util.HomeDir, ".config", "siyuan", "workspace.json")
	data, err := os.ReadFile(workspaceConf)
	if nil != err {
		logging.LogErrorf("read workspace conf failed: %s", err)
	} else {
		if err = gulu.JSON.UnmarshalJSON(data, &workspacePaths); nil != err {
			logging.LogErrorf("unmarshal workspace conf failed: %s", err)
		}
	}

	workspacePaths = append(workspacePaths, path)
	workspacePaths = gulu.Str.RemoveDuplicatedElem(workspacePaths)
	workspacePaths = gulu.Str.RemoveElem(workspacePaths, path)
	workspacePaths = append(workspacePaths, path) // 切换的工作空间固定放在最后一个

	if data, err = gulu.JSON.MarshalJSON(workspacePaths); nil != err {
		msg := fmt.Sprintf("marshal workspace conf [%s] failed: %s", workspaceConf, err)
		ret.Code = -1
		ret.Msg = msg
		return
	} else {
		if err = gulu.File.WriteFileSafer(workspaceConf, data, 0644); nil != err {
			msg := fmt.Sprintf("create workspace conf [%s] failed: %s", workspaceConf, err)
			ret.Code = -1
			ret.Msg = msg
			return
		}
	}

	util.PushMsg(model.Conf.Language(42), 1000*15)
	time.Sleep(time.Second * 3)
}
