// SiYuan - From thought to insight, with agents
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
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var checkWorkspaceDir = contractHandler(apicontract.SystemCheckWorkspaceDir, func(c *gin.Context, request apicontract.SystemPathRequest) (ret apicontract.Response[apicontract.SystemWorkspaceCheckData]) {
	ret = apicontract.Success(apicontract.SystemWorkspaceCheckData{})

	path := request.Path
	if response := rejectMobileWorkspaceBaseDirResponse[apicontract.SystemWorkspaceCheckData](path); response != nil {
		return *response
	}
	// 检查路径是否是分区根路径
	if util.IsPartitionRootPath(path) {
		ret = apicontract.FailureWithTimeout[apicontract.SystemWorkspaceCheckData](-1, model.Conf.Language(273), 7000)
		return
	}

	// 检查路径是否包含其他文件
	if !util.IsWorkspaceDir(path) {
		entries, err := os.ReadDir(path)
		if err != nil {
			ret = apicontract.Failure[apicontract.SystemWorkspaceCheckData](-1, fmt.Sprintf("read dir [%s] failed: %s", path, err))
			return
		}
		if 0 < len(entries) {
			ret = apicontract.FailureWithTimeout[apicontract.SystemWorkspaceCheckData](-1, model.Conf.Language(274), 7000)
			return
		}
	}

	if isInvalidWorkspacePath(path) {
		ret = apicontract.Failure[apicontract.SystemWorkspaceCheckData](-1, "This workspace name is not allowed, please use another name")
		return
	}

	if !gulu.File.IsExist(path) {
		ret = apicontract.Failure[apicontract.SystemWorkspaceCheckData](-1, "This workspace does not exist")
		return
	}

	ret = apicontract.Success(apicontract.SystemWorkspaceCheckData{IsWorkspace: util.IsWorkspaceDir(path)})
	return
})

var createWorkspaceDir = contractHandler(apicontract.SystemCreateWorkspaceDir, func(c *gin.Context, request apicontract.SystemPathRequest) (ret apicontract.Response[apicontract.Null]) {
	ret = apicontract.Success(apicontract.Null{})

	absPath := request.Path
	absPath = util.RemoveInvalid(absPath)
	absPath = strings.TrimSpace(absPath)
	if response := rejectMobileWorkspaceBaseDirResponse[apicontract.Null](absPath); response != nil {
		return *response
	}
	if isInvalidWorkspacePath(absPath) {
		ret = apicontract.Failure[apicontract.Null](-1, "This workspace name is not allowed, please use another name")
		return
	}

	if !gulu.File.IsExist(absPath) {
		if err := os.MkdirAll(absPath, 0755); err != nil {
			ret = apicontract.Failure[apicontract.Null](-1, fmt.Sprintf("create workspace dir [%s] failed: %s", absPath, err))
			return
		}
	}

	workspacePaths, err := util.ReadWorkspacePaths()
	if err != nil {
		ret = apicontract.Failure[apicontract.Null](-1, err.Error())
		return
	}

	workspacePaths = append(workspacePaths, absPath)

	if err = util.WriteWorkspacePaths(workspacePaths); err != nil {
		ret = apicontract.Failure[apicontract.Null](-1, err.Error())
		return
	}
	return
})

var removeWorkspaceDir = contractHandler(apicontract.SystemRemoveWorkspaceDir, func(c *gin.Context, request apicontract.SystemPathRequest) (ret apicontract.Response[apicontract.Null]) {
	ret = apicontract.Success(apicontract.Null{})

	path := request.Path

	if util.IsWorkspaceLocked(path) || util.WorkspaceDir == path {
		msg := "Cannot remove current workspace"
		ret = apicontract.FailureWithTimeout[apicontract.Null](-1, msg, 3000)
		return
	}

	workspacePaths, err := util.ReadWorkspacePaths()
	if err != nil {
		ret = apicontract.Failure[apicontract.Null](-1, err.Error())
		return
	}

	workspacePaths = util.RemoveWorkspacePath(workspacePaths, path)

	if err = util.WriteWorkspacePaths(workspacePaths); err != nil {
		ret = apicontract.Failure[apicontract.Null](-1, err.Error())
		return
	}
	return
})

