package apicontract

type LoadPetalsRequest struct {
	Frontend string `json:"frontend" api:"trim"`
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
	Name                  string               `json:"name"`
	DisplayName           string               `json:"displayName"`
	Version               string               `json:"version"`
	Enabled               bool                 `json:"enabled"`
	Incompatible          bool                 `json:"incompatible"`
	DisabledInPublish     bool                 `json:"disabledInPublish"`
	UserDisabledInPublish bool                 `json:"userDisabledInPublish"`
	DisallowInstall       bool                 `json:"disallowInstall"`
	JS                    string               `json:"js"`
	CSS                   string               `json:"css"`
	I18n                  map[string]JSONValue `json:"i18n"`
	Kernel                KernelPetal          `json:"kernel"`
}

type KernelPetal struct {
	JS           string `json:"js"`
	Existed      bool   `json:"existed"`
	Incompatible bool   `json:"incompatible"`
}
