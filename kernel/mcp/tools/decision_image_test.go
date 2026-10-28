// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func decisionImageFixture(t *testing.T) []byte {
	t.Helper()
	var data bytes.Buffer
	if err := png.Encode(&data, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func configureDecisionImageAssets(t *testing.T) string {
	t.Helper()
	model.Conf.FileTree.Store(conf.NewFileTree())
	oldData, oldWorkspace := util.DataDir, util.WorkspaceDir
	util.WorkspaceDir = t.TempDir()
	util.DataDir = filepath.Join(util.WorkspaceDir, "data")
	t.Cleanup(func() { util.DataDir, util.WorkspaceDir = oldData, oldWorkspace })
	assets := filepath.Join(util.DataDir, "assets")
	if err := os.MkdirAll(assets, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(assets, "explicit.png"), decisionImageFixture(t), 0600); err != nil {
		t.Fatal(err)
	}
	return assets
}

func TestDecisionImageLocalAndRemoteInputs(t *testing.T) {
	configureDecisionTest(t, "http://unused.invalid")
	assets := configureDecisionImageAssets(t)
	images, err := prepareDecisionImages(context.Background(), []decisionImageInput{{AssetPath: "assets/explicit.png", Detail: "low"}, {URL: "https://example.com/remote.png", Detail: "high"}})
	if err != nil || len(images) != 2 || !strings.HasPrefix(images[0].URL, "data:image/png;base64,") || images[0].Detail != "low" || images[1].URL != "https://example.com/remote.png" {
		t.Fatalf("explicit images were not preserved: %+v %v", images, err)
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(images[0].URL, "data:image/png;base64,"))
	if err != nil || !bytes.Equal(decoded, decisionImageFixture(t)) {
		t.Fatal("local image bytes changed", err)
	}
	state, err := decisionItemState(context.Background(), decisionItem{Text: "![image](assets/missing.png)"}, "")
	if err != nil || len(state.Images) != 0 {
		t.Fatal("Markdown images were attached implicitly", err)
	}
	if err := os.WriteFile(filepath.Join(assets, "bad.png"), []byte("invalid image"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, input := range []decisionImageInput{{AssetPath: "assets/bad.png"}, {AssetPath: "assets/../secret.png"}, {AssetPath: "../private.png"}, {AssetPath: "assets/missing.png"}, {AssetPath: "assets/explicit.png?box=20260920000000-locked1"}, {AssetPath: "assets/explicit.png", URL: "https://example.com/a.png"}, {URL: "http://user:secret@example.com/a.png"}} {
		if _, err := prepareDecisionImages(context.Background(), []decisionImageInput{input}); err == nil {
			t.Fatalf("invalid asset accepted: %+v", input)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := prepareDecisionImages(ctx, []decisionImageInput{{AssetPath: "assets/explicit.png"}}); err != context.Canceled {
		t.Fatal("cancelled image read continued", err)
	}
	const lockedBox = "20260920000000-locked1"
	dir := filepath.Join(util.DataDir, lockedBox, ".siyuan")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "conf.json"), []byte(`{"encrypted":true}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareDecisionImages(context.Background(), []decisionImageInput{{AssetPath: "assets/explicit.png", Notebook: lockedBox}}); err == nil || !strings.Contains(err.Error(), "locked") {
		t.Fatal("locked image read accepted", err)
	}
}

func TestDecisionOpenAIToolJSONAndQuestionImages(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var payload struct {
			Input []struct {
				Content []struct {
					Type     string          `json:"type"`
					Data     json.RawMessage `json:"data"`
					ImageURL string          `json:"image_url"`
				} `json:"content"`
			} `json:"input"`
			Questions []struct {
				Instructions json.RawMessage `json:"instructions"`
			} `json:"questions"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
			return
		}
		if len(payload.Input) != 1 || len(payload.Input[0].Content) != 2 || string(payload.Input[0].Content[1].Data) != `{"priority":2}` || !strings.HasPrefix(payload.Input[0].Content[0].ImageURL, "data:image/png;base64,") || !strings.Contains(string(payload.Questions[0].Instructions), "https://example.com/candidate.png") {
			t.Errorf("native tool input lost: %+v", payload)
		}
		io.WriteString(w, `{"model":"gpt-6-luna","answers":[{"name":"q","type":"predicate","probability":0.9}],"usage":{"input_tokens":100,"output_tokens":0,"input_tokens_details":{"cached_tokens":40,"cache_write_tokens":60}}}`)
	}))
	defer server.Close()
	configureDecisionTest(t, server.URL)
	configureDecisionImageAssets(t)
	model.Conf.AI.Load().Decision = &conf.Decision{Enabled: true, Provider: "openai", Profiles: map[string]*conf.DecisionProfile{"openai": {Endpoint: server.URL, APIKey: "key", Name: "gpt-6-luna", Timeout: 1}}}
	args := decisionArgs(t, `{"action":"evaluate","items":[{"id":"one","data":{"priority":2},"images":[{"assetPath":"assets/explicit.png"}]}],"questions":[{"id":"q","type":"noul","instructions":"Matches?","images":[{"url":"https://example.com/candidate.png"}]}]}`)
	_, validator := LookupToolWithValidator("decision")
	if err := validator.ValidateInput(args); err != nil {
		t.Fatal("tool schema rejects native evidence", err)
	}
	result, err := decisionHandler(context.Background(), args)
	if err != nil || result.IsError || calls != 1 || !strings.Contains(result.Content[0].Text, `"cache_write_tokens":60`) {
		t.Fatalf("native tool evaluation failed: %+v %v", result, err)
	}
	model.Conf.AI.Load().Decision.Provider = "typesafe"
	model.Conf.AI.Load().Decision.Profiles["typesafe"] = &conf.DecisionProfile{Endpoint: server.URL, APIKey: "other", Name: "jev", Timeout: 1}
	result, err = decisionHandler(context.Background(), args)
	if err != nil || !result.IsError || calls != 1 {
		t.Fatal("unsupported provider sent native evidence", err)
	}
}

func TestDecisionToolQuestionAndImageLimits(t *testing.T) {
	input := decisionInput{Action: "evaluate", Items: []decisionItem{{ID: "one", Text: "text"}}}
	for i := 0; i < 400; i++ {
		input.Questions = append(input.Questions, decisionQuestionInput{ID: fmt.Sprint(i), Type: "noul", Instructions: "Relevant?"})
	}
	data, _ := json.Marshal(input)
	args := decisionArgs(t, string(data))
	_, validator := LookupToolWithValidator("decision")
	if err := validator.ValidateInput(args); err != nil {
		t.Fatal("400-question schema rejected", err)
	}
	if _, err := decisionQuestions(input, "openai"); err != nil {
		t.Fatal("400 OpenAI questions rejected", err)
	}
	if _, err := decisionQuestions(input, "typesafe"); err == nil {
		t.Fatal("TypeSafe limit increased")
	}
	input.Questions = append(input.Questions, decisionQuestionInput{ID: "extra", Type: "noul", Instructions: "Relevant?"})
	data, _ = json.Marshal(input)
	if err := validator.ValidateInput(decisionArgs(t, string(data))); err == nil {
		t.Fatal("401-question schema accepted")
	}
	input.Questions = input.Questions[:1]
	for range 128 {
		input.Questions[0].Images = append(input.Questions[0].Images, decisionImageInput{URL: "https://example.com/a.png"})
	}
	input.Items[0].Images = []decisionImageInput{{URL: "https://example.com/b.png"}}
	if _, err := decisionQuestions(input, "openai"); err == nil {
		t.Fatal("shared and question image limits were counted separately")
	}
	input.Items[0].Images = nil
	if _, err := decisionQuestions(input, "openai"); err != nil {
		t.Fatal("128 images rejected", err)
	}
	input.Items = make([]decisionItem, 33)
	if _, err := decisionQuestions(input, "openai"); err == nil {
		t.Fatal("independent item limit increased")
	}
}

func TestDecisionImageByteBudget(t *testing.T) {
	configureDecisionTest(t, "http://unused.invalid")
	largeURL := "https://example.com/image?data=" + strings.Repeat("x", util.DecisionMaxBytes/2)
	images := []decisionImageInput{{URL: largeURL}, {URL: largeURL}}
	if _, err := prepareDecisionImages(context.Background(), images); err == nil {
		t.Fatal("oversized image group retained")
	}
	model.Conf.AI.Load().Decision = &conf.Decision{Enabled: true, Provider: "openai", Profiles: map[string]*conf.DecisionProfile{
		"openai": {Endpoint: "http://unused.invalid", APIKey: "key", Name: "gpt-6-luna"},
	}}
	input := decisionInput{Action: "evaluate", Items: []decisionItem{{ID: "one", Text: "text"}}, Questions: []decisionQuestionInput{
		{ID: "a", Type: "noul", Instructions: "Relevant?", Images: images[:1]},
		{ID: "b", Type: "noul", Instructions: "Relevant?", Images: images[1:]},
	}}
	data, _ := json.Marshal(input)
	result, err := decisionHandler(context.Background(), decisionArgs(t, string(data)))
	if err != nil || !result.IsError || !strings.Contains(result.Content[0].Text, "question images exceed") {
		t.Fatalf("question image budget not enforced before evaluating items: %+v %v", result, err)
	}
}
