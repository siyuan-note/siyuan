// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"encoding/json"
	"errors"
	"maps"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
)

type AssetTextRelinkMapping struct{ OldPath, NewPath string }
type AssetTextRelinkResult struct {
	Exists  bool
	Changed bool
	Reason  string
}

type AssetTextRelinkPlan struct {
	Results  []AssetTextRelinkResult
	mappings []AssetTextRelinkMapping
	texts    map[string]string
	memory   map[string]string
	original []byte
	path     string
	values   []string
}

type assetTextIndexedValue struct {
	value    string
	conflict bool
}

// PrepareAssetTextRelinks 从同一份 OCR 快照计算所有映射，不写文件或内存缓存。
func PrepareAssetTextRelinks(mappings []AssetTextRelinkMapping) (*AssetTextRelinkPlan, error) {
	assetsTextsLock.Lock()
	defer assetsTextsLock.Unlock()
	p := &AssetTextRelinkPlan{mappings: mappings, Results: make([]AssetTextRelinkResult, len(mappings)),
		texts: map[string]string{}, memory: maps.Clone(assetsTexts), values: make([]string, len(mappings)),
		path: filepath.Join(GetDataAssetsAbsPath(), "ocr-texts.json")}
	data, err := filelock.ReadFile(p.path)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if err == nil {
		if err = json.Unmarshal(data, &p.texts); err != nil || p.texts == nil {
			return nil, errors.New("invalid OCR metadata")
		}
		p.original = data
	}
	maps.Copy(p.texts, p.memory)
	index := map[string]assetTextIndexedValue{}
	add := func(key, value string) {
		if prior, found := index[key]; found {
			prior.conflict = prior.conflict || prior.value != value
			index[key] = prior
		} else {
			index[key] = assetTextIndexedValue{value: value}
		}
	}
	for key, value := range p.texts {
		add(key, value)
		parsed, parseErr := url.Parse(key)
		if parseErr == nil && !parsed.IsAbs() && parsed.Host == "" {
			canonical := strings.TrimPrefix(parsed.Path, "/")
			if canonical != key {
				add(canonical, value)
			}
		}
	}
	for i, mapping := range mappings {
		if mapping.OldPath == "" {
			continue
		}
		result := &p.Results[i]
		source, found := index[mapping.OldPath]
		result.Exists, p.values[i] = found, source.value
		if source.conflict {
			result.Reason = "ocr_source_conflict"
		}
		if !result.Exists || mapping.NewPath == "" || mapping.NewPath == mapping.OldPath {
			continue
		}
		target, found := index[mapping.NewPath]
		if found && (target.conflict || target.value != p.values[i]) {
			result.Reason = "ocr_target_conflict"
		}
		result.Changed = !found && result.Reason == ""
	}
	// 多个源汇入同一个目标时，只有完全一致的识别结果才允许合并。
	targetGroups := map[string][]int{}
	for i, mapping := range mappings {
		if !p.Results[i].Changed {
			continue
		}
		targetGroups[mapping.NewPath] = append(targetGroups[mapping.NewPath], i)
	}
	for _, group := range targetGroups {
		conflict := false
		for _, i := range group {
			conflict = conflict || p.values[i] != p.values[group[0]]
		}
		if conflict {
			for _, i := range group {
				p.Results[i].Reason = "ocr_target_conflict"
			}
		}
	}
	return p, nil
}

// Save 将通过预检的映射合并为一次保存，保留源键；同值重试不生成历史或写入文件。
func (p *AssetTextRelinkPlan) Save(historyDir string, selected []int) ([]int, error) {
	var changed []int
	texts := maps.Clone(p.texts)
	for _, i := range selected {
		if i < 0 || i >= len(p.Results) {
			return nil, errors.New("invalid OCR mapping index")
		}
		result := p.Results[i]
		if result.Reason != "" {
			return nil, errors.New(result.Reason)
		}
		if !result.Changed {
			continue
		}
		texts[(&url.URL{Path: p.mappings[i].NewPath}).EscapedPath()] = p.values[i]
		changed = append(changed, i)
	}
	if len(changed) == 0 {
		return nil, nil
	}
	assetsTextsLock.Lock()
	defer assetsTextsLock.Unlock()
	if !maps.Equal(p.memory, assetsTexts) {
		return nil, errors.New("OCR metadata changed during asset relink")
	}
	backup, err := json.MarshalIndent(p.texts, "", "  ")
	if err != nil {
		return nil, err
	}
	history := filepath.Join(historyDir, "assets", "ocr-texts.json")
	if err = os.MkdirAll(filepath.Dir(history), 0755); err != nil {
		return nil, err
	}
	if err = gulu.File.WriteFileSafer(history, backup, 0644); err != nil {
		return nil, err
	}
	data, err := json.MarshalIndent(texts, "", "  ")
	if err != nil {
		return nil, err
	}
	if err = WriteFileIfUnchanged(p.path, p.original, data); err != nil {
		return nil, err
	}
	assetsTexts = texts
	assetsTextsChanged.Store(false)
	return changed, nil
}
