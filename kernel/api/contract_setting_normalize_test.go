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
	previous, readOnly, markdown := model.Conf, util.ReadOnly, util.MarkdownSettings
	singleLine, largeFile := util.UseSingleLineSave, util.LargeFileWarningSize
	util.ReadOnly = true
	t.Cleanup(func() {
		model.Conf, util.ReadOnly, util.MarkdownSettings = previous, readOnly, markdown
		util.UseSingleLineSave, util.LargeFileWarningSize = singleLine, largeFile
	})
	model.Conf = model.NewAppConf()
	model.Conf.Editor = conf.NewEditor()
	model.Conf.Editor.DisplayImgName = true
	model.Conf.FileTree = conf.NewFileTree()
	model.Conf.Flashcard = conf.NewFlashcard()
	for _, length := range []int{0, 1, 63, 95, 5120, 6000} {
		body, _ := json.Marshal(map[string]int{"blockRefDynamicAnchorTextMaxLen": length, "fontSize": 100})
		code, message, _ := settingContractRequest(t, "setEditor", setEditor, string(body))
		if code != 0 {
			t.Fatal(message)
		}
		editor := *model.Conf.Editor
		if !reflect.DeepEqual(&editor, conf.NormalizeEditor(model.Conf.Editor)) || !editor.DisplayImgName || editor.FontSize != 16 {
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
	if code != 0 || model.Conf.Flashcard.Weights != conf.DefaultFSRSWeights() || model.Conf.Flashcard.NewCardLimit != 0 {
		t.Fatalf("flashcard normalization failed: %s", message)
	}
	code, message, _ = settingContractRequest(t, "setFiletree", setFiletree, `{"maxListCount":0,"largeFileWarningSize":1,"shorthandSavePath":"notes"}`)
	if code != 0 || model.Conf.FileTree.MaxListCount != 512 || util.LargeFileWarningSize != 8 || model.Conf.FileTree.ShorthandSavePath != "/notes" {
		t.Fatalf("file tree normalization failed: %s", message)
	}
}

func TestAPIContractImportedSettingsNormalization(t *testing.T) {
	previous, temp, readOnly := model.Conf, util.TempDir, util.ReadOnly
	util.TempDir, util.ReadOnly = t.TempDir(), true
	t.Cleanup(func() { model.Conf, util.TempDir, util.ReadOnly = previous, temp, readOnly })
	for _, payload := range []string{
		`{"editor":{"blockRefDynamicAnchorTextMaxLen":1,"fontSize":100},"fileTree":{"maxListCount":0},"search":{"limit":0},"flashcard":{"weights":"invalid"}}`,
		`{"editor":null,"fileTree":null,"search":null,"flashcard":null}`,
	} {
		model.Conf = model.NewAppConf()
		originalSync := model.Conf.Sync
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		part, err := writer.CreateFormFile("file", "settings.json")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = part.Write([]byte(payload)); err != nil {
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
		if model.Conf.Editor == nil || model.Conf.Editor.FontSize != 16 || model.Conf.Editor.BlockRefDynamicAnchorTextMaxLen < 1 ||
			model.Conf.FileTree.MaxListCount != 512 || model.Conf.Search.Limit != 64 ||
			model.Conf.Flashcard.Weights != conf.DefaultFSRSWeights() || model.Conf.Sync != originalSync {
			t.Fatal("import did not normalize preferences or replaced sync configuration")
		}
	}
}
