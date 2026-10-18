package api

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractSettingNormalization(t *testing.T) {
	previous, readOnly, markdown := model.Conf, util.ReadOnly, util.MarkdownSettings.Load()
	singleLine, largeFile := util.UseSingleLineSave.Load(), util.LargeFileWarningSize.Load()
	util.ReadOnly = true
	t.Cleanup(func() {
		{
			derivedValue0, derivedValue1, derivedValue2 := previous, readOnly, markdown
			model.Conf = derivedValue0
			util.ReadOnly = derivedValue1
			util.MarkdownSettings.Store(derivedValue2)
		}
		{
			derivedValue0, derivedValue1 := singleLine, largeFile
			util.UseSingleLineSave.Store(derivedValue0)
			util.LargeFileWarningSize.Store(derivedValue1)
		}
	})
	model.Conf = model.NewAppConf()
	model.Conf.Editor.Store(conf.NewEditor())
	model.Conf.Editor.Load().DisplayImgName = true
	model.Conf.FileTree.Store(conf.NewFileTree())
	model.Conf.Flashcard.Store(conf.NewFlashcard())
	for _, length := range []int{0, 1, 63, 95, 5120, 6000} {
		body, _ := json.Marshal(map[string]int{"blockRefDynamicAnchorTextMaxLen": length, "fontSize": 100})
		code, message, _ := settingContractRequest(t, "setEditor", setEditor, string(body))
		if code != 0 {
			t.Fatal(message)
		}
		editor := *model.Conf.Editor.Load()
		if !reflect.DeepEqual(&editor, conf.NormalizeEditor(model.Conf.Editor.Load())) || !editor.DisplayImgName || editor.FontSize != 16 {
			t.Fatal("saved editor differs from startup normalization or lost omitted fields")
		}
		want := length
		if want < 1 {
			want = 64
		}
		if want > 5120 {
			want = 5120
		}
		if editor.BlockRefDynamicAnchorTextMaxLen != want {
			t.Fatalf("anchor length %d became %d", length, editor.BlockRefDynamicAnchorTextMaxLen)
		}
	}
	code, message, _ := settingContractRequest(t, "setFlashcard", setFlashcard, `{"weights":"invalid","requestRetention":2,"maximumInterval":-1}`)
	if code != 0 || model.Conf.Flashcard.Load().Weights != conf.DefaultFSRSWeights() || model.Conf.Flashcard.Load().NewCardLimit != conf.NewFlashcard().NewCardLimit {
		t.Fatalf("flashcard normalization failed: %s", message)
	}
	code, message, _ = settingContractRequest(t, "setFiletree", setFiletree, `{"maxListCount":0,"largeFileWarningSize":1,"shorthandSavePath":"notes"}`)
	if code != 0 || model.Conf.FileTree.Load().MaxListCount != 512 || util.LargeFileWarningSize.Load() != 8 || model.Conf.FileTree.Load().ShorthandSavePath != "/notes" {
		t.Fatalf("file tree normalization failed: %s", message)
	}
}

func TestAPIContractImportedSettingsNormalization(t *testing.T) {
	previous, temp, readOnly := model.Conf, util.TempDir, util.ReadOnly
	util.TempDir, util.ReadOnly = t.TempDir(), true
	t.Cleanup(func() { model.Conf, util.TempDir, util.ReadOnly = previous, temp, readOnly })
	for _, entry := range []struct {
		payload                   string
		maxListCount, searchLimit int
	}{
		{`{"editor":{"blockRefDynamicAnchorTextMaxLen":1,"fontSize":100},"export":{"blockRefMode":0},"fileTree":{"maxListCount":0},"search":{"limit":0},"flashcard":{"weights":"invalid"}}`, 512, 64},
		{`{"editor":null,"export":null,"fileTree":null,"search":null,"flashcard":null}`, 512, 64},
		{`{"export":{"blockRefMode":1}}`, 512, 64},
		{`{"export":{"blockRefMode":5}}`, 512, 64},
		{`{"editor":{"backlinkGlobalSort":7,"codeTabSpaces":5},"export":{"blockRefMode":0,"blockEmbedMode":9,"fileAnnotationRefMode":-5},"fileTree":{"maxListCount":1000000},"search":{"limit":1000000},"flashcard":{"reviewMode":7}}`, 10240, 10240},
	} {
		model.Conf = model.NewAppConf()
		originalSync := model.Conf.Sync.Load()
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		part, err := writer.CreateFormFile("file", "settings.json")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = part.Write([]byte(entry.payload)); err != nil {
			t.Fatal(err)
		}
		if err = writer.Close(); err != nil {
			t.Fatal(err)
		}
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest("POST", "/api/system/importConf", &body)
		context.Request.Header.Set("Content-Type", writer.FormDataContentType())
		importConf(context)
		requireAPIContract(t, "POST", "/api/system/importConf", recorder)
		var response struct {
			Code int `json:"code"`
		}
		if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
			t.Fatalf("import failed: %s (%v)", recorder.Body.String(), err)
		}
		if model.Conf.Editor.Load() == nil || model.Conf.Editor.Load().FontSize != 16 || model.Conf.Editor.Load().BlockRefDynamicAnchorTextMaxLen < 1 ||
			model.Conf.Export.Load() == nil || model.Conf.Export.Load().BlockRefMode != 4 ||
			model.Conf.FileTree.Load().MaxListCount != entry.maxListCount || model.Conf.Search.Load().Limit != entry.searchLimit ||
			model.Conf.Editor.Load().BacklinkGlobalSort != 0 || model.Conf.Editor.Load().CodeTabSpaces != 0 ||
			model.Conf.Export.Load().FileAnnotationRefMode != 0 || model.Conf.Flashcard.Load().ReviewMode != 0 ||
			model.Conf.Flashcard.Load().Weights != conf.DefaultFSRSWeights() || model.Conf.Sync.Load() != originalSync {
			t.Fatal("import did not normalize preferences or replaced sync configuration")
		}
		if entry.maxListCount == 10240 && model.Conf.Export.Load().BlockEmbedMode != 1 {
			t.Fatal("import did not restore the default block embed mode")
		}
	}
}
