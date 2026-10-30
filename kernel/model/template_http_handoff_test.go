// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"crypto/sha256"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/templatehttp"
)

func handoffTestExecution(t *testing.T) *TemplateHTTPExecution {
	t.Helper()
	_, app := templateHTTPTestWindow(t)
	execution, err := StartTemplateHTTPExecution(context.Background(), "handoff-execution-"+t.Name(), app, "main", "document:target")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(execution.Close)
	t.Cleanup(clearTemplateHTTPHandoffs)
	return execution
}

func handoffTestToken(execution *TemplateHTTPExecution, identity [32]byte, files map[string][32]byte) string {
	return putTemplateHTTPHandoff(execution, identity, files, &templatehttp.Approvals{}, beginTemplateHTTPPreview(execution.session))
}

func TestTemplateHTTPHandoffOwnershipExpiryAndSingleUse(t *testing.T) {
	execution := handoffTestExecution(t)
	identity := sha256.Sum256([]byte("document/template/source"))
	token := handoffTestToken(execution, identity, nil)
	if token == "" {
		t.Fatal("missing test handoff")
	}
	RevokeTemplateHTTPHandoff(token, "other", "main")
	var consumed atomic.Int32
	var group sync.WaitGroup
	for range 8 {
		group.Add(1)
		go func() {
			defer group.Done()
			if grant := takeTemplateHTTPHandoff(token, execution, identity); grant != nil {
				consumed.Add(1)
				grant.approvals.Close()
			}
		}()
	}
	group.Wait()
	if consumed.Load() != 1 {
		t.Fatalf("handoff consumed %d times", consumed.Load())
	}
	token = handoffTestToken(execution, identity, nil)
	if takeTemplateHTTPHandoff(token, execution, sha256.Sum256([]byte("changed"))) != nil || takeTemplateHTTPHandoff(token, execution, identity) != nil {
		t.Fatal("mismatched context retained a usable handoff")
	}
	token = handoffTestToken(execution, identity, nil)
	templateHTTPHandoffs.Lock()
	templateHTTPHandoffs.values[token].expires = time.Now().Add(-time.Second)
	templateHTTPHandoffs.Unlock()
	if takeTemplateHTTPHandoff(token, execution, identity) != nil {
		t.Fatal("expired handoff accepted")
	}
}

func TestTemplateHTTPHandoffNewestPreviewAndLifecycle(t *testing.T) {
	execution := handoffTestExecution(t)
	identity := sha256.Sum256([]byte("source"))
	oldEpoch := beginTemplateHTTPPreview(execution.session)
	beginTemplateHTTPPreview(execution.session)
	if token := putTemplateHTTPHandoff(execution, identity, nil, &templatehttp.Approvals{}, oldEpoch); token != "" {
		t.Fatal("older slow preview issued a handoff")
	}
	oldEpoch = beginTemplateHTTPPreview(execution.session)
	clearTemplateHTTPHandoffs()
	if token := putTemplateHTTPHandoff(execution, identity, nil, &templatehttp.Approvals{}, oldEpoch); token != "" {
		t.Fatal("preview revived handoff after global invalidation")
	}
	token := handoffTestToken(execution, identity, nil)
	beginTemplateHTTPPreview(execution.session)
	if takeTemplateHTTPHandoff(token, execution, identity) != nil {
		t.Fatal("new preview did not revoke old handoff")
	}
	token = handoffTestToken(execution, identity, nil)
	RevokeTemplateHTTPHandoff(token, execution.app, execution.sessionID)
	if takeTemplateHTTPHandoff(token, execution, identity) != nil {
		t.Fatal("closed preview retained handoff")
	}
	token = handoffTestToken(execution, identity, nil)
	CancelTemplateHTTP(execution.id, execution.app, execution.sessionID)
	templateHTTPHandoffs.Lock()
	remaining := templateHTTPHandoffs.values[token]
	templateHTTPHandoffs.Unlock()
	if remaining != nil {
		t.Fatal("execution cancellation retained already-issued handoff")
	}
}

