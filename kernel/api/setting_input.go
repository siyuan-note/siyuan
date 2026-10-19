package api

import (
	"bytes"
	"encoding/json"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/model"
)

// mergeSettingPatch 对设置写入统一执行输入迁移，再合并当前配置段。
// 旧接口与 patch 接口共用同一套迁移，避免两条入口对旧客户端输入的处理不一致。
func mergeSettingPatch(namespace string, patch []byte) ([]byte, error) {
	var err error
	switch namespace {
	case "ai":
		patch, err = migrateDecisionSettingPatch(patch)
	case "editor":
		patch, err = migrateEditorSettingPatch(patch)
	}
	if err != nil {
		return nil, err
	}
	return model.ConfSectionPatchJSON(namespace, patch)
}

// migrateDecisionSettingPatch 把旧客户端的平铺供应商字段迁移到 profiles.typesafe。
// 合并会保留段内已存在的 profiles，平铺字段若不迁移就会被默认配置遮蔽。
func migrateDecisionSettingPatch(patch []byte) ([]byte, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(patch, &fields); err != nil {
		return nil, err
	}
	decisionKey := ""
	for key := range fields {
		// 同时出现两种写法时取精确的 decision，保证结果与键顺序无关。
		if strings.EqualFold(key, "decision") && ("" == decisionKey || "decision" == key) {
			decisionKey = key
		}
	}
	if "" == decisionKey {
		return patch, nil
	}
	var decision map[string]json.RawMessage
	if json.Unmarshal(fields[decisionKey], &decision) != nil || nil == decision {
		return patch, nil
	}

	var legacy struct {
		Profiles json.RawMessage `json:"profiles"`
		Endpoint json.RawMessage `json:"endpoint"`
		APIKey   json.RawMessage `json:"apiKey"`
		Name     json.RawMessage `json:"name"`
		Timeout  json.RawMessage `json:"timeout"`
	}
	if err := json.Unmarshal(fields[decisionKey], &legacy); err != nil {
		return nil, err
	}
	// 显式提交 profiles 时保留输入；null 先清除旧配置，再由 Decision.Normalize 从平铺字段重建。
	// 不能把 null 改成对象，否则递归合并会保留旧凭据和端点。
	if len(legacy.Profiles) > 0 {
		return patch, nil
	}

	profile := map[string]json.RawMessage{}
	for _, field := range []struct {
		name  string
		value json.RawMessage
	}{{"endpoint", legacy.Endpoint}, {"apiKey", legacy.APIKey}, {"name", legacy.Name}, {"timeout", legacy.Timeout}} {
		if 0 == len(field.value) {
			continue
		}
		// 旧设置字段允许 null，保持清空密钥和恢复默认参数的既有语义。
		value := field.value
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			value = json.RawMessage(`""`)
			if "timeout" == field.name {
				value = json.RawMessage(`0`)
			}
		}
		profile[field.name] = value
		for key := range decision {
			if strings.EqualFold(key, field.name) {
				delete(decision, key)
			}
		}
	}
	if 0 == len(profile) {
		return patch, nil
	}

	profiles, err := json.Marshal(map[string]map[string]json.RawMessage{"typesafe": profile})
	if err != nil {
		return nil, err
	}
	decision["profiles"] = profiles
	for key := range fields {
		if strings.EqualFold(key, "decision") {
			delete(fields, key)
		}
	}
	fields["decision"], err = json.Marshal(decision)
	if err != nil {
		return nil, err
	}
	return json.Marshal(fields)
}

// migrateEditorSettingPatch 在旧客户端只提交首选字体时重建字体列表。
// 合并后的配置段始终带有 fontFamilies，而规范化会用该列表反向覆盖首选字体，
// 因此这里清空列表让规范化按新的首选字体重建；显式提交的字体列表优先。
func migrateEditorSettingPatch(patch []byte) ([]byte, error) {
	var legacy struct {
		FontFamilies      json.RawMessage `json:"fontFamilies"`
		FontFamily        json.RawMessage `json:"fontFamily"`
		FontWeight        json.RawMessage `json:"fontWeight"`
		FontFamilyDisplay json.RawMessage `json:"fontFamilyDisplay"`
	}
	if err := json.Unmarshal(patch, &legacy); err != nil {
		return nil, err
	}
	// 提交非空字体列表时以客户端为准；其余情况都按首选字体重建，避免保留与字体不符的展示名。
	if (len(legacy.FontFamilies) > 0 && !bytes.Equal(bytes.TrimSpace(legacy.FontFamilies), []byte("null"))) ||
		(0 == len(legacy.FontFamily) && 0 == len(legacy.FontWeight)) || nil == model.Conf {
		return patch, nil
	}
	current := model.Conf.Editor.Load()
	if nil == current {
		return patch, nil
	}
	// 缺失时沿用当前值，显式 null 解析为零值，与规范化对空首选字体的处理一致。
	family, weight := current.FontFamily, float64(current.FontWeight)
	if len(legacy.FontFamily) > 0 {
		family = ""
		if err := json.Unmarshal(legacy.FontFamily, &family); err != nil {
			return patch, nil
		}
	}
	if len(legacy.FontWeight) > 0 {
		weight = 0
		if err := json.Unmarshal(legacy.FontWeight, &weight); err != nil {
			return patch, nil
		}
	}
	if family == current.FontFamily && weight == float64(current.FontWeight) {
		return patch, nil
	}

	var fields map[string]json.RawMessage
	if err := json.Unmarshal(patch, &fields); err != nil {
		return nil, err
	}
	fields["fontFamilies"] = json.RawMessage(`null`)
	// 未显式提交展示名时一并清空，由规范化按新的首选字体重新推导。
	if 0 == len(legacy.FontFamilyDisplay) {
		fields["fontFamilyDisplay"] = json.RawMessage(`null`)
	}
	return json.Marshal(fields)
}
