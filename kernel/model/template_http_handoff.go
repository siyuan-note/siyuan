// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/88250/lute/parse"
	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/templatehttp"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const templateHTTPHandoffTTL = 30 * time.Second
const templateHTTPHandoffLimit = 64
const templateHTTPSourceLimit = 8 << 20
const templateHTTPSourceFileLimit = 64
const templateHTTPPreviewEpochKey = "templateHTTPPreviewEpoch"

type templateHTTPHandoff struct {
	identity       [32]byte
	files          map[string][32]byte
	approvals      *templatehttp.Approvals
	app, sessionID string
	executionID    string
	session        *melody.Session
	expires        time.Time
	done           chan struct{}
}

var templateHTTPHandoffs = struct {
	sync.Mutex
	values     map[string]*templateHTTPHandoff
	generation uint64
}{values: make(map[string]*templateHTTPHandoff)}

type templateHTTPPreviewEpoch struct {
	id         string
	generation uint64
}

// templateHTTPSourceSnapshot 仅在一次渲染期间保留源码，交接凭证只保存摘要。
type templateHTTPSourceSnapshot struct {
	execution      *TemplateHTTPExecution
	token          string
	epoch          string
	mode           TemplateRenderMode
	identity       [32]byte
	files          map[string][]byte
	trustedSources map[string]*TemplateHTTPSource
	bytes          int
	disabled       bool
}

// RenderTemplateWithHTTPHandoff 只复用短期确认，插入仍重新请求外部数据。
func RenderTemplateWithHTTPHandoff(p, id string, mode TemplateRenderMode, content *string,
	execution *TemplateHTTPExecution, token string) (tree *parse.Tree, dom string,
	summary *TemplateDocTreePlanSummary, handoffToken string, err error) {
	if execution == nil {
		tree, dom, summary, err = RenderTemplateWithHTTP(p, id, mode, content, nil)
		return
	}
	if content != nil && len(*content) > maxTemplateSourceSize {
		tree, dom, summary, err = RenderTemplateWithHTTP(p, id, mode, content, execution.Runtime)
		return
	}
	sources := &templateHTTPSourceSnapshot{execution: execution, token: token, mode: mode, files: make(map[string][]byte)}
	if mode == TemplateRenderModePreview {
		sources.epoch = beginTemplateHTTPPreview(execution.session)
	}
	tree, dom, summary, err = renderTemplateSourceWithHTTPSource(p, id, mode, content, nil, execution.Runtime, sources)
	if err == nil && mode == TemplateRenderModePreview && !sources.disabled && execution.ctx.Err() == nil && execution.accessValid("") {
		handoffToken = sources.publish()
	}
	return
}

func templateHTTPSourceScope(box, filename string, data []byte) string {
	encoded, _ := json.Marshal([]any{filepath.Clean(filename), sha256.Sum256(data)})
	digest := sha256.Sum256(encoded)
	return box + "\x00template:" + hex.EncodeToString(digest[:])
}

func (sources *templateHTTPSourceSnapshot) remember(filename string, data []byte) {
	if sources == nil || sources.disabled {
		return
	}
	filename = filepath.Clean(filename)
	previous := len(sources.files[filename])
	if len(sources.files) >= templateHTTPSourceFileLimit && previous == 0 || len(data) > templateHTTPSourceLimit-sources.bytes+previous {
		sources.disabled = true
		return
	}
	sources.files[filename] = data
	sources.bytes += len(data) - previous
}

func (sources *templateHTTPSourceSnapshot) read(filename string) ([]byte, error) {
	filename = filepath.Clean(filename)
	if sources != nil {
		if data, ok := sources.files[filename]; ok {
			return data, nil
		}
	}
	if sources == nil || sources.execution == nil {
		return os.ReadFile(filename)
	}
	data, source, err := ReadTemplateHTTPFile(filename)
	if err == nil {
		sources.remember(filename, data)
		if sources.trustedSources == nil {
			sources.trustedSources = map[string]*TemplateHTTPSource{}
		}
		sources.trustedSources[filename] = source
	}
	return data, err
}

func (sources *templateHTTPSourceSnapshot) source(filename string, data []byte) (*TemplateHTTPSource, error) {
	filename = filepath.Clean(filename)
	if source := sources.trustedSources[filename]; source != nil {
		return source, nil
	}
	source, err := ResolveTemplateHTTPInlineSource(filename, data)
	if err != nil {
		return nil, err
	}
	if sources.trustedSources == nil {
		sources.trustedSources = map[string]*TemplateHTTPSource{}
	}
	sources.trustedSources[filename] = source
	return source, nil
}

func (sources *templateHTTPSourceSnapshot) prepare(filename, target, box, root string, data []byte) {
	filename = filepath.Clean(filename)
	sources.remember(filename, data)
	encoded, _ := json.Marshal([]any{filename, target, box, root, sha256.Sum256(data)})
	sources.identity = sha256.Sum256(encoded)
	if sources.mode != TemplateRenderModeEditorInsert || sources.token == "" {
		return
	}
	grant := takeTemplateHTTPHandoff(sources.token, sources.execution, sources.identity)
	if grant == nil {
		return
	}
	defer grant.approvals.Close()
	if sources.disabled {
		return
	}
	for name, expected := range grant.files {
		current, exists := sources.files[name]
		if !exists {
			var err error
			current, err = sources.read(name)
			if err != nil {
				return
			}
		}
		if sources.disabled || sha256.Sum256(current) != expected {
			return
		}
	}
	if util.WaitInteractiveSession(sources.execution.ctx, sources.execution.app, sources.execution.sessionID, sources.execution.session) && sources.execution.accessValid("") {
		sources.execution.Runtime.ImportApprovals(grant.approvals)
	}
}

