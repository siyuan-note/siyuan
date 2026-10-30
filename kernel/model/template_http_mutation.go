// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/siyuan/kernel/av"
)

// templateHTTPCheckoutPreflight 在同步或快照恢复落盘前撤销受影响的本机许可。
// AV 更新比较字段模板而非文件时间，普通单元格更新不改变字段来源。
func templateHTTPCheckoutPreflight(dataDir string, plan *dejavu.CheckoutPlan) error {
	return templateHTTPCheckoutPreflightRead(dataDir, plan, plan.ReadFile)
}

func templateHTTPCheckoutPreflightRead(dataDir string, plan *dejavu.CheckoutPlan, readNew func(string) ([]byte, error)) error {
	for _, file := range plan.Upserts {
		if templateHTTPCheckoutTemplate(file.Path) {
			if err := InvalidateTemplateHTTPFilePath(filepath.Join(dataDir, filepath.FromSlash(strings.TrimPrefix(file.Path, "/")))); err != nil {
				return err
			}
		}
		if owner, avID, ok := templateHTTPCheckoutDatabase(file.Path); ok {
			incoming, readErr := readNew(file.Path)
			previous, previousErr := os.ReadFile(filepath.Join(dataDir, filepath.FromSlash(strings.TrimPrefix(file.Path, "/"))))
			if readErr != nil || previousErr != nil {
				if err := InvalidateTemplateHTTPDatabase(owner, avID, ""); err != nil {
					return err
				}
				continue
			}
			if err := invalidateTemplateHTTPCheckoutFields(owner, avID, previous, incoming); err != nil {
				return err
			}
		}
	}
	for _, file := range plan.Removes {
		if templateHTTPCheckoutTemplate(file.Path) {
			if err := InvalidateTemplateHTTPFilePath(filepath.Join(dataDir, filepath.FromSlash(strings.TrimPrefix(file.Path, "/")))); err != nil {
				return err
			}
		}
		if owner, avID, ok := templateHTTPCheckoutDatabase(file.Path); ok {
			if err := InvalidateTemplateHTTPDatabase(owner, avID, ""); err != nil {
				return err
			}
		}
	}
	return nil
}

func templateHTTPCheckoutTemplate(name string) bool {
	return strings.HasPrefix(name, "/templates/")
}

func templateHTTPCheckoutDatabase(name string) (owner, avID string, ok bool) {
	parts := strings.Split(strings.TrimPrefix(name, "/"), "/")
	owner = "global"
	if len(parts) == 4 {
		owner, parts = parts[0], parts[1:]
	}
	if len(parts) != 3 || parts[0] != "storage" || parts[1] != "av" || !strings.HasSuffix(parts[2], ".json") {
		return "", "", false
	}
	avID = strings.TrimSuffix(parts[2], ".json")
	return owner, avID, avID != ""
}

// 只提取来源字段，避免把单元格内容纳入许可版本或持久存储。
type templateHTTPCheckoutField struct {
	ID             string `json:"id"`
	Type           string `json:"type"`
	Template       string `json:"template"`
	RenderTemplate string `json:"renderTemplate"`
}

func templateHTTPCheckoutFields(data []byte, avID string) (map[string]templateHTTPCheckoutField, bool) {
	var view struct {
		ID        string `json:"id"`
		Spec      int    `json:"spec"`
		KeyValues []struct {
			Key *templateHTTPCheckoutField `json:"key"`
		} `json:"keyValues"`
	}
	if json.Unmarshal(data, &view) != nil || view.ID != avID || view.Spec < 0 || view.Spec > av.CurrentSpec || view.KeyValues == nil {
		return nil, false
	}
	ret := make(map[string]templateHTTPCheckoutField, len(view.KeyValues))
	for _, item := range view.KeyValues {
		if item.Key == nil || item.Key.ID == "" {
			return nil, false
		}
		if _, exists := ret[item.Key.ID]; exists {
			return nil, false
		}
		ret[item.Key.ID] = *item.Key
	}
	return ret, true
}

func invalidateTemplateHTTPCheckoutFields(owner, avID string, previous, incoming []byte) error {
	// 已解锁来源可以认证后比较字段；不持额外笔记本锁，不发布明文缓存。
	if owner != "global" && owner != "" {
		dek, err := GetDEKIfUnlocked(owner)
		if err != nil || len(dek) == 0 {
			return InvalidateTemplateHTTPDatabase(owner, avID, "")
		}
		defer clear(dek)
		oldPlain, err := av.DecryptAVDataWithDEK(owner, avID, dek, previous)
		if err != nil {
			return InvalidateTemplateHTTPDatabase(owner, avID, "")
		}
		defer clear(oldPlain)
		newPlain, err := av.DecryptAVDataWithDEK(owner, avID, dek, incoming)
		if err != nil {
			return InvalidateTemplateHTTPDatabase(owner, avID, "")
		}
		defer clear(newPlain)
		previous, incoming = oldPlain, newPlain
	}
	before, beforeOK := templateHTTPCheckoutFields(previous, avID)
	after, afterOK := templateHTTPCheckoutFields(incoming, avID)
	// 无法识别的版本和损坏来源只撤销许可，不改写同步内容。
	if !beforeOK || !afterOK {
		return InvalidateTemplateHTTPDatabase(owner, avID, "")
	}
	for id, field := range before {
		if next, exists := after[id]; !exists || next != field {
			if err := InvalidateTemplateHTTPDatabase(owner, avID, id); err != nil {
				return err
			}
		}
	}
	for id := range after {
		if _, exists := before[id]; !exists {
			if err := InvalidateTemplateHTTPDatabase(owner, avID, id); err != nil {
				return err
			}
		}
	}
	return nil
}
