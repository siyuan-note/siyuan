package apicontract

import "mime/multipart"

// SystemRuntimeInfoData 提供可复制的运行诊断文本，不包含工作空间路径或设备标识。
type SystemRuntimeInfoData struct {
	Text string `json:"text"`
}

type SystemPathRequest struct {
	Path string `json:"path"`
}
type SystemWorkspaceCheckData struct {
	IsWorkspace bool `json:"isWorkspace"`
}
type SystemWorkspace struct {
	Path   string `json:"path"`
	Closed bool   `json:"closed"`
}
type SystemChangelogRequest struct {
	Force bool `json:"force" api:"optional,nullable"`
}
type SystemChangelogData struct {
	Show    bool   `json:"show"`
	HTML    string `json:"html"`
	Version string `json:"version"`
}
type SystemCheckUpdateRequest struct {
	ShowMsg bool `json:"showMsg"`
}
type SystemZipData struct {
	Zip string `json:"zip"`
}
type SystemExportConfData struct {
	Name string `json:"name"`
	Zip  string `json:"zip"`
}
type SystemPathData struct {
	Path string `json:"path"`
}
type SystemMessageData struct {
	Msg string `json:"msg"`
}
type SystemConfData struct {
	Conf      *SystemAppConf `json:"conf"`
	Start     bool           `json:"start"`
	IsPublish bool           `json:"isPublish"`
}
type SystemImportConfRequest struct {
	File []*multipart.FileHeader `json:"file" api:"optional"`
}
type SystemImportFileRequest struct {
	File *multipart.FileHeader `json:"file" api:"optional"`
}
type SystemCustomEmojiRequest struct {
	File *multipart.FileHeader `json:"file" api:"optional"`
	URL  string                `json:"url" api:"optional"`
	Name string                `json:"name" api:"optional"`
}
type SystemEmojiGroup struct {
	ID        string         `json:"id"`
	Title     string         `json:"title"`
	TitleZhCN string         `json:"title_zh_cn"`
	TitleJaJP string         `json:"title_ja_jp"`
	Items     []*SystemEmoji `json:"items"`
}
type SystemEmoji struct {
	Unicode         string `json:"unicode"`
	Description     string `json:"description"`
	DescriptionZhCN string `json:"description_zh_cn"`
	DescriptionJaJP string `json:"description_ja_jp"`
	Keywords        string `json:"keywords"`
}
type SystemUILayoutRequest struct {
	Layout      map[string]JSONValue `json:"layout" api:"optional,nullable"`
	layoutError error
}

func (r SystemUILayoutRequest) LayoutError() error { return r.layoutError }

type SystemAPITokenRequest struct {
	Token string `json:"token"`
}
type SystemAccessAuthCodeRequest struct {
	AccessAuthCode string `json:"accessAuthCode"`
}
type SystemRemoveCustomFontRequest struct {
	ID string `json:"id" api:"optional,nullable,ignoretype"`
}
type SystemRemoveCustomFontData struct {
	Font       *SystemCustomFont  `json:"font"`
	Editor     *SettingEditor     `json:"editor"`
	Appearance *SettingAppearance `json:"appearance"`
}
type SystemAppearanceModeRequest struct {
	Mode float64 `json:"mode"`
}
type SystemAppearanceData struct {
	Appearance *SettingAppearance `json:"appearance"`
}
type SystemUIProcessRequest struct {
	PID string `json:"pid" api:"optional,nullable"`
}
type SystemExitRequest struct {
	Force               bool    `json:"force" api:"optional,nullable"`
	ExecInstallPkg      float64 `json:"execInstallPkg" api:"optional,nullable"`
	SetCurrentWorkspace *bool   `json:"setCurrentWorkspace" api:"optional,nullable"`
}
type SystemExitData struct {
	CloseTimeout   int    `json:"closeTimeout"`
	InstallPkgPath string `json:"installPkgPath,omitempty"`
}
type SystemOIDCStartRequest struct {
	Flow       string `json:"flow" api:"optional,nullable"`
	To         string `json:"to" api:"optional,nullable"`
	RememberMe bool   `json:"rememberMe" api:"optional,nullable"`
	parseError error
}

func (r SystemOIDCStartRequest) ParseError() error { return r.parseError }

type SystemOIDCRequest struct {
	SystemOIDC
	parseError error
}

func (r SystemOIDCRequest) ParseError() error { return r.parseError }

type SystemOIDCStartData struct {
	AuthURL   string `json:"authURL"`
	ExpiresIn int    `json:"expiresIn"`
	PollToken string `json:"pollToken,omitempty"`
}
type SystemOIDCCallbackRequest struct {
	State string `json:"state" api:"optional,nullable"`
	Code  string `json:"code" api:"optional,nullable"`
	Error string `json:"error" api:"optional,nullable"`
}
type SystemOIDCMobileRequest struct {
	CallbackURL string `json:"callbackURL" api:"optional,nullable"`
	parseError  error
}

func (r SystemOIDCMobileRequest) ParseError() error { return r.parseError }

type SystemOIDCMobileData struct {
	Validation bool   `json:"validation,omitempty" api:"const=true"`
	To         string `json:"to,omitempty"`
}
type SystemOIDCPollRequest struct {
	PollToken  string `json:"pollToken" api:"optional,nullable"`
	parseError error
}

func (r SystemOIDCPollRequest) ParseError() error { return r.parseError }

type SystemOIDCPollData struct {
	Status string `json:"status" api:"enum=pending|completed"`
	To     string `json:"to,omitempty"`
}

type SystemOIDCValidatePollData struct {
	Status string `json:"status" api:"enum=pending|completed"`
}
type SystemOIDCActivateData struct {
	Status string      `json:"status" api:"const=\"completed\""`
	Config *SystemOIDC `json:"config"`
}
type SystemLoginAuthRequest struct {
	AuthCode      string `json:"authCode"`
	Captcha       string `json:"captcha" api:"optional,nullable"`
	RememberMe    bool   `json:"rememberMe" api:"optional,nullable"`
	authCodeError error
	captchaError  error
}

func (r SystemLoginAuthRequest) AuthCodeError() error { return r.authCodeError }
func (r SystemLoginAuthRequest) CaptchaError() error  { return r.captchaError }
