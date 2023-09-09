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
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/facette/natsort"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func checkWorkspaceDir(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	path := arg["path"].(string)
	if isInvalidWorkspacePath(path) {
		ret.Code = -1
		ret.Msg = "This workspace name is not allowed, please use another name"
		return
	}

	if !gulu.File.IsExist(path) {
		ret.Code = -1
		ret.Msg = "This workspace does not exist"
		return
	}

	entries, err := os.ReadDir(path)
	if nil != err {
		ret.Code = -1
		ret.Msg = fmt.Sprintf("read workspace dir [%s] failed: %s", path, err)
	}

	var existsConf, existsData bool
	for _, entry := range entries {
		if !existsConf {
			existsConf = "conf" == entry.Name() && entry.IsDir()
		}
		if !existsData {
			existsData = "data" == entry.Name() && entry.IsDir()
		}

		if existsConf && existsData {
			break
		}
	}

	if existsConf {
		existsConf = gulu.File.IsExist(filepath.Join(path, "conf", "conf.json"))
	}

	ret.Data = map[string]interface{}{
		"isWorkspace": existsConf && existsData,
	}
}

func createWorkspaceDir(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	absPath := arg["path"].(string)
	absPath = gulu.Str.RemoveInvisible(absPath)
	absPath = strings.TrimSpace(absPath)
	if isInvalidWorkspacePath(absPath) {
		ret.Code = -1
		ret.Msg = "This workspace name is not allowed, please use another name"
		return
	}

	if !gulu.File.IsExist(absPath) {
		if err := os.MkdirAll(absPath, 0755); nil != err {
			ret.Code = -1
			ret.Msg = fmt.Sprintf("create workspace dir [%s] failed: %s", absPath, err)
			return
		}
	}

	workspacePaths, err := util.ReadWorkspacePaths()
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	workspacePaths = append(workspacePaths, absPath)

	if err = util.WriteWorkspacePaths(workspacePaths); nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func removeWorkspaceDir(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	path := arg["path"].(string)

	if util.IsWorkspaceLocked(path) {
		logging.LogWarnf("skip remove workspace [%s] because it is locked", path)
		return
	}

	workspacePaths, err := util.ReadWorkspacePaths()
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	workspacePaths = gulu.Str.RemoveElem(workspacePaths, path)

	if err = util.WriteWorkspacePaths(workspacePaths); nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if util.WorkspaceDir == path && (util.ContainerIOS == util.Container || util.ContainerAndroid == util.Container) {
		os.Exit(logging.ExitCodeOk)
	}
}

func removeWorkspaceDirPhysically(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	path := arg["path"].(string)
	if gulu.File.IsDir(path) {
		err := os.RemoveAll(path)
		if nil != err {
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
	}

	logging.LogInfof("removed workspace [%s] physically", path)
	if util.WorkspaceDir == path {
		os.Exit(logging.ExitCodeOk)
	}
}

type Workspace struct {
	Path   string `json:"path"`
	Closed bool   `json:"closed"`
}

func getMobileWorkspaces(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	if util.ContainerIOS != util.Container && util.ContainerAndroid != util.Container {
		return
	}

	root := filepath.Dir(util.WorkspaceDir)
	dirs, err := os.ReadDir(root)
	if nil != err {
		logging.LogErrorf("read dir [%s] failed: %s", root, err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = []string{}
	var paths []string
	for _, dir := range dirs {
		if dir.IsDir() {
			absPath := filepath.Join(root, dir.Name())
			if isInvalidWorkspacePath(absPath) {
				continue
			}

			paths = append(paths, absPath)
		}
	}
	ret.Data = paths
}

func getWorkspaces(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	workspacePaths, err := util.ReadWorkspacePaths()
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	var workspaces, openedWorkspaces, closedWorkspaces []*Workspace
	for _, p := range workspacePaths {
		closed := !util.IsWorkspaceLocked(p)
		if closed {
			closedWorkspaces = append(closedWorkspaces, &Workspace{Path: p, Closed: closed})
		} else {
			openedWorkspaces = append(openedWorkspaces, &Workspace{Path: p, Closed: closed})
		}
	}
	sort.Slice(openedWorkspaces, func(i, j int) bool {
		return natsort.Compare(util.RemoveEmoji(filepath.Base(openedWorkspaces[i].Path)), util.RemoveEmoji(filepath.Base(openedWorkspaces[j].Path)))
	})
	sort.Slice(closedWorkspaces, func(i, j int) bool {
		return natsort.Compare(util.RemoveEmoji(filepath.Base(closedWorkspaces[i].Path)), util.RemoveEmoji(filepath.Base(closedWorkspaces[j].Path)))
	})
	workspaces = append(workspaces, openedWorkspaces...)
	workspaces = append(workspaces, closedWorkspaces...)
	ret.Data = workspaces
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

	if util.IsCloudDrivePath(path) {
		ret.Code = -1
		ret.Msg = model.Conf.Language(196)
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}

	if gulu.OS.IsWindows() {
		// 改进判断工作空间路径实现 https://github.com/siyuan-note/siyuan/issues/7569
		installDirLower := strings.ToLower(filepath.Dir(util.WorkingDir))
		pathLower := strings.ToLower(path)
		if strings.HasPrefix(pathLower, installDirLower) && util.IsSubPath(installDirLower, pathLower) {
			ret.Code = -1
			ret.Msg = model.Conf.Language(98)
			ret.Data = map[string]interface{}{"closeTimeout": 5000}
			return
		}
	}

	workspacePaths, err := util.ReadWorkspacePaths()
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	workspacePaths = append(workspacePaths, path)
	workspacePaths = gulu.Str.RemoveDuplicatedElem(workspacePaths)
	workspacePaths = gulu.Str.RemoveElem(workspacePaths, path)
	workspacePaths = append(workspacePaths, path) // 切换的工作空间固定放在最后一个

	if err = util.WriteWorkspacePaths(workspacePaths); nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if util.ContainerAndroid == util.Container || util.ContainerIOS == util.Container {
		util.PushMsg(model.Conf.Language(42), 1000*15)
		time.Sleep(time.Second * 2)
		model.Close(false, 1)
	}
}

func isInvalidWorkspacePath(absPath string) bool {
	if "" == absPath {
		return true
	}
	name := filepath.Base(absPath)
	if "" == name {
		return true
	}
	if strings.HasPrefix(name, ".") {
		return true
	}
	if !gulu.File.IsValidFilename(name) {
		return true
	}
	if 16 < utf8.RuneCountInString(name) {
		return true
	}
	toLower := strings.ToLower(name)
	return gulu.Str.Contains(toLower, []string{"conf", "home", "data", "temp"})
}
