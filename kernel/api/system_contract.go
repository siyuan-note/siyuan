package api

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// systemConfPayload 在脱敏完成后转换完整配置，任意 JSON 仅出现在布局和快捷键字段。
func systemConfPayload(value *model.AppConf) (result *apicontract.SystemAppConf, err error) {
	encoded, err := json.Marshal(value)
	if err == nil {
		err = json.Unmarshal(encoded, &result)
	}
	return
}

func systemOnboardingPayload(value *conf.Onboarding) *apicontract.SystemOnboarding {
	if value == nil {
		return nil
	}
	return &apicontract.SystemOnboarding{State: value.State, NewUser: value.NewUser, Dismissed: value.Dismissed, NotebookID: value.NotebookID, DocumentID: value.DocumentID}
}

func systemFontPayload(value *util.Font) *apicontract.SystemFont {
	if value == nil {
		return nil
	}
	return &apicontract.SystemFont{Family: value.Family, Weight: value.Weight, DisplayName: value.DisplayName, Aliases: value.Aliases, Spacing: value.Spacing}
}
func systemFontsPayload(values []*util.Font) []*apicontract.SystemFont {
	if values == nil {
		return nil
	}
	result := make([]*apicontract.SystemFont, len(values))
	for i, value := range values {
		result[i] = systemFontPayload(value)
	}
	return result
}
func systemCustomFontPayload(value *util.CustomFont) *apicontract.SystemCustomFont {
	if value == nil {
		return nil
	}
	return &apicontract.SystemCustomFont{ID: value.ID, Family: value.Family, Weight: value.Weight, DisplayName: value.DisplayName, Aliases: value.Aliases, Spacing: value.Spacing, URL: value.URL}
}
func systemCustomFontsPayload(values []*util.CustomFont) []*apicontract.SystemCustomFont {
	if values == nil {
		return nil
	}
	result := make([]*apicontract.SystemCustomFont, len(values))
	for i, value := range values {
		result[i] = systemCustomFontPayload(value)
	}
	return result
}

func systemUILayoutPreflight(c *gin.Context) *apicontract.Response[apicontract.Null] {
	if !util.ReadOnly {
		return nil
	}
	ret := apicontract.Success(apicontract.Null{})
	return &ret
}
func systemAccessAuthPreflight(c *gin.Context) *apicontract.Response[apicontract.Null] {
	if util.ContainerDocker != util.Container {
		return nil
	}
	ret := apicontract.Failure[apicontract.Null](-1, "access auth code cannot be set in Docker container")
	return &ret
}
func systemImportFontPreflight(c *gin.Context) *apicontract.Response[*apicontract.SystemCustomFont] {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, util.MaxCustomFontSize+1024*1024)
	return nil
}
