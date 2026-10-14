package api

import (
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

// settingContractFieldExceptions 登记契约与配置字段不一致的位置及原因，键为「契约类型.字段路径」。
var settingContractFieldExceptions = map[string]string{}

// I2：契约类型的 json 键集合与配置段一致，新增配置字段漏抄到契约时测试失败。
func TestSettingContractFieldsMatchConf(t *testing.T) {
	pairs := []struct {
		contract, config any
	}{
		{apicontract.SettingEditor{}, conf.Editor{}},
		{apicontract.SettingFileTree{}, conf.FileTree{}},
		{apicontract.SettingExport{}, conf.Export{}},
		{apicontract.SettingSearch{}, conf.Search{}},
		{apicontract.SettingFlashcard{}, conf.Flashcard{}},
		{apicontract.SettingAppearance{}, conf.Appearance{}},
		{apicontract.SettingAI{}, conf.AI{}},
		{apicontract.SettingOCR{}, conf.OCR{}},
		{apicontract.SettingSecrets{}, conf.Secrets{}},
		{apicontract.SettingVariables{}, conf.Variables{}},
		{apicontract.SettingBazaar{}, conf.Bazaar{}},
		{apicontract.SettingPublish{}, conf.Publish{}},
		{apicontract.SettingSnpt{}, conf.Snpt{}},
		{apicontract.SettingEntryVisibility{}, conf.EntryVisibility{}},
		{apicontract.SystemSync{}, conf.Sync{}},
		{apicontract.SystemSystem{}, conf.System{}},
		{apicontract.SystemRepo{}, conf.Repo{}},
		{apicontract.SystemAPI{}, conf.API{}},
		{apicontract.SystemStat{}, conf.Stat{}},
		{apicontract.SystemTag{}, conf.Tag{}},
		{apicontract.SystemGraph{}, conf.Graph{}},
		{apicontract.SystemNotebookCrypto{}, conf.NotebookCrypto{}},
		{apicontract.SystemOIDC{}, conf.OIDC{}},
		{apicontract.SystemOnboarding{}, conf.Onboarding{}},
	}
	var problems []string
	used := map[string]bool{}
	for _, pair := range pairs {
		contractType := reflect.TypeOf(pair.contract)
		compareJSONFields(contractType.Name(), contractType, reflect.TypeOf(pair.config), map[reflect.Type]bool{}, func(path, problem string) {
			if _, ok := settingContractFieldExceptions[path]; ok {
				used[path] = true
				return
			}
			problems = append(problems, path+": "+problem)
		})
	}
	for path := range settingContractFieldExceptions {
		if !used[path] {
			problems = append(problems, path+": stale exception")
		}
	}
	sort.Strings(problems)
	if len(problems) > 0 {
		t.Fatalf("setting contracts differ from configuration:\n%s", strings.Join(problems, "\n"))
	}
}

func compareJSONFields(path string, contract, config reflect.Type, visited map[reflect.Type]bool, report func(path, problem string)) {
	contract, config = structType(contract), structType(config)
	if contract == nil || config == nil {
		return
	}
	if visited[contract] {
		return
	}
	visited[contract] = true
	contractFields, configFields := jsonFields(contract), jsonFields(config)
	for name, field := range configFields {
		other, ok := contractFields[name]
		if !ok {
			report(path+"."+name, "missing in contract")
			continue
		}
		compareJSONFields(path+"."+name, other, field, visited, report)
	}
	for name := range contractFields {
		if _, ok := configFields[name]; !ok {
			report(path+"."+name, "missing in configuration")
		}
	}
}

// structType 解开指针、切片、数组和映射值，返回结构体类型；其他类型返回 nil。
func structType(typ reflect.Type) reflect.Type {
	for typ != nil {
		switch typ.Kind() {
		case reflect.Pointer, reflect.Slice, reflect.Array, reflect.Map:
			typ = typ.Elem()
		case reflect.Struct:
			return typ
		default:
			return nil
		}
	}
	return nil
}

func jsonFields(typ reflect.Type) map[string]reflect.Type {
	ret := map[string]reflect.Type{}
	for i := 0; i < typ.NumField(); i++ {
		field := typ.Field(i)
		if !field.IsExported() {
			continue
		}
		name, _, _ := strings.Cut(field.Tag.Get("json"), ",")
		if name == "-" {
			continue
		}
		if field.Anonymous && name == "" {
			for embedded, embeddedType := range jsonFields(structType(field.Type)) {
				ret[embedded] = embeddedType
			}
			continue
		}
		if name == "" {
			name = field.Name
		}
		ret[name] = field.Type
	}
	return ret
}
