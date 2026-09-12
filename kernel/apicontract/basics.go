package apicontract

type WorkspaceInfoData struct {
	WorkspaceDir string `json:"workspaceDir"`
	SiyuanVer    string `json:"siyuanVer"`
}

type BootProgressData struct {
	Progress int32  `json:"progress"`
	Details  string `json:"details"`
}

type NetworkProxy struct {
	Scheme string `json:"scheme"`
	Host   string `json:"host"`
	Port   string `json:"port"`
}

type NetworkData struct {
	Proxy *NetworkProxy `json:"proxy"`
}

type LockScreenRequest struct {
	LockScreenMode float64 `json:"lockScreenMode"`
}

type NetworkServeRequest struct {
	NetworkServe bool `json:"networkServe"`
}

type NetworkServeTLSRequest struct {
	NetworkServeTLS bool `json:"networkServeTLS"`
}

type AutoLaunchRequest struct {
	AutoLaunch float64 `json:"autoLaunch"`
}

type DownloadInstallPkgRequest struct {
	DownloadInstallPkg bool `json:"downloadInstallPkg"`
}

type UpdateChannelRequest struct {
	UpdateChannel string `json:"updateChannel"`
}

type BlockIDsRequest struct {
	IDs []string `json:"ids"`
}

type DOMTextRequest struct {
	DOM string `json:"dom"`
}

type RemoveBookmarkRequest struct {
	Bookmark string `json:"bookmark"`
}

type RenameBookmarkRequest struct {
	OldBookmark string `json:"oldBookmark"`
	NewBookmark string `json:"newBookmark"`
}

type RemoveTagRequest struct {
	Label string `json:"label"`
}

type RenameTagRequest struct {
	OldLabel string `json:"oldLabel"`
	NewLabel string `json:"newLabel" api:"trim"`
}

type BatchSetBlockAttrsRequest struct {
	BlockAttrs []SetBlockAttrsRequest `json:"blockAttrs"`
}

type EditorReadOnlyRequest struct {
	ReadOnly bool `json:"readonly"`
}

type VirtualBlockRefRequest struct {
	Keywords []string `json:"keywords"`
}

type GetTagRequest struct {
	IgnoreMaxListHint bool    `json:"ignoreMaxListHint" api:"optional,nullable"`
	App               string  `json:"app" api:"optional,nullable"`
	Sort              float64 `json:"sort" api:"optional,nullable"`
}

type TagData struct {
	Name     string     `json:"name"`
	Label    string     `json:"label"`
	Children []*TagData `json:"children"`
	Type     string     `json:"type"`
	Depth    int        `json:"depth"`
	Count    int        `json:"count"`
}
