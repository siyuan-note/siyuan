// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	aiEditorActionsVersion          = 1
	legacyAIEditorActionsStorageKey = "local-ai"
)

type AIEditorAction struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Action string `json:"action"`
}

type aiEditorActionsData struct {
	Version int               `json:"version"`
	Actions []*AIEditorAction `json:"actions"`
}

type legacyAIEditorAction struct {
	Name string `json:"name"`
	Memo string `json:"memo"`
}

var aiEditorActionsLock sync.Mutex

func GetAIEditorActions() (ret []*AIEditorAction, err error) {
	waitForSyncingStorages()
	aiEditorActionsLock.Lock()
	defer aiEditorActionsLock.Unlock()

	data, err := loadAIEditorActions()
	if err != nil {
		return nil, err
	}
	if err = migrateLegacyAIEditorActions(data, !util.ReadOnly); err != nil {
		return nil, err
	}
	return data.Actions, nil
}

func SaveAIEditorAction(action *AIEditorAction) (ret *AIEditorAction, err error) {
	if action == nil || (action.Name == "" && action.Action == "") {
		return nil, errors.New("AI editor action must not be empty")
	}
	if action.ID != "" && !ast.IsNodeIDPattern(action.ID) {
		return nil, errors.New("invalid AI editor action ID")
	}

	waitForSyncingStorages()
	aiEditorActionsLock.Lock()
	defer aiEditorActionsLock.Unlock()

	data, err := loadAIEditorActions()
	if err != nil {
		return nil, err
	}
	if err = migrateLegacyAIEditorActions(data, true); err != nil {
		return nil, err
	}

	ret = &AIEditorAction{
		ID:     action.ID,
		Name:   action.Name,
		Action: action.Action,
	}
	if ret.ID == "" {
		ret.ID = ast.NewNodeID()
		data.Actions = append(data.Actions, ret)
	} else {
		updated := false
		for i, item := range data.Actions {
			if item.ID == ret.ID {
				data.Actions[i] = ret
				updated = true
				break
			}
		}
		if !updated {
			return nil, errors.New("AI editor action not found")
		}
	}

	if err = saveAIEditorActions(data); err != nil {
		return nil, err
	}
	return ret, nil
}

func RemoveAIEditorAction(id string) (err error) {
	if !ast.IsNodeIDPattern(id) {
		return errors.New("invalid AI editor action ID")
	}

	waitForSyncingStorages()
	aiEditorActionsLock.Lock()
	defer aiEditorActionsLock.Unlock()

	data, err := loadAIEditorActions()
	if err != nil {
		return err
	}
	if err = migrateLegacyAIEditorActions(data, true); err != nil {
		return err
	}

	for i, item := range data.Actions {
		if item.ID == id {
			data.Actions = append(data.Actions[:i], data.Actions[i+1:]...)
			return saveAIEditorActions(data)
		}
	}
	return nil
}

func aiEditorActionsPath() string {
	return filepath.Join(util.DataDir, "storage", "ai", "editor", "actions.json")
}

func loadAIEditorActions() (ret *aiEditorActionsData, err error) {
	ret = &aiEditorActionsData{
		Version: aiEditorActionsVersion,
		Actions: []*AIEditorAction{},
	}
	dataPath := aiEditorActionsPath()
	if !filelock.IsExist(dataPath) {
		return ret, nil
	}

	data, err := filelock.ReadFile(dataPath)
	if err != nil {
		return nil, fmt.Errorf("read AI editor actions failed: %w", err)
	}
	if err = gulu.JSON.UnmarshalJSON(data, ret); err != nil {
		return nil, fmt.Errorf("unmarshal AI editor actions failed: %w", err)
	}
	if ret.Version != aiEditorActionsVersion {
		return nil, fmt.Errorf("unsupported AI editor actions version [%d]", ret.Version)
	}
	if ret.Actions == nil {
		ret.Actions = []*AIEditorAction{}
	}

	ids := make(map[string]struct{}, len(ret.Actions))
	for _, action := range ret.Actions {
		if action == nil || !ast.IsNodeIDPattern(action.ID) || (action.Name == "" && action.Action == "") {
			return nil, errors.New("invalid AI editor action data")
		}
		if _, ok := ids[action.ID]; ok {
			return nil, fmt.Errorf("duplicate AI editor action ID [%s]", action.ID)
		}
		ids[action.ID] = struct{}{}
	}
	return ret, nil
}

func saveAIEditorActions(data *aiEditorActionsData) (err error) {
	data.Version = aiEditorActionsVersion
	if data.Actions == nil {
		data.Actions = []*AIEditorAction{}
	}

	dirPath := filepath.Dir(aiEditorActionsPath())
	if err = os.MkdirAll(dirPath, 0755); err != nil {
		return fmt.Errorf("create AI editor actions directory failed: %w", err)
	}
	bytes, err := gulu.JSON.MarshalIndentJSON(data, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal AI editor actions failed: %w", err)
	}
	if err = filelock.WriteFile(aiEditorActionsPath(), bytes); err != nil {
		return fmt.Errorf("write AI editor actions failed: %w", err)
	}
	return nil
}

func migrateLegacyAIEditorActions(data *aiEditorActionsData, persist bool) (err error) {
	localStorage := GetLocalStorage()
	legacyRaw, ok := localStorage[legacyAIEditorActionsStorageKey]
	if !ok {
		return nil
	}

	var legacyActions []*legacyAIEditorAction
	if legacyJSON, isString := legacyRaw.(string); isString {
		if err = gulu.JSON.UnmarshalJSON([]byte(legacyJSON), &legacyActions); err != nil {
			return fmt.Errorf("unmarshal legacy AI editor actions failed: %w", err)
		}
	} else {
		legacyJSON, marshalErr := gulu.JSON.MarshalJSON(legacyRaw)
		if marshalErr != nil {
			return fmt.Errorf("marshal legacy AI editor actions failed: %w", marshalErr)
		}
		if err = gulu.JSON.UnmarshalJSON(legacyJSON, &legacyActions); err != nil {
			return fmt.Errorf("unmarshal legacy AI editor actions failed: %w", err)
		}
	}

	type actionKey struct {
		name   string
		action string
	}
	existing := make(map[actionKey]struct{}, len(data.Actions))
	for _, action := range data.Actions {
		existing[actionKey{name: action.Name, action: action.Action}] = struct{}{}
	}

	changed := false
	for _, legacyAction := range legacyActions {
		if legacyAction == nil || (legacyAction.Name == "" && legacyAction.Memo == "") {
			continue
		}
		key := actionKey{name: legacyAction.Name, action: legacyAction.Memo}
		if _, ok = existing[key]; ok {
			continue
		}
		data.Actions = append(data.Actions, &AIEditorAction{
			ID:     ast.NewNodeID(),
			Name:   legacyAction.Name,
			Action: legacyAction.Memo,
		})
		existing[key] = struct{}{}
		changed = true
	}
	if !persist {
		return nil
	}
	if changed {
		if err = saveAIEditorActions(data); err != nil {
			return err
		}
	}
	if err = RemoveLocalStorageVals([]string{legacyAIEditorActionsStorageKey}); err != nil {
		return fmt.Errorf("remove legacy AI editor actions failed: %w", err)
	}
	return nil
}
