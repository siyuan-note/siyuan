// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"errors"
	"path/filepath"

	"github.com/siyuan-note/siyuan/kernel/av"

	"github.com/siyuan-note/siyuan/kernel/templatehttp"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type templateHTTPAnswer struct {
	approved bool
	scope    string
}

func init() { TemplateHTTPSourceRevoked = cancelTemplateHTTPSourceExecutions }

func managedTemplateHTTPExecution(runtime *templatehttp.Execution) *TemplateHTTPExecution {
	if runtime == nil {
		return nil
	}
	templateHTTPExecutions.Lock()
	defer templateHTTPExecutions.Unlock()
	for _, execution := range templateHTTPExecutions.values {
		if execution.Runtime == runtime {
			return execution
		}
	}
	return nil
}

// registerTemplateHTTPSource 的来源由内核实读源码生成，客户端不能声明来源身份。
func registerTemplateHTTPSource(runtime *templatehttp.Execution, box string, source *TemplateHTTPSource) string {
	if source == nil {
		return box
	}
	scope := box + "\x00source:" + source.ID + ":" + source.Version
	execution := managedTemplateHTTPExecution(runtime)
	if execution == nil {
		return scope
	}
	execution.mu.Lock()
	if execution.sources == nil {
		execution.sources = make(map[string]*TemplateHTTPSource)
	}
	execution.sources[scope] = source
	execution.mu.Unlock()
	return scope
}

func (execution *TemplateHTTPExecution) sourceForScope(scope string) *TemplateHTTPSource {
	execution.mu.Lock()
	defer execution.mu.Unlock()
	return execution.sources[scope]
}

func (execution *TemplateHTTPExecution) sourceGuard(ctx context.Context, scope string) bool {
	if ctx.Err() != nil || execution.ctx.Err() != nil || !execution.accessValid(scope) {
		return false
	}
	if !util.WaitInteractiveSession(ctx, execution.app, execution.sessionID, execution.session) {
		return false
	}
	source := execution.sourceForScope(scope)
	return (source == nil || IsTemplateHTTPSourceCurrent(source)) && execution.ctx.Err() == nil && execution.accessValid(scope)
}

func (execution *TemplateHTTPExecution) sourceAllowed(scope string, source *TemplateHTTPSource) (bool, error) {
	if !IsTemplateHTTPSourceCurrent(source) {
		return false, errors.New("template network permission expired")
	}
	execution.mu.Lock()
	once := execution.allowedSources[scope]
	execution.mu.Unlock()
	if once {
		return true, nil
	}
	if !source.Persistable {
		return false, nil
	}
	return CheckTemplateHTTPSource(source)
}

func (execution *TemplateHTTPExecution) allowSource(scope string, source *TemplateHTTPSource, permissionScope string) bool {
	if source == nil {
		return permissionScope != "template"
	}
	if !IsTemplateHTTPSourceCurrent(source) {
		return false
	}
	if permissionScope == "template" {
		if !source.Persistable {
			return false
		}
		if err := GrantTemplateHTTPSource(source); err != nil {
			execution.push("templateHTTPStatus", map[string]string{"executionID": execution.id, "state": "error", "errorCode": "permission_save_failed"})
			return false
		}
	}
	if !IsTemplateHTTPSourceCurrent(source) {
		return false
	}
	execution.mu.Lock()
	defer execution.mu.Unlock()
	if execution.ctx.Err() != nil {
		return false
	}
	if execution.allowedSources == nil {
		execution.allowedSources = make(map[string]bool)
	}
	execution.allowedSources[scope] = true
	return true
}

func cancelTemplateHTTPSourceExecutions(ids []string) {
	selected := make(map[string]bool, len(ids))
	for _, id := range ids {
		selected[id] = true
	}
	templateHTTPExecutions.Lock()
	var executions []*TemplateHTTPExecution
	for _, execution := range templateHTTPExecutions.values {
		executions = append(executions, execution)
	}
	templateHTTPExecutions.Unlock()
	for _, execution := range executions {
		execution.mu.Lock()
		affected := len(ids) == 0
		for _, source := range execution.sources {
			if selected[source.ID] {
				affected = true
				break
			}
		}
		execution.mu.Unlock()
		if affected {
			execution.Close()
		}
	}
	clearTemplateHTTPHandoffs()
}

// ManageTemplateHTTPPermission 只从实际文件或字段解析来源，不接受客户端提供的授权 ID 或源码。
func ManageTemplateHTTPPermission(action, kind, path, avID, keyID, slot string) (bool, error) {
	if action == "revokeAll" {
		return false, RevokeAllTemplateHTTPPermissions()
	}
	if action != "get" && action != "revoke" {
		return false, errors.New("invalid template permission action")
	}
	var source *TemplateHTTPSource
	var err error
	switch kind {
	case "file":
		if err = validateTemplateRelativePath(path, false); err != nil {
			return false, err
		}
		_, source, err = ReadTemplateHTTPFile(filepath.Join(util.DataDir, "templates", filepath.FromSlash(path)))
	case "av":
		if err = util.ValidateID(avID); err != nil {
			return false, err
		}
		if err = util.ValidateID(keyID); err != nil {
			return false, err
		}
		var database *av.AttributeView
		database, err = av.ParseAttributeView(avID)
		if err != nil {
			return false, err
		}
		var key *av.Key
		key, err = database.GetKey(keyID)
		if err != nil {
			return false, err
		}
		content := key.Template
		if slot == "renderTemplate" {
			content = key.RenderTemplate
		} else if slot != "template" || key.Type != av.KeyTypeTemplate {
			return false, errors.New("invalid template field")
		}
		source, err = ResolveTemplateHTTPDBSource(av.GetAVBoxID(avID), avID, keyID, slot, content)
	default:
		return false, errors.New("invalid template permission source")
	}
	if err != nil {
		return false, err
	}
	if action == "revoke" {
		return false, RevokeTemplateHTTPSource(source.ID)
	}
	return CheckTemplateHTTPSource(source)
}

func templateHTTPDatabaseSourceScope(runtime *templatehttp.Execution) func(string, string, string, string, string) string {
	if managedTemplateHTTPExecution(runtime) == nil {
		return nil
	}
	return func(owner, avID, keyID, slot, content string) string {
		source, err := ResolveTemplateHTTPDBSource(owner, avID, keyID, slot, content)
		if err != nil {
			runtime.Close()
			return owner
		}
		return registerTemplateHTTPSource(runtime, owner, source)
	}
}