var removeWorkspaceDirPhysically = contractHandler(apicontract.SystemRemoveWorkspaceDirPhysically, func(c *gin.Context, request apicontract.SystemPathRequest) (ret apicontract.Response[apicontract.Null]) {
	ret = apicontract.Success(apicontract.Null{})

	path := request.Path

	// 硬边界：只允许删除已登记的工作空间目录或新建的空目录，禁止删除当前工作空间和任意路径
	cleanPath, absErr := filepath.Abs(path)
	if absErr != nil {
		ret = apicontract.Failure[apicontract.Null](-1, absErr.Error())
		return
	}
	if response := rejectMobileWorkspaceBaseDirResponse[apicontract.Null](cleanPath); response != nil {
		return *response
	}
	if util.IsWorkspaceLocked(cleanPath) || cleanPath == util.WorkspaceDir {
		ret = apicontract.Failure[apicontract.Null](-1, "cannot remove opened workspace")
		return
	}
	knownPaths, err := util.ReadWorkspacePaths()
	if err != nil {
		ret = apicontract.Failure[apicontract.Null](-1, err.Error())
		return
	}
	remainingPaths := util.RemoveWorkspacePath(knownPaths, cleanPath)
	if len(remainingPaths) == len(knownPaths) {
		ret = apicontract.Failure[apicontract.Null](-1, "path is not a registered workspace")
		return
	}
	if !util.IsWorkspaceDir(cleanPath) {
		entries, readErr := os.ReadDir(cleanPath)
		if readErr != nil {
			ret = apicontract.Failure[apicontract.Null](-1, readErr.Error())
			return
		}
		if 0 < len(entries) {
			ret = apicontract.Failure[apicontract.Null](-1, "path is not a workspace directory")
			return
		}
	}

	if err := os.RemoveAll(cleanPath); err != nil {
		ret = apicontract.Failure[apicontract.Null](-1, err.Error())
		return
	}
	if err = util.WriteWorkspacePaths(remainingPaths); err != nil {
		ret = apicontract.Failure[apicontract.Null](-1, err.Error())
		return
	}

	logging.LogInfof("removed workspace [%s] physically", path)
	return
})

type Workspace = apicontract.SystemWorkspace

var getMobileWorkspaces = contractHandler(apicontract.SystemGetMobileWorkspaces, func(c *gin.Context, request apicontract.EmptyRequest) (ret apicontract.Response[[]string]) {
	ret = apicontract.Success([]string(nil))

	if !util.IsMobileContainer() {
		return
	}

	root := filepath.Dir(util.WorkspaceDir)
	dirs, err := os.ReadDir(root)
	if err != nil {
		logging.LogErrorf("read dir [%s] failed: %s", root, err)
		ret = apicontract.Failure[[]string](-1, err.Error())
		return
	}

	ret = apicontract.Success([]string{})
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
	ret = apicontract.Success(paths)
	return
})

var getWorkspaces = contractHandler(apicontract.SystemGetWorkspaces, func(c *gin.Context, request apicontract.EmptyRequest) (ret apicontract.Response[[]*apicontract.SystemWorkspace]) {
	ret = apicontract.Success([]*apicontract.SystemWorkspace(nil))

	workspacePaths, err := util.ReadWorkspacePaths()
	if err != nil {
		ret = apicontract.Failure[[]*apicontract.SystemWorkspace](-1, err.Error())
		return
	}

	if role := model.GetGinContextRole(c); !model.IsValidRole(role, []model.Role{
		model.RoleAdministrator,
	}) {
		ret = apicontract.Success([]*Workspace{})
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
		return util.NaturalCompare(filepath.Base(openedWorkspaces[i].Path), filepath.Base(openedWorkspaces[j].Path))
	})
	sort.Slice(closedWorkspaces, func(i, j int) bool {
		return util.NaturalCompare(filepath.Base(closedWorkspaces[i].Path), filepath.Base(closedWorkspaces[j].Path))
	})
	workspaces = append(workspaces, openedWorkspaces...)
	workspaces = append(workspaces, closedWorkspaces...)
	ret = apicontract.Success(workspaces)
	return
})

