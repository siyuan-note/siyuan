package model

import (
	"encoding/json"
	"sync"
	"sync/atomic"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

// ConfSection 原子发布不可变配置段，复制容器时不会复制原子变量或写锁。
type ConfSection[T any] struct {
	cell *confSectionCell[T]
}

type confSectionCell[T any] struct {
	value atomic.Pointer[T]
	mu    sync.Mutex
}

func NewConfSection[T any](value *T) ConfSection[T] {
	section := ConfSection[T]{cell: &confSectionCell[T]{}}
	section.cell.value.Store(value)
	return section
}

func (section ConfSection[T]) Load() *T {
	if section.cell == nil {
		return nil
	}
	return section.cell.value.Load()
}

// Store 在初始化阶段允许补建容器，发布配置后只原子替换段快照。
func (section *ConfSection[T]) Store(value *T) {
	if section.cell == nil {
		*section = NewConfSection(value)
		return
	}
	section.cell.value.Store(value)
}

func (section ConfSection[T]) MarshalJSON() ([]byte, error) {
	return json.Marshal(section.Load())
}

// SnapshotValue 供配置检查器遍历段内容，不暴露原子容器或互斥实现。
func (section ConfSection[T]) SnapshotValue() any {
	return section.Load()
}

func (section *ConfSection[T]) UnmarshalJSON(data []byte) error {
	var value *T
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	section.Store(value)
	return nil
}

func (section ConfSection[T]) Clone() ConfSection[T] {
	return NewConfSection(cloneConfSection(section.Load()))
}

// cloneSettings 复制配置容器和段内容，保证重置或事务回滚不改写当前快照。
func (c *AppConf) cloneSettings() AppConf {
	next := *c
	next.Appearance = c.Appearance.Clone()
	next.FileTree = c.FileTree.Clone()
	next.Tag = c.Tag.Clone()
	next.Editor = c.Editor.Clone()
	next.Export = c.Export.Clone()
	next.Graph = c.Graph.Clone()
	next.UILayout = c.UILayout.Clone()
	next.System = c.System.Clone()
	next.Keymap = c.Keymap.Clone()
	next.Sync = c.Sync.Clone()
	next.Search = c.Search.Clone()
	next.Flashcard = c.Flashcard.Clone()
	next.AI = c.AI.Clone()
	next.OCR = c.OCR.Clone()
	next.Secrets = c.Secrets.Clone()
	next.Variables = c.Variables.Clone()
	next.Bazaar = c.Bazaar.Clone()
	next.Stat = c.Stat.Clone()
	next.Api = c.Api.Clone()
	next.Repo = c.Repo.Clone()
	next.Publish = c.Publish.Clone()
	next.Onboarding = c.Onboarding.Clone()
	next.Snippet = c.Snippet.Clone()
	return next
}

// 段读取方法允许尚未初始化的配置，调用方在自己的有效性判断之后使用取得的快照。
func (c *AppConf) LoadAppearance() *conf.Appearance {
	if c == nil {
		return nil
	}
	return c.Appearance.Load()
}

func (c *AppConf) LoadFileTree() *conf.FileTree {
	if c == nil {
		return nil
	}
	return c.FileTree.Load()
}

func (c *AppConf) LoadTag() *conf.Tag {
	if c == nil {
		return nil
	}
	return c.Tag.Load()
}

func (c *AppConf) LoadEditor() *conf.Editor {
	if c == nil {
		return nil
	}
	return c.Editor.Load()
}

func (c *AppConf) LoadExport() *conf.Export {
	if c == nil {
		return nil
	}
	return c.Export.Load()
}

func (c *AppConf) LoadGraph() *conf.Graph {
	if c == nil {
		return nil
	}
	return c.Graph.Load()
}

func (c *AppConf) LoadUILayout() *conf.UILayout {
	if c == nil {
		return nil
	}
	return c.UILayout.Load()
}

func (c *AppConf) LoadSystem() *conf.System {
	if c == nil {
		return nil
	}
	return c.System.Load()
}

func (c *AppConf) LoadKeymap() *conf.Keymap {
	if c == nil {
		return nil
	}
	return c.Keymap.Load()
}

func (c *AppConf) LoadSync() *conf.Sync {
	if c == nil {
		return nil
	}
	return c.Sync.Load()
}

func (c *AppConf) LoadSearch() *conf.Search {
	if c == nil {
		return nil
	}
	return c.Search.Load()
}

func (c *AppConf) LoadFlashcard() *conf.Flashcard {
	if c == nil {
		return nil
	}
	return c.Flashcard.Load()
}

func (c *AppConf) LoadAI() *conf.AI {
	if c == nil {
		return nil
	}
	return c.AI.Load()
}

func (c *AppConf) LoadOCR() *conf.OCR {
	if c == nil {
		return nil
	}
	return c.OCR.Load()
}

func (c *AppConf) LoadSecrets() *conf.Secrets {
	if c == nil {
		return nil
	}
	return c.Secrets.Load()
}

func (c *AppConf) LoadVariables() *conf.Variables {
	if c == nil {
		return nil
	}
	return c.Variables.Load()
}

func (c *AppConf) LoadBazaar() *conf.Bazaar {
	if c == nil {
		return nil
	}
	return c.Bazaar.Load()
}

func (c *AppConf) LoadStat() *conf.Stat {
	if c == nil {
		return nil
	}
	return c.Stat.Load()
}

func (c *AppConf) LoadApi() *conf.API {
	if c == nil {
		return nil
	}
	return c.Api.Load()
}

func (c *AppConf) LoadRepo() *conf.Repo {
	if c == nil {
		return nil
	}
	return c.Repo.Load()
}

func (c *AppConf) LoadPublish() *conf.Publish {
	if c == nil {
		return nil
	}
	return c.Publish.Load()
}

func (c *AppConf) LoadOnboarding() *conf.Onboarding {
	if c == nil {
		return nil
	}
	return c.Onboarding.Load()
}

func (c *AppConf) LoadSnippet() *conf.Snpt {
	if c == nil {
		return nil
	}
	return c.Snippet.Load()
}
