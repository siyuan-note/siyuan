// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License, version 3 or later.

package util

import (
	"context"
	"errors"
	"path"
	"path/filepath"
	"strings"
	"sync"
)

const PluginDevelopmentSkillName = "siyuan-plugin-development"

// PluginDevelopmentGrant 只由智能体运行时从服务器保存的确认记录投影，不接受工具 JSON 构造。
type PluginDevelopmentGrant struct {
	SessionID      string
	TaskID         string
	PlanHash       string
	PlanVersion    int
	SkillVersion   string
	SkillDigest    string
	Frontend       string
	PackageName    string
	SourceRoot     string
	SourcePath     string
	SourceRevision string
	AllowFiles     []string
}

type pluginDevelopmentContextKey struct{}
type pluginDevelopmentAccess func(string) (*PluginDevelopmentGrant, error)

// WithPluginDevelopmentAccess 将每次执行前重新校验的服务器回调放入私有上下文键。
func WithPluginDevelopmentAccess(ctx context.Context, check func(string) (*PluginDevelopmentGrant, error)) context.Context {
	return context.WithValue(ctx, pluginDevelopmentContextKey{}, pluginDevelopmentAccess(check))
}

func RequirePluginDevelopment(ctx context.Context, operation string) (*PluginDevelopmentGrant, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if ReadOnly && (operation == "write" || operation == "recover" || operation == "recovered") {
		return nil, errors.New("workspace is read-only")
	}
	check, ok := ctx.Value(pluginDevelopmentContextKey{}).(pluginDevelopmentAccess)
	if !ok || check == nil {
		return nil, errors.New("official plugin development requires a confirmed agent workflow")
	}
	grant, err := check(operation)
	if err != nil {
		return nil, err
	}
	if grant == nil || grant.SessionID == "" || grant.TaskID == "" {
		return nil, errors.New("official plugin development authorization is unavailable")
	}
	copy := *grant
	copy.AllowFiles = append([]string(nil), grant.AllowFiles...)
	return &copy, nil
}

func PluginProjectsDir() string {
	return filepath.Join(DataDir, "storage", "ai", "agent", "plugin-projects")
}

func PluginProjectRoot(taskID string) string {
	return filepath.Join(PluginProjectsDir(), taskID)
}

func PluginProjectPrivateDir(taskID string) string {
	return filepath.Join(ConfDir, "plugin-development", taskID)
}

func pluginDevelopmentNormalizedPath(p string) string {
	return pluginDevelopmentLexicalPath(NormalizeAndResolve(ResolveLongestExistingParent(p)))
}

// Windows 的流名称、尾部点和空格不能把宿主保留路径变成普通文件入口。
func pluginDevelopmentLexicalPath(p string) string {
	parts := strings.Split(strings.ReplaceAll(filepath.ToSlash(filepath.Clean(p)), "\\", "/"), "/")
	for i, part := range parts {
		if i == 0 && len(part) == 2 && part[1] == ':' {
			parts[i] = strings.ToLower(part)
			continue
		}
		if colon := strings.IndexByte(part, ':'); colon >= 0 {
			part = part[:colon]
		}
		part = strings.TrimRight(part, " ")
		if part != "." && part != ".." {
			part = strings.TrimRight(part, ". ")
		}
		parts[i] = strings.ToLower(part)
	}
	return path.Clean(strings.Join(parts, "/"))
}

func pluginDevelopmentContains(root, candidate string) bool {
	for _, pair := range [][2]string{
		{pluginDevelopmentLexicalPath(root), pluginDevelopmentLexicalPath(candidate)},
		{pluginDevelopmentNormalizedPath(root), pluginDevelopmentNormalizedPath(candidate)},
	} {
		if pair[1] == pair[0] || strings.HasPrefix(pair[1], pair[0]+"/") {
			return true
		}
	}
	return false
}

func IsPluginProjectPath(abs string) bool {
	return pluginDevelopmentContains(PluginProjectsDir(), abs)
}

