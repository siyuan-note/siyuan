package api

import (
	"encoding/json"
	"sync"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractSettingPatchConcurrentFields(t *testing.T) {
	previousConf, previousReadOnly, previousMarkdown := model.Conf, util.ReadOnly, util.MarkdownSettings.Load()
	model.Conf = model.NewAppConf()
	model.Conf.Editor.Store(conf.NewEditor())
	util.ReadOnly = true
	t.Cleanup(func() {
		{
			derivedValue0, derivedValue1, derivedValue2 := previousConf, previousReadOnly, previousMarkdown
			model.Conf = derivedValue0
			util.ReadOnly = derivedValue1
			util.MarkdownSettings.Store(derivedValue2)
		}
	})
	fontSize := model.Conf.Editor.Load().FontSize
	var group sync.WaitGroup
	for _, body := range []string{`{"editor":{"displayImgName":true}}`, `{"editor":{"displayImgAlt":true}}`} {
		group.Go(func() {
			code, message, _ := settingContractRequest(t, "patch", patchSetting, body)
			if code != 0 {
				t.Errorf("patch failed: %d %s", code, message)
			}
		})
	}
	group.Wait()
	if !model.Conf.Editor.Load().DisplayImgName || !model.Conf.Editor.Load().DisplayImgAlt || model.Conf.Editor.Load().FontSize != fontSize {
		t.Fatal("independent settings updates must preserve each other and omitted fields")
	}
	before := model.ConfSettingRevision.Load()
	code, _, _ := settingContractRequest(t, "patch", patchSetting, `{"editor":{"fontSize":"bad"}}`)
	if code == 0 || model.ConfSettingRevision.Load() != before || model.Conf.Editor.Load().FontSize != fontSize {
		t.Fatal("failed patches must not modify configuration or publish a change")
	}
}

func TestAPIContractSettingPatchRecursiveMerge(t *testing.T) {
	merged, err := model.MergeConfJSON([]byte(`{"object":{"left":1,"right":2},"array":[1,2],"keep":true}`),
		[]byte(`{"object":{"right":3},"array":[],"null":null}`))
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]json.RawMessage
	if err = json.Unmarshal(merged, &value); err != nil {
		t.Fatal(err)
	}
	if string(value["object"]) != `{"left":1,"right":3}` || string(value["array"]) != "[]" ||
		string(value["keep"]) != "true" || string(value["null"]) != "null" {
		t.Fatalf("unexpected merged settings: %s", merged)
	}
}

func TestAPIContractSettingPatchKeymapEnvelopeAndNullableFields(t *testing.T) {
	previousConf, previousReadOnly := model.Conf, util.ReadOnly
	t.Cleanup(func() { model.Conf, util.ReadOnly = previousConf, previousReadOnly })
	model.Conf = model.NewAppConf()
	model.Conf.Editor.Store(conf.NewEditor())
	keymap := conf.Keymap{"general": map[string]any{"keep": "F1", "quoted\"key": "F2"}}
	model.Conf.Keymap.Store(&keymap)
	util.ReadOnly = true
	code, message, data := settingContractRequest(t, "patch", patchSetting,
		`{"keymap":{"general":{"quoted\"key":"Ctrl+\\","cleared":null}}}`)
	if code != 0 || string(data) != "null" {
		t.Fatalf("keymap patch failed: %d %s %s", code, message, data)
	}
	actual, _ := json.Marshal(model.Conf.Keymap.Load())
	if string(actual) != `{"general":{"cleared":null,"keep":"F1","quoted\"key":"Ctrl+\\"}}` {
		t.Fatalf("keymap section was wrapped or escaped incorrectly: %s", actual)
	}
	code, message, _ = settingContractRequest(t, "patch", patchSetting,
		`{"editor":{"fontSize":null,"displayImgAlt":null}}`)
	if code != 0 || model.Conf.Editor.Load().FontSize != conf.NewEditor().FontSize || model.Conf.Editor.Load().DisplayImgAlt {
		t.Fatalf("nullable settings were not normalized: %d %s", code, message)
	}
	before := model.Conf.Editor.Load()
	code, _, _ = settingContractRequest(t, "patch", patchSetting, `{"editor":{"markdown":{"inlineMath":"bad"}}}`)
	if code == 0 || model.Conf.Editor.Load() != before {
		t.Fatal("merged settings bypassed the nested request contract")
	}
}

func TestAPIContractSettingPatchKeymapCaseSensitiveCommands(t *testing.T) {
	previousConf, previousReadOnly := model.Conf, util.ReadOnly
	util.ReadOnly = true
	t.Cleanup(func() { model.Conf, util.ReadOnly = previousConf, previousReadOnly })
	model.Conf = model.NewAppConf()
	keymap := conf.Keymap{"plugin": map[string]any{"sample": map[string]any{"openFile": map[string]any{"custom": "F1"}}}}
	model.Conf.Keymap.Store(&keymap)
	code, message, _ := settingContractRequest(t, "patch", patchSetting,
		`{"keymap":{"plugin":{"sample":{"openfile":{"custom":"F2"}}}}}`)
	if code != 0 {
		t.Fatalf("keymap patch failed: %s", message)
	}
	actual, _ := json.Marshal(model.Conf.Keymap.Load())
	if string(actual) != `{"plugin":{"sample":{"openFile":{"custom":"F1"},"openfile":{"custom":"F2"}}}}` {
		t.Fatalf("independent command names were conflated: %s", actual)
	}
}

func TestAPIContractSettingTaskSnapshots(t *testing.T) {
	previousConf, previousTasks, previousRevision := model.Conf, settingTasks, settingTaskRevision
	model.Conf = model.NewAppConf()
	settingTasks = map[string]apicontract.SettingTask{}
	settingTaskRevision = 0
	t.Cleanup(func() {
		model.Conf, settingTasks, settingTaskRevision = previousConf, previousTasks, previousRevision
	})
	endFirst := beginSettingTask("loading")
	firstID := activeSettingTasks().Tasks[0].ID
	endSecond := beginSettingTask("loading")
	initial := activeSettingTasks()
	if len(initial.Tasks) != 2 || initial.Revision != 2 {
		t.Fatal("both concurrent tasks must appear in the snapshot")
	}
	endFirst()
	next := activeSettingTasks()
	if len(next.Tasks) != 1 || next.Revision != 3 || next.Tasks[0].ID == firstID {
		t.Fatal("ending one task must preserve the other task and advance the snapshot")
	}
	endSecond()
	if final := activeSettingTasks(); len(final.Tasks) != 0 || final.Revision != 4 {
		t.Fatal("the final snapshot must release all tasks")
	}
}
