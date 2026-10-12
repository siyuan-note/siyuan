package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sync"

	"github.com/siyuan-note/siyuan/kernel/util"
)

// Issue 描述配置字段诊断，error 阻断提交，warning 随成功结果返回。
type Issue struct {
	Field    string `json:"field"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
}

type ValidationError struct{ Issues []Issue }

func (err *ValidationError) Error() string {
	for _, issue := range err.Issues {
		if issue.Severity == "error" {
			return issue.Message
		}
	}
	return "invalid configuration"
}

type Reaction[C any] struct {
	Name    string
	Changed func(old, next C) bool
	Apply   func(old, next C)
}

// SectionSpec 集中描述配置段规范化、诊断和反应，写锁仅属于该配置段。
type SectionSpec[C any] struct {
	Config    *AppConf
	Namespace string
	Load      func() C
	Store     func(C)
	Normalize func(C) C
	Validate  func(C) []Issue
	WriteLock *sync.Mutex
	Reactions []Reaction[C]
}

type registeredSection interface {
	apply(any) ([]Issue, error)
	patch([]byte) ([]Issue, error)
	load() any
}

func (spec *SectionSpec[C]) load() any { return spec.Load() }

func (spec *SectionSpec[C]) apply(value any) ([]Issue, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var next C
	if err = json.Unmarshal(data, &next); err != nil {
		return nil, err
	}
	return Apply(spec, next)
}

// Apply 在段写锁下完成规范化和诊断，再持配置锁发布并同步落盘。
// 反应在配置锁外执行，允许动作读取配置或更新领域状态。
func Apply[C any](spec *SectionSpec[C], next C) ([]Issue, error) {
	spec.WriteLock.Lock()
	defer spec.WriteLock.Unlock()
	return applySectionLocked(spec, next)
}

func applySectionLocked[C any](spec *SectionSpec[C], next C) ([]Issue, error) {
	var expected C
	return applySectionLockedAt(spec, next, expected, false)
}

var errConfSectionChanged = errors.New("configuration section changed before commit")

// applySectionLockedAt 在提交前核对增量更新的来源快照，避免覆盖资源刷新或事务路径的并发发布。
func applySectionLockedAt[C any](spec *SectionSpec[C], next, expected C, checkSource bool) ([]Issue, error) {
	data, err := json.Marshal(next)
	if err != nil {
		return nil, err
	}
	var cloned C
	if err = json.Unmarshal(data, &cloned); err != nil {
		return nil, err
	}
	next = cloned
	next = spec.Normalize(next)
	var issues []Issue
	if spec.Validate != nil {
		issues = spec.Validate(next)
		for _, issue := range issues {
			if issue.Severity == "error" {
				return issues, &ValidationError{issues}
			}
		}
	}
	current := spec.Config
	if current == nil {
		current = Conf
	}
	current.m.Lock()
	old := spec.Load()
	if checkSource && !reflect.DeepEqual(old, expected) {
		current.m.Unlock()
		return nil, errConfSectionChanged
	}
	spec.Store(next)
	applyConfRuntime(current)
	if !util.ReadOnly {
		current.saveLocked()
	}
	current.m.Unlock()
	for _, reaction := range spec.Reactions {
		if !reflect.ValueOf(old).IsZero() && reaction.Changed(old, next) {
			reaction.Apply(old, next)
		}
	}
	if current == Conf {
		NotifyConfChanged(spec.Namespace)
	}
	return issues, nil
}

func newSectionSpec[T any](namespace string, field *ConfSection[T], normalize func(*T) *T,
	reactions ...Reaction[*T]) *SectionSpec[*T] {
	return newSectionSpecFor(Conf, namespace, field, normalize, reactions...)
}

func newSectionSpecFor[T any](current *AppConf, namespace string, field *ConfSection[T], normalize func(*T) *T,
	reactions ...Reaction[*T]) *SectionSpec[*T] {
	if field.cell == nil {
		field.Store(nil)
	}
	return &SectionSpec[*T]{Config: current, Namespace: namespace, Load: field.Load, Store: field.Store,
		Normalize: normalize, WriteLock: &field.cell.mu, Reactions: reactions}
}

// SectionSpecByNamespace 返回当前工作空间的注册项，不缓存可替换的 AppConf 地址。
func SectionSpecByNamespace(namespace string) (registeredSection, bool) {
	factory, ok := confSectionSpecFactories[namespace]
	if !ok {
		return nil, false
	}
	return factory(), true
}

func ApplyConfSection(namespace string, value any) ([]Issue, error) {
	spec, ok := SectionSpecByNamespace(namespace)
	if !ok {
		return nil, fmt.Errorf("unsupported configuration section: %s", namespace)
	}
	return spec.apply(value)
}
