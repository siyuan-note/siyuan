package apicontract

import (
	"encoding/json"
	"io"
)

type SetConfSnippetRequest struct {
	SettingSnpt
	settingConfig
}

type SetBazaarRequest struct {
	SettingBazaar
	settingConfig
}

type SetAIRequest struct {
	SettingAI
	settingConfig
}

type SetSecretsRequest struct {
	SettingSecrets
	settingConfig
}

type SetVariablesRequest struct {
	SettingVariables
	settingConfig
}

type SetFlashcardRequest struct {
	SettingFlashcard
	settingConfig
}

type SetEditorRequest struct {
	SettingEditor
	settingConfig
}

type SetExportRequest struct {
	SettingExport
	settingConfig
}

type SetFiletreeRequest struct {
	SettingFileTree
	settingConfig
}

type SetSearchRequest struct {
	SettingSearch
	settingConfig
}

type SetAppearanceRequest struct {
	SettingAppearance
	settingConfig
}

type SetEntryVisibilityRequest struct {
	SettingEntryVisibility
	settingConfig
}

type SetPublishRequest struct {
	SettingPublish
	settingConfig
}

func init() {
	SetConfSnippet.decodeRequest = func(reader io.Reader) (r SetConfSnippetRequest, err error) {
		r.settingConfig, err = decodeSettingConfig(reader, SetConfSnippet.Definition().Path, false)
		if err == nil {
			r.configError = settingConfigError(json.Unmarshal(r.raw, &r.SettingSnpt))
		}
		return
	}
	SetBazaar.decodeRequest = func(reader io.Reader) (r SetBazaarRequest, err error) {
		r.settingConfig, err = decodeSettingConfig(reader, SetBazaar.Definition().Path, true)
		if err == nil {
			r.configError = settingConfigError(json.Unmarshal(r.raw, &r.SettingBazaar))
		}
		return
	}
	SetAI.decodeRequest = func(reader io.Reader) (r SetAIRequest, err error) {
		r.settingConfig, err = decodeSettingConfig(reader, SetAI.Definition().Path, false)
		if err == nil {
			r.configError = settingConfigError(json.Unmarshal(r.raw, &r.SettingAI))
		}
		return
	}
	SetSecrets.decodeRequest = func(reader io.Reader) (r SetSecretsRequest, err error) {
		r.settingConfig, err = decodeSettingConfig(reader, SetSecrets.Definition().Path, false)
		if err == nil {
			r.configError = settingConfigError(json.Unmarshal(r.raw, &r.SettingSecrets))
		}
		return
	}
	SetVariables.decodeRequest = func(reader io.Reader) (r SetVariablesRequest, err error) {
		r.settingConfig, err = decodeSettingConfig(reader, SetVariables.Definition().Path, false)
		if err == nil {
			r.configError = settingConfigError(json.Unmarshal(r.raw, &r.SettingVariables))
		}
		return
	}
	SetFlashcard.decodeRequest = func(reader io.Reader) (r SetFlashcardRequest, err error) {
		r.settingConfig, err = decodeSettingConfig(reader, SetFlashcard.Definition().Path, false)
		if err == nil {
			r.configError = settingConfigError(json.Unmarshal(r.raw, &r.SettingFlashcard))
		}
		return
	}
	SetEditor.decodeRequest = func(reader io.Reader) (r SetEditorRequest, err error) {
		r.settingConfig, err = decodeSettingConfig(reader, SetEditor.Definition().Path, false)
		if err == nil {
			r.configError = settingConfigError(json.Unmarshal(r.raw, &r.SettingEditor))
		}
		return
	}
	SetExport.decodeRequest = func(reader io.Reader) (r SetExportRequest, err error) {
		r.settingConfig, err = decodeSettingConfig(reader, SetExport.Definition().Path, false)
		if err == nil {
			r.configError = settingConfigError(json.Unmarshal(r.raw, &r.SettingExport))
		}
		return
	}
	SetFiletree.decodeRequest = func(reader io.Reader) (r SetFiletreeRequest, err error) {
		r.settingConfig, err = decodeSettingConfig(reader, SetFiletree.Definition().Path, false)
		if err == nil {
			r.configError = settingConfigError(json.Unmarshal(r.raw, &r.SettingFileTree))
		}
		return
	}
	SetSearch.decodeRequest = func(reader io.Reader) (r SetSearchRequest, err error) {
		r.settingConfig, err = decodeSettingConfig(reader, SetSearch.Definition().Path, false)
		if err == nil {
			r.configError = settingConfigError(json.Unmarshal(r.raw, &r.SettingSearch))
		}
		return
	}
	SetAppearance.decodeRequest = func(reader io.Reader) (r SetAppearanceRequest, err error) {
		r.settingConfig, err = decodeSettingConfig(reader, SetAppearance.Definition().Path, false)
		if err == nil {
			r.configError = settingConfigError(json.Unmarshal(r.raw, &r.SettingAppearance))
		}
		return
	}
	SetEntryVisibility.decodeRequest = func(reader io.Reader) (r SetEntryVisibilityRequest, err error) {
		r.settingConfig, err = decodeSettingConfig(reader, SetEntryVisibility.Definition().Path, false)
		if err == nil {
			r.configError = settingConfigError(json.Unmarshal(r.raw, &r.SettingEntryVisibility))
		}
		return
	}
	SetPublish.decodeRequest = func(reader io.Reader) (r SetPublishRequest, err error) {
		r.settingConfig, err = decodeSettingConfig(reader, SetPublish.Definition().Path, false)
		if err == nil {
			r.configError = settingConfigError(json.Unmarshal(r.raw, &r.SettingPublish))
		}
		return
	}
}
