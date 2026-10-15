package apicontract

type LoadPetalsRequest struct {
	Frontend string `json:"frontend" api:"trim"`
	// 为 true 时仅返回 plugin.json 声明 settingsWindow: true 的已启用兼容插件；省略或 false 保持原有行为。
	// 设置窗口仍使用 desktop 的前端兼容性，不影响插件的 frontends 声明和发布权限检查。
	SettingsWindow bool `json:"settingsWindow,omitempty" api:"optional"`
}

type SetPetalEnabledRequest struct {
	PackageName string `json:"packageName" api:"trim"`
	Enabled     bool   `json:"enabled"`
	App         string `json:"app" api:"optional,nullable"`
}

type SetPetalPublishEnabledRequest struct {
	PackageName string `json:"packageName" api:"trim"`
	Enabled     bool   `json:"enabled"`
}

type Petal struct {
	Name                  string `json:"name"`
	DisplayName           string `json:"displayName"`
	Version               string `json:"version"`
	Enabled               bool   `json:"enabled"`
	Incompatible          bool   `json:"incompatible"`
	DisabledInPublish     bool   `json:"disabledInPublish"`
	UserDisabledInPublish bool   `json:"userDisabledInPublish"`
	DisallowInstall       bool   `json:"disallowInstall"`
	// 设置窗口筛选响应中为 true；旧内核或普通加载响应可以省略，客户端不能把省略当成主动声明。
	SettingsWindow bool                 `json:"settingsWindow,omitempty"`
	JS             string               `json:"js"`
	CSS            string               `json:"css"`
	I18n           map[string]JSONValue `json:"i18n"`
	Kernel         KernelPetal          `json:"kernel"`
}

type KernelPetal struct {
	JS           string `json:"js"`
	Existed      bool   `json:"existed"`
	Incompatible bool   `json:"incompatible"`
}