func IsPluginProjectDeliveryPath(abs string) bool {
	root := filepath.Join(TempDir, "export")
	for _, candidate := range []string{abs, ResolveLongestExistingParent(abs)} {
		if pluginDevelopmentContains(root, candidate) {
			name := path.Base(pluginDevelopmentLexicalPath(candidate))
			if strings.HasPrefix(name, "plugin-project-") && strings.HasSuffix(name, ".zip") {
				return true
			}
		}
	}
	return false
}

func IsPluginDevelopmentRawWriteForbidden(abs string) bool {
	return IsPluginDevelopmentRawPathForbidden(abs, false) || IsPluginProjectDeliveryPath(abs)
}

// IsProtectedAgentStatePath 保护服务器运行状态，保留会话 output 目录的普通只读访问。
func IsProtectedAgentStatePath(abs string) bool {
	root := filepath.Join(DataDir, "storage", "ai", "agent", "sessions")
	rel, err := filepath.Rel(pluginDevelopmentNormalizedPath(root), pluginDevelopmentNormalizedPath(abs))
	if err != nil {
		return false
	}
	parts := strings.Split(filepath.ToSlash(rel), "/")
	// filelock 的原子保存使用 runtime.json<随机串>.tmp，同样属于服务器私有状态。
	return len(parts) == 2 && parts[0] != ".." && strings.HasPrefix(strings.ToLower(parts[1]), "runtime.json")
}

// IsPluginDevelopmentRawPathForbidden 同时检查词法路径和链接目标；目录变更还保护宿主管理根的祖先。
func IsPluginDevelopmentRawPathForbidden(abs string, ancestors bool) bool {
	for _, candidate := range []string{filepath.Clean(abs), ResolveLongestExistingParent(abs)} {
		if pluginDevelopmentContains(filepath.Join(TempDir, "export"), candidate) {
			name := path.Base(pluginDevelopmentLexicalPath(candidate))
			if strings.HasPrefix(name, ".plugin-project-") && strings.HasSuffix(name, ".tmp") {
				return true
			}
		}
		for _, component := range strings.Split(pluginDevelopmentLexicalPath(candidate), "/") {
			if strings.HasPrefix(component, ".siyuan-package-install-") {
				return true
			}
		}
		for _, root := range []string{PluginProjectsDir(), filepath.Join(ConfDir, "plugin-development")} {
			if pluginDevelopmentContains(root, candidate) || ancestors && pluginDevelopmentContains(candidate, root) {
				return true
			}
		}
		if IsProtectedAgentStatePath(candidate) {
			return true
		}
		if ancestors {
			if IsPluginProjectDeliveryPath(candidate) || pluginDevelopmentContains(candidate, filepath.Join(TempDir, "export")) {
				return true
			}
			for _, packages := range []string{filepath.Join(DataDir, "plugins"), filepath.Join(DataDir, "widgets"), filepath.Join(DataDir, "templates"), ThemesPath, IconsPath} {
				if packages != "" && pluginDevelopmentContains(candidate, packages) {
					return true
				}
			}
			sessions := filepath.Join(DataDir, "storage", "ai", "agent", "sessions")
			if pluginDevelopmentContains(candidate, sessions) {
				return true
			}
			rel, err := filepath.Rel(pluginDevelopmentNormalizedPath(sessions), pluginDevelopmentNormalizedPath(candidate))
			if err == nil && rel != "." && rel != ".." && !strings.Contains(filepath.ToSlash(rel), "/") {
				return true
			}
		}
	}
	return false
}

var pluginProjectLocks sync.Map

// WithPluginProjectLock 串行化受管项目内的写入、冻结与恢复；不阻止不遵守协议的外部编辑器。
func WithPluginProjectLock(taskID string, fn func() error) error {
	return WithPluginProjectLockContext(context.Background(), taskID, fn)
}

func WithPluginProjectLockContext(ctx context.Context, taskID string, fn func() error) error {
	value, _ := pluginProjectLocks.LoadOrStore(taskID, make(chan struct{}, 1))
	lock := value.(chan struct{})
	select {
	case lock <- struct{}{}:
		defer func() { <-lock }()
	case <-ctx.Done():
		return ctx.Err()
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return fn()
}
