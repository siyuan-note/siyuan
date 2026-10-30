// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/memo"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupMemoryTranslationTest(t *testing.T) (*conf.AI, apicontract.AIMemoryTranslateRequest) {
	t.Helper()
	cfg := setupAIMemoryTest(t)
	Conf.Lang = "zh-CN"
	memoryTranslations.Lock()
	memoryTranslations.entries = map[string]*memoryTranslationEntry{}
	memoryTranslations.running = 0
	memoryTranslations.Unlock()
	r := memo.Record{Schema: 1, Kind: "preference", Subject: "user", Scope: "workspace", State: "active", Content: "Concise answers", Sources: []memo.Source{{Kind: "user", ID: "user", Revision: "one", Evidence: "PRIVATE_SOURCE_EVIDENCE"}}}
	if _, err := aiMemoryStore().Save(context.Background(), r, "missing", "save"); err != nil {
		t.Fatal(err)
	}
	snapshot, err := aiMemoryStore().Snapshot(context.Background(), []string{"workspace"})
	if err != nil {
		t.Fatal(err)
	}
	q := apicontract.AIMemoryTranslateRequest{Memory: "# Preferences\n\nGive concise answers", Language: Conf.Lang}
	if err = aiMemoryStore().SaveProjection(context.Background(), "MEMORY.md", q.Memory, snapshot.Fingerprint, []string{"workspace"}); err != nil {
		t.Fatal(err)
	}
	return cfg, q
}

