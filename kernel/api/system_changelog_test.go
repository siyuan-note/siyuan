// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func changelogContractHandler(version string) gin.HandlerFunc {
	return contractHandler(apicontract.SystemGetChangelog, func(c *gin.Context, request apicontract.SystemChangelogRequest) apicontract.Response[apicontract.SystemChangelogData] {
		return loadChangelog(c.Request.Context(), request.Force, version)
	})
}

func TestAPIContractPrereleaseChangelogManualOnly(t *testing.T) {
	oldDir, oldConf, oldFetch := util.WorkingDir, model.Conf, getReleaseChangelog
	t.Cleanup(func() {
		util.WorkingDir, model.Conf, getReleaseChangelog = oldDir, oldConf, oldFetch
	})
	util.WorkingDir, model.Conf = t.TempDir(), model.NewAppConf()
	const version = "3.8.10-alpha.5"
	handler := changelogContractHandler(version)
	model.Conf.ShowChangelog = true
	calls := 0
	getReleaseChangelog = func(ctx context.Context, requestedVersion string) (string, error) {
		calls++
		if requestedVersion != version || ctx == nil {
			t.Fatalf("wrong version/context: %s", requestedVersion)
		}
		return "<p>Current prerelease</p>", nil
	}
	for _, body := range []string{"", "{}", `{"force":false}`} {
		recorder := systemContractRequest(t, "POST", "getChangelog", handler, strings.NewReader(body))
		var response struct {
			Code int                             `json:"code"`
			Data apicontract.SystemChangelogData `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 || response.Data.Show || calls != 0 {
			t.Fatalf("prerelease startup fetched or displayed changelog: %s, %v", recorder.Body.String(), err)
		}
	}
	recorder := systemContractRequest(t, "POST", "getChangelog", handler, strings.NewReader(`{"force":true}`))
	var response struct {
		Code int                             `json:"code"`
		Data apicontract.SystemChangelogData `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 || !response.Data.Show ||
		response.Data.Version != version || response.Data.HTML != "<p>Current prerelease</p>" || calls != 1 {
		t.Fatalf("manual prerelease changelog failed without local directory: %s, %v", recorder.Body.String(), err)
	}
	getReleaseChangelog = func(context.Context, string) (string, error) { return "", errors.New("offline") }
	stableDir := filepath.Join(util.WorkingDir, "changelogs", "v3.8.9")
	if err := os.MkdirAll(stableDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stableDir, "v3.8.9.md"), []byte("Older stable changes"), 0600); err != nil {
		t.Fatal(err)
	}
	recorder = systemContractRequest(t, "POST", "getChangelog", handler, strings.NewReader(`{"force":true}`))
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 {
		t.Fatalf("network failure was not reported: %s, %v", recorder.Body.String(), err)
	}
}

func TestAPIContractStableChangelogStaysLocal(t *testing.T) {
	oldDir, oldConf, oldFetch := util.WorkingDir, model.Conf, getReleaseChangelog
	t.Cleanup(func() {
		util.WorkingDir, model.Conf, getReleaseChangelog = oldDir, oldConf, oldFetch
	})
	util.WorkingDir, model.Conf = t.TempDir(), model.NewAppConf()
	model.Conf.Lang = "en"
	getReleaseChangelog = func(context.Context, string) (string, error) {
		t.Fatal("stable changelog used the network")
		return "", nil
	}
	directory := filepath.Join(util.WorkingDir, "changelogs", "v3.8.9")
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "v3.8.9.en.md"), []byte("## Local stable changes"), 0600); err != nil {
		t.Fatal(err)
	}
	recorder := systemContractRequest(t, "POST", "getChangelog", changelogContractHandler("3.8.9"), strings.NewReader(`{"force":true}`))
	var response struct {
		Code int                             `json:"code"`
		Data apicontract.SystemChangelogData `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 || !response.Data.Show ||
		response.Data.Version != "3.8.9" || !strings.Contains(response.Data.HTML, "Local stable changes") {
		t.Fatalf("stable local changelog changed: %s, %v", recorder.Body.String(), err)
	}
}