func TestTemplateHTTPHandoffDisconnectAndExactSession(t *testing.T) {
	connection, app := templateHTTPTestWindow(t)
	execution, err := StartTemplateHTTPExecution(context.Background(), "handoff-disconnect-test", app, "main", "document:target")
	if err != nil {
		t.Fatal(err)
	}
	defer execution.Close()
	defer clearTemplateHTTPHandoffs()
	identity := sha256.Sum256([]byte("source"))
	token := handoffTestToken(execution, identity, nil)
	impostor := &TemplateHTTPExecution{app: app, sessionID: "main", ctx: context.Background()}
	if takeTemplateHTTPHandoff(token, impostor, identity) != nil {
		t.Fatal("matching names without the original session accepted")
	}
	templateHTTPHandoffs.Lock()
	grant := templateHTTPHandoffs.values[token]
	templateHTTPHandoffs.Unlock()
	connection.Close()
	select {
	case <-grant.done:
	case <-time.After(time.Second):
		t.Fatal("disconnected window retained a handoff")
	}
	if takeTemplateHTTPHandoff(token, execution, identity) != nil {
		t.Fatal("disconnected handoff accepted")
	}
}

func TestTemplateHTTPHandoffDependencySnapshotAndScope(t *testing.T) {
	dir := setupTemplateHTTPPermissionTest(t)
	execution := handoffTestExecution(t)
	root, child := filepath.Join(dir, "root.md"), filepath.Join(dir, "child.md")
	if err := os.WriteFile(child, []byte("before"), 0600); err != nil {
		t.Fatal(err)
	}
	preview := &templateHTTPSourceSnapshot{execution: execution, mode: TemplateRenderModePreview, files: map[string][]byte{}}
	preview.prepare(root, "target", "box", "doc", []byte("root"))
	token := handoffTestToken(execution, preview.identity, map[string][32]byte{
		root: sha256.Sum256([]byte("root")), child: sha256.Sum256([]byte("before")),
	})
	insert := &templateHTTPSourceSnapshot{execution: execution, token: token, mode: TemplateRenderModeEditorInsert, files: map[string][]byte{}}
	insert.prepare(root, "target", "box", "doc", []byte("root"))
	if err := os.WriteFile(child, []byte("after"), 0600); err != nil {
		t.Fatal(err)
	}
	data, err := insert.read(child)
	if err != nil || string(data) != "before" {
		t.Fatalf("validated child was read twice: %q %v", data, err)
	}
	if templateHTTPSourceScope("box", child, data) == templateHTTPSourceScope("box", child, []byte("after")) ||
		templateHTTPSourceScope("box", child, data) == templateHTTPSourceScope("box", root, data) ||
		templateHTTPSourceScope("box", child, data) == templateHTTPSourceScope("other", child, data) {
		t.Fatal("HTTP source scopes were not isolated")
	}
	changed := &templateHTTPSourceSnapshot{files: map[string][]byte{}, mode: TemplateRenderModePreview}
	changed.prepare(root, "target", "box", "doc", []byte("changed"))
	if changed.identity == preview.identity {
		t.Fatal("source change did not change handoff identity")
	}
}

func TestTemplateHTTPHandoffSourceBoundAndNoApproval(t *testing.T) {
	execution := handoffTestExecution(t)
	sources := &templateHTTPSourceSnapshot{execution: execution, files: map[string][]byte{}}
	sources.remember("root", make([]byte, templateHTTPSourceLimit))
	sources.remember("child", []byte("overflow"))
	if !sources.disabled || sources.bytes > templateHTTPSourceLimit {
		t.Fatal("source snapshot exceeded its bound")
	}
	if token := sources.publish(); token != "" {
		t.Fatal("runtime without successful approved requests issued a handoff")
	}
}
