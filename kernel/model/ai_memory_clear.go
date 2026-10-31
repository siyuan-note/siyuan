// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"sync/atomic"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var memoryWriteEpoch atomic.Uint64
var memoryClearActive atomic.Bool
var memoryClearMu sync.Mutex

// disableAIMemory 只修改当前配置的记忆开关；成功持久化后才发布新快照。
func disableAIMemory() error {
	if Conf == nil {
		return errors.New("memory configuration unavailable")
	}
	Conf.m.Lock()
	defer Conf.m.Unlock()
	if err := memoryWriteAllowed(); err != nil {
		return err
	}
	ai := cloneConfSection(Conf.LoadAI())
	if ai == nil {
		ai = conf.NewAI()
	}
	if ai.Memory == nil {
		ai.Memory = &conf.Memory{}
	}
	ai.Memory.Enabled = false
	next := Conf.cloneSettings()
	next.AI.Store(ai)
	data, err := next.marshalForSave()
	if err != nil {
		return err
	}
	path := filepath.Join(util.ConfDir, "conf.json")
	filelock.Lock(path)
	err = gulu.File.WriteFileSafer(path, data, 0600)
	filelock.Unlock(path)
	if err != nil {
		return err
	}
	Conf.AI.Store(ai)
	recordPersistedConf(data)
	return nil
}

// ClearAIMemory 先关闭功能并使旧写入失效，再撤回正式记录；不调用模型、不改原笔记或对话。
func ClearAIMemory(ctx context.Context) (apicontract.AIMemoryClearData, error) {
	ret := apicontract.AIMemoryClearData{}
	if err := memoryWriteAllowed(); err != nil {
		return ret, err
	}
	memoryClearMu.Lock()
	defer memoryClearMu.Unlock()
	if err := ctx.Err(); err != nil {
		return ret, err
	}
	memoryClearActive.Store(true)
	defer memoryClearActive.Store(false)
	workspace := util.DataDir
	epoch := memoryWriteEpoch.Add(1)
	if err := disableAIMemory(); err != nil {
		return ret, err
	}
	ret.Disabled = true
	memoryTasks.Lock()
	for _, task := range memoryTasks.tasks {
		if task.dataDir == workspace && task.cancel != nil {
			task.cancel()
		}
	}
	memoryTasks.Unlock()
	memorySourceQueue.Lock()
	if memorySourceQueue.timer != nil {
		memorySourceQueue.timer.Stop()
	}
	memorySourceQueue.ids = map[string]bool{}
	memorySourceQueue.Unlock()
	memoryOverviewQueue.Lock()
	if memoryOverviewQueue.timer != nil {
		memoryOverviewQueue.timer.Stop()
	}
	memoryOverviewQueue.Unlock()
	check := func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := memoryWriteAllowed(); err != nil {
			return err
		}
		if Conf == nil || util.DataDir != workspace || memoryWriteEpoch.Load() != epoch {
			return errors.New("memory workspace changed")
		}
		cfg := Conf.LoadAI()
		if cfg == nil || cfg.Memory == nil || cfg.Memory.Enabled {
			return errors.New("memory configuration changed")
		}
		return nil
	}
	err := aiMemoryStore().Clear(ctx, check)
	if util.DataDir == workspace {
		memoryChanged("")
	}
	if Conf == nil || util.DataDir != workspace {
		ret.Disabled = false
	} else if cfg := Conf.LoadAI(); cfg == nil || cfg.Memory == nil || cfg.Memory.Enabled {
		ret.Disabled = false
	}
	if err != nil {
		return ret, nil
	}
	memoryTranslations.Lock()
	for key, entry := range memoryTranslations.entries {
		if !entry.expires.IsZero() {
			delete(memoryTranslations.entries, key)
		}
	}
	memoryTranslations.Unlock()
	ret.Cleared = true
	return ret, nil
}
