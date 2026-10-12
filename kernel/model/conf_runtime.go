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

package model

import (
	"bytes"
	"runtime"
	"sync/atomic"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// persistedConf 记录本进程最近一次生成的配置持久化字节；加密归档据此打包持久化形态，
// 不依赖打包时磁盘上的配置文件。nil 表示本进程尚无已知的持久化配置。
var persistedConf atomic.Pointer[[]byte]

// recordPersistedConf 在生成持久化字节后调用，事务路径在确认提交后发布。
func recordPersistedConf(data []byte) {
	if data == nil {
		persistedConf.Store(nil)
		return
	}
	cloned := bytes.Clone(data)
	persistedConf.Store(&cloned)
}

// lastPersistedConf 返回本进程最近一次生成的持久化形态副本。
func lastPersistedConf() []byte {
	if data := persistedConf.Load(); data != nil {
		return bytes.Clone(*data)
	}
	return nil
}

// applyConfRuntime 是派生运行时状态的唯一投影入口：任一配置写入后都由它从当前配置重新计算全部派生值。
// 缺失的配置段保持对应派生值不变。
func applyConfRuntime(configs ...*AppConf) {
	current := Conf
	if len(configs) > 0 {
		current = configs[0]
	}
	if current == nil {
		return
	}
	appearance := current.LoadAppearance()
	editor := current.LoadEditor()
	fileTree := current.LoadFileTree()

	if nil != editor {
		util.MarkdownSettings.Store(editor.Markdown)
	}
	if nil != fileTree {
		util.UseSingleLineSave.Store(fileTree.UseSingleLineSave)
		util.LargeFileWarningSize.Store(fileTree.LargeFileWarningSize)
	}
	if nil != appearance {
		util.StatusBarCfg.Store(appearance.StatusBar)
		util.NotificationsCfg.Store(appearance.Notifications)
	}
	applySearchRuntime(current)
}

// ApplyConfRuntime 供设置接口在替换配置段后重新投影派生运行时状态。
func ApplyConfRuntime() {
	applyConfRuntime()
}

// ApplySearchRuntime 将搜索配置投影到数据库层。数据库打开前设置的 PRAGMA 不会生效，
// 因此各入口在打开数据库后需要再调用一次。
func ApplySearchRuntime() {
	applySearchRuntime(Conf)
}

func applySearchRuntime(current *AppConf) {
	search := current.LoadSearch()
	if nil == search {
		return
	}
	sql.SetCaseSensitive(search.CaseSensitive)
	sql.SetHanSensitive(search.HanSensitiveVal())
	sql.SetIndexAssetPath(search.IndexAssetPath)
}

// projectSystemEnvironment 将当前进程的运行环境投影到系统配置，这些字段每次启动都按运行环境重新赋值。
func projectSystemEnvironment(system *conf.System) {
	system.KernelVersion = util.Ver
	system.UpdateChannel = loadGlobalUpdateChannel()
	if system.ID == "" || util.ContainerStd == util.Container {
		system.ID = util.GetDeviceID()
	}
	if system.Name == "" || util.ContainerStd == util.Container {
		system.Name = util.GetDeviceName()
	}
	system.DisabledFeatures = util.DisabledFeatures
	if 1 > len(system.DisabledFeatures) {
		system.DisabledFeatures = []string{}
	}
	system.AppDir = util.WorkingDir
	system.ConfDir = util.ConfDir
	system.HomeDir = util.HomeDir
	system.WorkspaceDir = util.WorkspaceDir
	system.DataDir = util.DataDir
	system.Container = util.Container
	system.IsMicrosoftStore = util.ISMicrosoftStore
	if util.ISMicrosoftStore {
		logging.LogInfof("using Microsoft Store edition")
	}
	system.OS = runtime.GOOS
	system.OSPlatform = util.GetOSPlatform()
}
