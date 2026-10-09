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
	previousConf, previousReadOnly, previousMarkdown := model.Conf, util.ReadOnly, util.MarkdownSettings
	model.Conf = model.NewAppConf()
	model.Conf.Editor = conf.NewEditor()
	util.ReadOnly = true
	t.Cleanup(func() {
		model.Conf, util.ReadOnly, util.MarkdownSettings = previousConf, previousReadOnly, previousMarkdown
	})
	fontSize := model.Conf.Editor.FontSize
	var group sync.WaitGroup
	for _, body := range []string{`{"editor":{"displayImgName":true}}`, `{"editor":{"displayImgAlt":true}}`} {
		group.Add(1)
		go func() {
			defer group.Done()
			code, message, _ := settingContractRequest(t, "patch", patchSetting, body)
			if code != 0 {
				t.Errorf("patch failed: %d %s", code, message)
			}
		}()
	}
	group.Wait()
	if !model.Conf.Editor.DisplayImgName || !model.Conf.Editor.DisplayImgAlt || model.Conf.Editor.FontSize != fontSize {
		t.Fatal("independent settings updates must preserve each other and omitted fields")
	}
	before := settingRevision
	code, _, _ := settingContractRequest(t, "patch", patchSetting, `{"editor":{"fontSize":"bad"}}`)
	if code == 0 || settingRevision != before || model.Conf.Editor.FontSize != fontSize {
		t.Fatal("failed patches must not modify configuration or publish a change")
	}
}

func TestAPIContractSettingPatchRecursiveMerge(t *testing.T) {
	merged, err := mergeSettingJSON([]byte(`{"object":{"left":1,"right":2},"array":[1,2],"keep":true}`),
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