func (sources *templateHTTPSourceSnapshot) publish() string {
	if sources.disabled {
		return ""
	}
	approvals := sources.execution.Runtime.ExportApprovals()
	if approvals == nil {
		return ""
	}
	files := make(map[string][32]byte, len(sources.files))
	for name, content := range sources.files {
		files[name] = sha256.Sum256(content)
	}
	return putTemplateHTTPHandoff(sources.execution, sources.identity, files, approvals, sources.epoch)
}

func putTemplateHTTPHandoff(execution *TemplateHTTPExecution, identity [32]byte, files map[string][32]byte, approvals *templatehttp.Approvals, epoch string) string {
	session, disconnected := util.BindableInteractiveSession(execution.app, execution.sessionID)
	if session != execution.session || session == nil || execution.ctx.Err() != nil || len(files) > templateHTTPSourceFileLimit {
		approvals.Close()
		return ""
	}
	token := rand.Text()
	grant := &templateHTTPHandoff{identity: identity, files: files, approvals: approvals,
		app: execution.app, sessionID: execution.sessionID, session: session,
		executionID: execution.id,
		expires:     time.Now().Add(templateHTTPHandoffTTL), done: make(chan struct{})}
	templateHTTPHandoffs.Lock()
	storedEpoch, _ := session.Get(templateHTTPPreviewEpochKey)
	currentEpoch, _ := storedEpoch.(templateHTTPPreviewEpoch)
	if epoch == "" || currentEpoch.id != epoch || currentEpoch.generation != templateHTTPHandoffs.generation || execution.ctx.Err() != nil {
		templateHTTPHandoffs.Unlock()
		approvals.Close()
		return ""
	}
	for existing, value := range templateHTTPHandoffs.values {
		if value.session == session || !time.Now().Before(value.expires) {
			deleteTemplateHTTPHandoffLocked(existing, true)
		}
	}
	if len(templateHTTPHandoffs.values) >= templateHTTPHandoffLimit {
		templateHTTPHandoffs.Unlock()
		approvals.Close()
		return ""
	}
	templateHTTPHandoffs.values[token] = grant
	templateHTTPHandoffs.Unlock()
	go func() {
		timer := time.NewTimer(templateHTTPHandoffTTL)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-disconnected:
		case <-grant.done:
			return
		}
		templateHTTPHandoffs.Lock()
		if templateHTTPHandoffs.values[token] == grant {
			deleteTemplateHTTPHandoffLocked(token, true)
		}
		templateHTTPHandoffs.Unlock()
	}()
	return token
}

func deleteTemplateHTTPHandoffLocked(token string, closeApprovals bool) {
	if grant := templateHTTPHandoffs.values[token]; grant != nil {
		delete(templateHTTPHandoffs.values, token)
		close(grant.done)
		if closeApprovals {
			grant.approvals.Close()
		}
	}
}

func takeTemplateHTTPHandoff(token string, execution *TemplateHTTPExecution, identity [32]byte) *templateHTTPHandoff {
	session, _ := util.BindableInteractiveSession(execution.app, execution.sessionID)
	accessValid := execution.ctx.Err() == nil && execution.accessValid("")
	templateHTTPHandoffs.Lock()
	defer templateHTTPHandoffs.Unlock()
	grant := templateHTTPHandoffs.values[token]
	if grant == nil || grant.app != execution.app || grant.sessionID != execution.sessionID || grant.session != session || session != execution.session {
		return nil
	}
	valid := time.Now().Before(grant.expires) && grant.identity == identity && accessValid && execution.ctx.Err() == nil
	deleteTemplateHTTPHandoffLocked(token, !valid)
	if !valid {
		return nil
	}
	return grant
}

// RevokeTemplateHTTPHandoff 只允许原窗口撤销其预览凭证。
func RevokeTemplateHTTPHandoff(token, app, sessionID string) {
	session, _ := util.BindableInteractiveSession(app, sessionID)
	templateHTTPHandoffs.Lock()
	defer templateHTTPHandoffs.Unlock()
	if grant := templateHTTPHandoffs.values[token]; grant != nil && grant.app == app && grant.sessionID == sessionID && grant.session == session {
		deleteTemplateHTTPHandoffLocked(token, true)
	}
}

func revokeTemplateHTTPExecutionHandoff(id, app, sessionID string) {
	session, _ := util.BindableInteractiveSession(app, sessionID)
	templateHTTPHandoffs.Lock()
	defer templateHTTPHandoffs.Unlock()
	for token, grant := range templateHTTPHandoffs.values {
		if grant.executionID == id && grant.app == app && grant.sessionID == sessionID && grant.session == session {
			deleteTemplateHTTPHandoffLocked(token, true)
		}
	}
}

func beginTemplateHTTPPreview(session *melody.Session) string {
	templateHTTPHandoffs.Lock()
	defer templateHTTPHandoffs.Unlock()
	epoch := rand.Text()
	session.Set(templateHTTPPreviewEpochKey, templateHTTPPreviewEpoch{id: epoch, generation: templateHTTPHandoffs.generation})
	for token, grant := range templateHTTPHandoffs.values {
		if grant.session == session {
			deleteTemplateHTTPHandoffLocked(token, true)
		}
	}
	return epoch
}

func clearTemplateHTTPHandoffs() {
	templateHTTPHandoffs.Lock()
	defer templateHTTPHandoffs.Unlock()
	templateHTTPHandoffs.generation++
	for token := range templateHTTPHandoffs.values {
		deleteTemplateHTTPHandoffLocked(token, true)
	}
}
