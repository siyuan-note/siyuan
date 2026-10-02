package api

import (
	archivezip "archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractSystemExportSecrets(t *testing.T) {
	previousConf, previousTemp := model.Conf, util.TempDir
	t.Cleanup(func() { model.Conf, util.TempDir = previousConf, previousTemp })
	util.TempDir = t.TempDir()
	for _, populated := range []bool{true, false} {
		model.Conf = model.NewAppConf()
		if populated {
			model.Conf.AI = conf.NewAI()
			model.Conf.AI.Decision.APIKey = "export-test-decision-secret"
			model.Conf.OIDC = conf.NewOIDC()
			model.Conf.OIDC.ClientID = "test-client"
			model.Conf.OIDC.ClientSecret = "export-test-oidc-secret"
		} else {
			model.Conf.AI = &conf.AI{}
			model.Conf.OIDC = nil
		}
		before, err := json.Marshal(model.Conf)
		if err != nil {
			t.Fatal(err)
		}
		recorder := systemContractRequest(t, http.MethodPost, "exportConf", exportConf, nil)
		var response struct {
			Code int                              `json:"code"`
			Data apicontract.SystemExportConfData `json:"data"`
		}
		if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
			t.Fatalf("export failed: %s (%v)", recorder.Body.String(), err)
		}
		archive, err := archivezip.OpenReader(filepath.Join(util.TempDir, "export", response.Data.Name+".zip"))
		if err != nil {
			t.Fatal(err)
		}
		defer archive.Close()
		if len(archive.File) != 1 || archive.File[0].Name != response.Data.Name {
			t.Fatal("unexpected configuration archive contents")
		}
		entry, err := archive.File[0].Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(entry)
		entry.Close()
		if err != nil {
			t.Fatal(err)
		}
		var exported model.AppConf
		if err = json.Unmarshal(data, &exported); err != nil {
			t.Fatal(err)
		}
		if populated {
			if exported.AI.Decision.APIKey != "" || exported.OIDC.ClientSecret != "" ||
				bytes.Contains(data, []byte("export-test-")) {
				t.Fatal("export retained secrets")
			}
			if exported.AI.Decision.Name != model.Conf.AI.Decision.Name || exported.OIDC.ClientID != "test-client" {
				t.Fatal("export lost non-secret settings")
			}
		}
		after, err := json.Marshal(model.Conf)
		if err != nil || !bytes.Equal(before, after) {
			t.Fatal("export modified the active configuration")
		}
		archive.Close()
	}
}
