package apicontract

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

// settingConfig 保留配置合并所需的键存在性和数字归一化结果，公开字段仍由具体配置结构声明。
type settingConfig struct {
	raw         json.RawMessage
	fields      map[string]json.RawMessage
	configError error
}

func (r settingConfig) ConfigJSON() []byte        { return append([]byte(nil), r.raw...) }
func (r settingConfig) ConfigError() error        { return r.configError }
func (r settingConfig) HasField(name string) bool { _, ok := r.fields[name]; return ok }

func decodeSettingConfig(reader io.Reader, path string, removeApp bool) (r settingConfig, err error) {
	var raw json.RawMessage
	err = json.NewDecoder(reader).Decode(&raw)
	if err == nil {
		r.fields, err = legacyJSONValue[map[string]json.RawMessage](raw)
	}
	if err != nil {
		if errors.Is(err, io.EOF) {
			err = errors.New("the request body is empty or truncated (EOF)")
		}
		detail := strings.ReplaceAll(err.Error(), "map[string]json.RawMessage", "map[string]interface {}")
		err = fmt.Errorf("Parses request [%s] failed: %s", path, detail)
		return
	}
	if removeApp {
		delete(r.fields, "app")
	}
	r.raw, err = json.Marshal(r.fields)
	return
}

func settingConfigError(err error) error {
	if err == nil {
		return nil
	}
	message := strings.ReplaceAll(err.Error(), "apicontract.Setting", "conf.")
	message = strings.ReplaceAll(message, "field Setting", "field ")
	for _, name := range []string{"Markdown", "StatusBar", "Notifications"} {
		message = strings.ReplaceAll(message, "conf."+name, "util."+name)
	}
	return errors.New(message)
}

type SettingPublishData struct {
	Port    uint16          `json:"port"`
	Publish *SettingPublish `json:"publish"`
}
type SettingBootAppearanceCurrent struct {
	Provider   string `json:"provider"`
	Appearance string `json:"appearance"`
}
type SettingBootAppearancesData struct {
	Appearances []*SettingBootAppearance     `json:"appearances"`
	Current     SettingBootAppearanceCurrent `json:"current"`
}
type SettingBootAppearanceRequest struct {
	Provider   string `json:"provider" api:"optional,nullable"`
	Appearance string `json:"appearance" api:"optional,nullable"`
}
type SettingPetalDisabledRequest struct {
	PetalDisabled bool `json:"petalDisabled"`
}
type SettingPetalDisabledData struct {
	UninstallPlugins    []string `json:"uninstallPlugins"`
	UnloadPlugins       []string `json:"unloadPlugins"`
	ReloadPlugins       []string `json:"reloadPlugins"`
	DataChangePlugins   []string `json:"dataChangePlugins"`
	GlobalPetalEnabled  bool     `json:"globalPetalEnabled"`
	GlobalPetalDisabled bool     `json:"globalPetalDisabled"`
	GlobalPetalRevision uint64   `json:"globalPetalRevision"`
	GlobalPetalChanged  bool     `json:"globalPetalChanged"`
}
type SettingKeymapRequest struct {
	Data map[string]JSONValue `json:"data" api:"optional,nullable"`
}
type SettingIconRequest struct {
	Icon string `json:"icon" api:"trim"`
}
type SettingCloudUserRequest struct {
	Token string `json:"token" api:"optional,nullable"`
}
type SettingLogin2faRequest struct {
	Token string `json:"token"`
	Code  string `json:"code"`
}
type SettingEmojiRequest struct {
	Emoji []string `json:"emoji"`
}
type SettingThemeRequest struct {
	Theme          string    `json:"theme" api:"optional,nullable"`
	Modes          []float64 `json:"modes" api:"optional,nullable"`
	AppearanceMode string    `json:"appearanceMode" api:"optional,nullable"`
}

func init() {
	SetBazaarPetalDisabled.decodeRequest = func(reader io.Reader) (r SettingPetalDisabledRequest, err error) {
		fields, err := blockRequestFields(reader, SetBazaarPetalDisabled.Definition().Path)
		if err != nil {
			return r, err
		}
		r.PetalDisabled, err = legacyField[bool](fields, "petalDisabled", "Boolean", true)
		if err != nil {
			err = errors.New("invalid petalDisabled")
		}
		return
	}
	SetTheme.decodeRequest = func(reader io.Reader) (r SettingThemeRequest, err error) {
		fields, err := blockRequestFields(reader, SetTheme.Definition().Path)
		if err != nil {
			return r, err
		}
		if r.Theme, err = legacyField[string](fields, "theme", "String", false); err != nil {
			return
		}
		modes, err := legacyField[[]json.RawMessage](fields, "modes", "Array", false)
		if err != nil {
			return r, err
		}
		if r.AppearanceMode, err = legacyField[string](fields, "appearanceMode", "String", false); err != nil {
			return
		}
		r.Theme, r.AppearanceMode = strings.TrimSpace(r.Theme), strings.TrimSpace(r.AppearanceMode)
		r.Modes = make([]float64, 0, 2)
		if r.Theme == "" {
			return
		}
		for _, raw := range modes {
			var value float64
			if bytes.Equal(raw, []byte("null")) || json.Unmarshal(raw, &value) != nil {
				break
			}
			if mode := int(value); mode != 0 && mode != 1 {
				break
			}
			r.Modes = append(r.Modes, value)
		}
		if len(r.Modes) == 0 {
			err = errors.New("[modes] is required ([0] for light, [1] for dark, [0,1] for both)")
		}
		return
	}
}
