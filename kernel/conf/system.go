// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

type System struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	KernelVersion    string `json:"kernelVersion"`
	OS               string `json:"os"`
	OSPlatform       string `json:"osPlatform"`
	Container        string `json:"container"` // docker, android, ios, harmony, std
	IsMicrosoftStore bool   `json:"isMicrosoftStore"`

	HomeDir      string `json:"homeDir"`
	WorkspaceDir string `json:"workspaceDir"`
	AppDir       string `json:"appDir"`
	ConfDir      string `json:"confDir"`
	DataDir      string `json:"dataDir"`

	NetworkServe    bool          `json:"networkServe"`    // 是否开启网络伺服
	NetworkServeTLS bool          `json:"networkServeTLS"` // 是否开启 HTTPS 网络伺服
	NetworkProxy    *NetworkProxy `json:"networkProxy"`

	DownloadInstallPkg bool   `json:"downloadInstallPkg"`
	UpdateChannel      string `json:"updateChannel,omitempty"`
	AutoLaunch2        int    `json:"autoLaunch2"`    // 0：不自动启动，1：自动启动，2：自动启动+隐藏主窗口
	LockScreenMode     int    `json:"lockScreenMode"` // 0：手动，1：手动+跟随系统 https://github.com/siyuan-note/siyuan/issues/9087
	SettingsWindow     bool   `json:"settingsWindow"` // 是否在独立窗口中打开设置界面，仅桌面端生效

	EncryptedNotebookFollowSystemLock bool `json:"encryptedNotebookFollowSystemLock"` // 系统锁屏时锁定加密笔记本，默认关闭

	DisabledFeatures []string `json:"disabledFeatures"`

	MicrosoftDefenderExcluded bool `json:"microsoftDefenderExcluded"` // 是否已加入 Microsoft Defender 排除项 https://github.com/siyuan-note/siyuan/issues/13650

	SafeMode bool `json:"safeMode"` // 是否以安全模式运行（纯运行时状态，由 --safe-mode 注入，不随 conf.json 持久化）
}

const (
	OnboardingPending         = "pending"
	OnboardingNotebookCreated = "notebook-created"
	OnboardingCompleted       = "completed"
)

const (
	UpdateChannelStable = "stable"
	UpdateChannelBeta   = "beta"
	UpdateChannelAlpha  = "alpha"
)

type Onboarding struct {
	State      string `json:"state"`
	NewUser    bool   `json:"newUser"`
	Dismissed  bool   `json:"dismissed"`
	NotebookID string `json:"notebookID"`
	DocumentID string `json:"documentID"`
}

func NewSystem() *System {
	return &System{
		NetworkProxy:       &NetworkProxy{},
		DownloadInstallPkg: true,
		UpdateChannel:      UpdateChannelStable,
	}
}

type NetworkProxy struct {
	Scheme string `json:"scheme"`
	Host   string `json:"host"`
	Port   string `json:"port"`
}

func (np *NetworkProxy) String() string {
	if "" == np.Scheme || "system" == np.Scheme {
		return ""
	}
	return np.Scheme + "://" + np.Host + ":" + np.Port
}

func (np *NetworkProxy) IsSystem() bool {
	return "system" == np.Scheme
}