func TestAIMemoryTranslationCachesOnlyDisplayWithoutSourceEvidenceOrWrites(t *testing.T) {
	_, q := setupMemoryTranslationTest(t)
	path := filepath.Join(util.DataDir, "storage/ai/memos/MEMORY.md")
	before, _ := os.ReadFile(path)
	calls := 0
	memoryComplete = func(ctx context.Context, _ *conf.AI, prompt string) (string, error) {
		calls++
		if strings.Contains(prompt, "PRIVATE_SOURCE_EVIDENCE") || !strings.Contains(prompt, "language zh-CN") || !strings.Contains(prompt, "Give concise answers") {
			t.Errorf("unsafe translation input: %s", prompt)
		}
		if deadline, ok := ctx.Deadline(); !ok || time.Until(deadline) > memoryTranslationTimeout {
			t.Error("missing bounded deadline")
		}
		return `{"memory":"# 偏好\n\n简洁回答"}`, nil
	}
	for i := 0; i < 2; i++ {
		value, err := TranslateAIMemoryOverview(context.Background(), q)
		if err != nil || value.Language != "zh-CN" || !strings.Contains(value.Memory, "简洁回答") {
			t.Fatalf("value %+v %v", value, err)
		}
	}
	if calls != 1 {
		t.Fatalf("calls %d", calls)
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(before) {
		t.Fatal("translation changed canonical projection")
	}
}

func TestAIMemoryTranslationAdmissionAndLateConfigurationChange(t *testing.T) {
	cfg, q := setupMemoryTranslationTest(t)
	calls := 0
	memoryComplete = func(context.Context, *conf.AI, string) (string, error) {
		calls++
		return `{"memory":"translated"}`, nil
	}
	wrong := q
	wrong.Memory = "arbitrary private input"
	if _, err := TranslateAIMemoryOverview(context.Background(), wrong); err == nil {
		t.Fatal("accepted arbitrary text")
	}
	wrong = q
	wrong.Language = "en"
	if _, err := TranslateAIMemoryOverview(context.Background(), wrong); err == nil {
		t.Fatal("accepted another target language")
	}
	util.ReadOnly = true
	if _, err := TranslateAIMemoryOverview(context.Background(), q); err == nil {
		t.Fatal("readonly requested model")
	}
	util.ReadOnly = false
	cfg.Memory.Enabled = false
	Conf.AI.Store(cfg)
	if _, err := TranslateAIMemoryOverview(context.Background(), q); err == nil {
		t.Fatal("disabled memory requested model")
	}
	cfg.Memory.Enabled = true
	cfg.Memory.ModelID = "missing"
	Conf.AI.Store(cfg)
	if _, err := TranslateAIMemoryOverview(context.Background(), q); err == nil {
		t.Fatal("model fallback")
	}
	if calls != 0 {
		t.Fatal("invalid request reached provider")
	}
	cfg.Memory.ModelID = "memory-model"
	Conf.AI.Store(cfg)
	memoryComplete = func(context.Context, *conf.AI, string) (string, error) {
		Conf.Lang = "en"
		return `{"memory":"translated"}`, nil
	}
	if _, err := TranslateAIMemoryOverview(context.Background(), q); err == nil {
		t.Fatal("language changed during translation")
	}
}

func TestAIMemoryTranslationSharesCallAcrossCancelledWaiter(t *testing.T) {
	_, q := setupMemoryTranslationTest(t)
	entered, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	memoryComplete = func(context.Context, *conf.AI, string) (string, error) {
		calls.Add(1)
		close(entered)
		<-release
		return `{"memory":"translated"}`, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	first := make(chan error, 1)
	go func() { _, err := TranslateAIMemoryOverview(ctx, q); first <- err }()
	<-entered
	cancel()
	if err := <-first; err == nil {
		t.Fatal("cancelled waiter returned success")
	}
	second := make(chan error, 1)
	go func() { _, err := TranslateAIMemoryOverview(context.Background(), q); second <- err }()
	close(release)
	if err := <-second; err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatalf("duplicate calls %d", calls.Load())
	}
}

func TestAIMemoryTranslationRejectsStaleCompletionAndInvalidOutput(t *testing.T) {
	_, q := setupMemoryTranslationTest(t)
	for _, raw := range []string{"not JSON", `{"memory":""}`, fmt.Sprintf(`{"memory":%q}`, strings.Repeat("x", memoryTranslationLimit+1))} {
		memoryComplete = func(context.Context, *conf.AI, string) (string, error) { return raw, nil }
		if _, err := TranslateAIMemoryOverview(context.Background(), q); err == nil {
			t.Fatal("accepted invalid output")
		}
	}
	memoryComplete = func(context.Context, *conf.AI, string) (string, error) {
		return "", errors.New("PRIVATE_PROVIDER_SECRET")
	}
	if _, err := TranslateAIMemoryOverview(context.Background(), q); err == nil || strings.Contains(err.Error(), "PRIVATE_PROVIDER_SECRET") {
		t.Fatal("unsafe provider error", err)
	}
	memoryComplete = func(context.Context, *conf.AI, string) (string, error) {
		snapshot, _ := aiMemoryStore().Snapshot(context.Background(), []string{"workspace"})
		if err := aiMemoryStore().SaveProjection(context.Background(), "MEMORY.md", "new overview", snapshot.Fingerprint, []string{"workspace"}); err != nil {
			t.Error(err)
		}
		return `{"memory":"translated old facts"}`, nil
	}
	if _, err := TranslateAIMemoryOverview(context.Background(), q); err == nil {
		t.Fatal("stale translation was served")
	}
}

func TestAIMemoryTranslationKnownLanguageAndCacheBounds(t *testing.T) {
	cfg, q := setupMemoryTranslationTest(t)
	for i := 0; i < memoryTranslationCacheLimit+8; i++ {
		rememberMemoryOverviewLanguage(cfg, fmt.Sprint(i), q.Language)
	}
	rememberMemoryOverviewLanguage(cfg, q.Memory, q.Language)
	memoryComplete = func(context.Context, *conf.AI, string) (string, error) {
		t.Error("known target language invoked model")
		return "", errors.New("unexpected")
	}
	value, err := TranslateAIMemoryOverview(context.Background(), q)
	if err != nil || value.Memory != q.Memory {
		t.Fatalf("known language %+v %v", value, err)
	}
	memoryTranslations.Lock()
	defer memoryTranslations.Unlock()
	if len(memoryTranslations.entries) > memoryTranslationCacheLimit {
		t.Fatal("unbounded cache")
	}
	entry := memoryTranslations.entries[memoryTranslationKey(util.DataDir, cfg, q.Memory, q.Language)]
	entry.expires = time.Now().Add(-time.Second)
	pruneMemoryTranslations(time.Now(), false)
	if memoryTranslations.entries[memoryTranslationKey(util.DataDir, cfg, q.Memory, q.Language)] != nil {
		t.Fatal("expired cache survives")
	}
}

func TestAIMemoryTranslationConcurrencyBudgetAndExistingSafeError(t *testing.T) {
	_, q := setupMemoryTranslationTest(t)
	memoryTranslations.Lock()
	memoryTranslations.running = 2
	memoryTranslations.Unlock()
	memoryComplete = func(context.Context, *conf.AI, string) (string, error) {
		t.Error("busy request reached provider")
		return "", nil
	}
	_, err := TranslateAIMemoryOverview(context.Background(), q)
	memoryTranslations.Lock()
	memoryTranslations.running = 0
	memoryTranslations.Unlock()
	if err == nil {
		t.Fatal("concurrency budget ignored")
	}
	memoryComplete = func(context.Context, *conf.AI, string) (string, error) { return "", memoryModelError(450) }
	if _, err = TranslateAIMemoryOverview(context.Background(), q); err != memoryModelError(450) {
		t.Fatalf("existing safe error lost: %v", err)
	}
}

func TestAIMemoryGeneratedOverviewReusesRequestedLanguage(t *testing.T) {
	cfg := setupAIMemoryTest(t)
	Conf.Lang = "en"
	ctx := context.Background()
	r := memo.Record{Schema: 1, Kind: "preference", Subject: "user", Scope: "workspace", State: "active", Content: "Concise answers", Sources: []memo.Source{{Kind: "user", ID: "user", Revision: "one"}}}
	if _, err := aiMemoryStore().Save(ctx, r, "missing", "save"); err != nil {
		t.Fatal(err)
	}
	calls := 0
	memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
		calls++
		if !strings.Contains(prompt, "in language en") {
			t.Fatal("generation did not request interface language")
		}
		return "# Preferences\n\nConcise answers", nil
	}
	if err := refreshAIMemoryProjections(ctx, cfg, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	view, err := readAIMemoryOverview(ctx, false)
	if err != nil || view.Stale {
		t.Fatalf("overview %+v %v", view, err)
	}
	value, err := TranslateAIMemoryOverview(ctx, apicontract.AIMemoryTranslateRequest{Memory: view.Memory, Language: "en"})
	if err != nil || value.Memory != view.Memory || calls != 1 {
		t.Fatalf("unnecessary translation %+v %v calls=%d", value, err, calls)
	}
}

func TestAIMemoryTranslationCacheRechecksConfigurationAndWithdrawals(t *testing.T) {
	cfg, q := setupMemoryTranslationTest(t)
	ctx := context.Background()
	calls := 0
	memoryComplete = func(context.Context, *conf.AI, string) (string, error) {
		calls++
		return `{"memory":"translated"}`, nil
	}
	if _, err := TranslateAIMemoryOverview(ctx, q); err != nil {
		t.Fatal(err)
	}
	cfg.Memory.ReasoningEffort = "low"
	Conf.AI.Store(cfg)
	if _, err := TranslateAIMemoryOverview(ctx, q); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatal("changed model configuration reused old cache")
	}
	snapshot, err := aiMemoryStore().Snapshot(ctx, []string{"workspace"})
	if err != nil || len(snapshot.Entries) != 1 {
		t.Fatalf("fixture %+v %v", snapshot, err)
	}
	entry := snapshot.Entries[0]
	if _, err = aiMemoryStore().Forget(ctx, entry.Record.ID, entry.Revision, "forget"); err != nil {
		t.Fatal(err)
	}
	if _, err = TranslateAIMemoryOverview(ctx, q); err == nil {
		t.Fatal("cached translation revived withdrawn memory")
	}
	if calls != 2 {
		t.Fatal("withdrawn overview reached provider")
	}
}
