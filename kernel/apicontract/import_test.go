// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

import (
	"strings"
	"testing"
)

func TestStagedImportRequestCompatibility(t *testing.T) {
	request, err := ContinueImportSY.Decode(strings.NewReader(`{"token":" token ","notebook":" box "}`))
	if err != nil || request.Token != "token" || request.Notebook != "box" {
		t.Fatalf("import trimming changed: %+v, %v", request, err)
	}
	for _, body := range []string{`{}`, `{"token":null}`, `{"token":false}`, `{"token":" "}`} {
		if _, err := CancelImportSY.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid token accepted: %s", body)
		}
	}
	for _, body := range []string{`{"token":"token"}`, `{"token":"token","notebook":null}`, `{"token":"token","notebook":" "}`} {
		if _, err := ContinueImportSY.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid notebook accepted: %s", body)
		}
	}
}

func TestDataImportContractRequiresExplicitConflictChoice(t *testing.T) {
	for _, mode := range []string{"skip", "overwrite"} {
		request, err := CommitDataImport.Decode(strings.NewReader(`{"id":" plan ","mode":"` + mode + `","password":" secret "}`))
		if err != nil || request.ID != "plan" || string(request.Mode) != mode || request.Password != "secret" {
			t.Fatalf("invalid commit decoding: %+v %v", request, err)
		}
	}
	for _, body := range []string{`{}`, `{"id":"plan"}`, `{"id":"plan","mode":"silent"}`, `{"id":"plan","mode":null}`, `{"id":"plan","mode":"skip","password":true}`} {
		if _, err := CommitDataImport.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid import choice accepted: %s", body)
		}
	}
}

func TestImportMarkdownRequestCompatibility(t *testing.T) {
	for _, flag := range []string{`true`, `false`, `null`, `"ignored"`, `1`, `{}`} {
		request, err := ImportStdMd.Decode(strings.NewReader(`{"notebook":" box ","localPath":" path ","toPath":"","skipRoot":` + flag + `}`))
		if err != nil || request.Notebook != " box " || request.LocalPath != " path " || request.ToPath != "" || request.SkipRoot != (flag == "true") {
			t.Fatalf("Markdown import compatibility changed: %+v, %v", request, err)
		}
	}
	for _, body := range []string{`{}`, `{"notebook":"box","localPath":null,"toPath":"/"}`, `{"notebook":"box","localPath":"path","toPath":false}`} {
		if _, err := ImportStdMd.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid import fields accepted: %s", body)
		}
	}
}
