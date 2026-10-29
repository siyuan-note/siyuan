// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"reflect"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestAPIContractDocumentTargetPatchAndLegacyReads(t *testing.T) {
	boxID := documentPathAPIWorkspace(t)
	box := model.Conf.Box(boxID)
	value := box.GetConf()
	target := &conf.DocumentTarget{Version: 2, Notebook: boxID, Anchor: conf.DocumentTargetAnchor{Kind: "notebookRoot"},
		Parents: []string{}, Title: "Target", OnMissingParent: "create"}
	value.DocCreateTarget, value.RefCreateTarget = target, target
	if err := box.SaveConf(value); err != nil {
		t.Fatal(err)
	}
	for _, endpoint := range []struct {
		path    string
		handler gin.HandlerFunc
	}{
		{"/api/filetree/getDocCreateSavePath", getDocCreateSavePath},
		{"/api/filetree/getRefCreateSavePath", getRefCreateSavePath},
	} {
		response := documentPathAPIRequest(t, endpoint.path, endpoint.handler, map[string]string{"notebook": boxID})
		if !bytes.Contains(response, []byte(`"reason":"structuredTemplateRequired"`)) {
			t.Fatalf("legacy endpoint exposed an obsolete path: %s", response)
		}
	}
	patch := func(fields map[string]interface{}) []byte {
		return documentPathAPIRequest(t, "/api/notebook/setNotebookConf", setNotebookConf,
			map[string]interface{}{"notebook": boxID, "conf": fields})
	}
	if response := patch(map[string]interface{}{"name": "Renamed"}); !bytes.Contains(response, []byte(`"code":0`)) || box.GetConf().DocCreateTarget == nil {
		t.Fatalf("omitted target was cleared: %s", response)
	}
	if response := patch(map[string]interface{}{"docCreateSavePath": "/Changed"}); !bytes.Contains(response, []byte(`"code":-1`)) {
		t.Fatalf("legacy path silently replaced a structured target: %s", response)
	}
	if response := patch(map[string]interface{}{"docCreateTarget": map[string]interface{}{"version": 2, "futureField": true}}); !bytes.Contains(response, []byte(`"code":-1`)) {
		t.Fatalf("unknown structured field was accepted: %s", response)
	}
	if response := patch(map[string]interface{}{"docCreateTarget": nil}); !bytes.Contains(response, []byte(`"code":0`)) ||
		box.GetConf().DocCreateTarget != nil || box.GetConf().RefCreateTarget == nil {
		t.Fatalf("explicit target removal did not stay scoped: %s", response)
	}
	if response := patch(map[string]interface{}{"docCreateTarget": target}); !bytes.Contains(response, []byte(`"code":0`)) || !reflect.DeepEqual(box.GetConf().DocCreateTarget, target) {
		t.Fatalf("default mode did not persist the structured target: %s", response)
	}
}
