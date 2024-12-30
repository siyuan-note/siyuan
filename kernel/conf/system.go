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

package conf

import (
	"github.com/siyuan-note/siyuan/kernel/util"
)

type System struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	KernelVersion    string `json:"kernelVersion"`
	OS               string `json:"os"`
	OSPlatform       string `json:"osPlatform"`
	Container        string `json:"container"` // docker, android, ios, std
	IsMicrosoftStore bool   `json:"isMicrosoftStore"`
	IsInsider        bool   `json:"isInsider"`

	HomeDir      string `json:"homeDir"`
	WorkspaceDir string `json:"workspaceDir"`
	AppDir       string `json:"appDir"`
	ConfDir      string `json:"confDir"`
	DataDir      string `json:"dataDir"`

	NetworkServe bool          `json:"networkServe"` // 是否开启网络伺服
	NetworkProxy *NetworkProxy `json:"networkProxy"`

	DisableGoogleAnalytics bool `json:"disableGoogleAnalytics"`
	DownloadInstallPkg     bool `json:"downloadInstallPkg"`
	AutoLaunch2            int  `json:"autoLaunch2"`    // 0：不自动启动，1：自动启动，2：自动启动+隐藏主窗口
	LockScreenMode         int  `json:"lockScreenMode"` // 0：手动，1：手动+跟随系统 https://github.com/siyuan-note/siyuan/issues/9087

	DisabledFeatures []string `json:"disabledFeatures"`

	MicrosoftDefenderExcluded bool `json:"microsoftDefenderExcluded"` // 是否已加入 Microsoft Defender 排除项 https://github.com/siyuan-note/siyuan/issues/13650
}

func NewSystem() *System {
	return &System{
		ID:                 util.GetDeviceID(),
		Name:               util.GetDeviceName(),
		KernelVersion:      util.Ver,
		NetworkProxy:       &NetworkProxy{},
		DownloadInstallPkg: true,
	}
}

type NetworkProxy struct {
	Scheme string `json:"scheme"`
	Host   string `json:"host"`
	Port   string `json:"port"`
}

func (np *NetworkProxy) String() string {
	if "" == np.Scheme {
		return ""
	}
	return np.Scheme + "://" + np.Host + ":" + np.Port
}
