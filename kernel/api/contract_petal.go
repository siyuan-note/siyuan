package api

import (
	"encoding/json"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func petalContract(value *model.Petal) (*apicontract.Petal, error) {
	if value == nil {
		return nil, nil
	}
	// 插件自行定义语言包的键和值，保留嵌套 JSON 内容。
	data, err := json.Marshal(value.I18n)
	if err != nil {
		return nil, err
	}
	var i18n map[string]apicontract.JSONValue
	if err = json.Unmarshal(data, &i18n); err != nil {
		return nil, err
	}
	return &apicontract.Petal{
		Name: value.Name, DisplayName: value.DisplayName, Version: value.Version,
		Enabled: value.Enabled, Incompatible: value.Incompatible, DisabledInPublish: value.DisabledInPublish,
		UserDisabledInPublish: value.UserDisabledInPublish, DisallowInstall: value.DisallowInstall,
		JS: value.JS, CSS: value.CSS, I18n: i18n,
		Kernel: apicontract.KernelPetal{JS: value.Kernel.JS, Existed: value.Kernel.Existed, Incompatible: value.Kernel.Incompatible},
	}, nil
}