var setWorkspaceDir = contractHandler(apicontract.SystemSetWorkspaceDir, func(c *gin.Context, request apicontract.SystemPathRequest) (ret apicontract.Response[apicontract.Null]) {
	ret = apicontract.Success(apicontract.Null{})

	path := request.Path
	if response := rejectMobileWorkspaceBaseDirResponse[apicontract.Null](path); response != nil {
		return *response
	}
	if util.WorkspaceDir == path {
		ret = apicontract.FailureWithTimeout[apicontract.Null](-1, model.Conf.Language(78), 3000)
		return
	}

	if util.IsCloudDrivePath(path) {
		ret = apicontract.FailureWithTimeout[apicontract.Null](-1, model.Conf.Language(196), 7000)
		return
	}

	if gulu.OS.IsWindows() {
		// 改进判断工作空间路径实现 https://github.com/siyuan-note/siyuan/issues/7569
		installDirLower := strings.ToLower(filepath.Dir(util.WorkingDir))
		pathLower := strings.ToLower(path)
		if strings.HasPrefix(pathLower, installDirLower) && (gulu.File.IsSubPath(installDirLower, pathLower) || filepath.Clean(installDirLower) == filepath.Clean(pathLower)) {
			ret = apicontract.FailureWithTimeout[apicontract.Null](-1, model.Conf.Language(98), 5000)
			return
		}
	}

	// 检查路径是否在已有的工作空间路径中
	pathIsWorkspace := util.IsWorkspaceDir(path)
	if !pathIsWorkspace {
		for p := filepath.Dir(path); !util.IsPartitionRootPath(p); p = filepath.Dir(p) {
			if util.IsWorkspaceDir(p) {
				ret = apicontract.FailureWithTimeout[apicontract.Null](-1, fmt.Sprintf(model.Conf.Language(256), path, p), 7000)
				return
			}
		}
	}

	workspacePaths, err := util.ReadWorkspacePaths()
	if err != nil {
		ret = apicontract.Failure[apicontract.Null](-1, err.Error())
		return
	}

	workspacePaths = append(workspacePaths, path)
	workspacePaths = util.DeduplicateWorkspacePaths(workspacePaths)
	workspacePaths = util.RemoveWorkspacePath(workspacePaths, path)
	workspacePaths = append(workspacePaths, path) // 切换的工作空间固定放在最后一个

	if err = util.WriteWorkspacePaths(workspacePaths); err != nil {
		ret = apicontract.Failure[apicontract.Null](-1, err.Error())
		return
	}

	if util.IsMobileContainer() {
		util.PushMsg(model.Conf.Language(42), 1000*15)
		time.Sleep(2 * time.Second)
	}
	return
})

func isInvalidWorkspacePath(absPath string) bool {
	if "" == absPath {
		return true
	}
	if util.IsMobileWorkspaceBaseDir(absPath) {
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
	if 32 < utf8.RuneCountInString(name) {
		// Adjust workspace name length limit to 32 runes https://github.com/siyuan-note/siyuan/issues/9440
		return true
	}
	toLower := strings.ToLower(name)
	return gulu.Str.Contains(toLower, []string{"conf", "home", "data", "temp"})
}

func rejectMobileWorkspaceBaseDir(ret *gulu.Result, path string) bool {
	if !util.IsMobileWorkspaceBaseDir(path) {
		return false
	}
	ret.Code = -1
	ret.Msg = model.Conf.Language(274)
	ret.Data = map[string]any{"closeTimeout": 7000}
	return true
}

func rejectMobileWorkspaceBaseDirResponse[Data any](path string) *apicontract.Response[Data] {
	result := gulu.Ret.NewResult()
	if !rejectMobileWorkspaceBaseDir(result, path) {
		return nil
	}
	response := apicontract.FailureWithTimeout[Data](result.Code, result.Msg, 7000)
	return &response
}
