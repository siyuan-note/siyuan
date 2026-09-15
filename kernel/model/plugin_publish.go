package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	ErrPluginPublishDenied  = errors.New("plugin publish access denied")
	ErrPluginPublishMissing = errors.New("plugin publish data has not been generated")
	ErrPluginPublishInvalid = errors.New("invalid plugin publish declaration or data")
	pluginPublishLock       sync.Mutex
)

// PluginPublishDeclaration 的资源为精确文件名，数据为可公开的顶层标量字段，不支持目录或通配符。
type PluginPublishDeclaration struct {
	Resources []string `json:"resources"`
	Data      []string `json:"data"`
}

type PluginPublishInfo struct {
	Resources []string `json:"resources"`
	Fields    []string `json:"fields"`
	Granted   bool     `json:"granted"`
}

type pluginPublishState struct {
	Version int                        `json:"version"`
	Granted []string                   `json:"granted"`
	Data    map[string]json.RawMessage `json:"data"`
}

func pluginPublishDeclaration(name string) (PluginPublishDeclaration, error) {
	ret := PluginPublishDeclaration{Resources: []string{}, Data: []string{}}
	if !bazaar.IsValidPackageName(name) {
		return ret, ErrPluginPublishDenied
	}
	file, err := util.OpenPublishFile(util.DataDir, "plugins/"+name+"/plugin.json")
	if err != nil {
		return ret, err
	}
	defer file.Close()
	var manifest struct {
		Name    string                    `json:"name"`
		Publish *PluginPublishDeclaration `json:"publish"`
	}
	content, err := io.ReadAll(io.LimitReader(file, 1024*1024+1))
	if err != nil || len(content) > 1024*1024 || json.Unmarshal(content, &manifest) != nil || manifest.Name != name {
		return ret, ErrPluginPublishInvalid
	}
	if manifest.Publish == nil {
		return ret, nil
	}
	ret = *manifest.Publish
	if len(ret.Resources) > 4096 || len(ret.Data) > 128 {
		return ret, ErrPluginPublishInvalid
	}
	for _, resource := range ret.Resources {
		if !util.IsPublishRelativePath(resource) || strings.EqualFold(resource, "plugin.json") || strings.EqualFold(resource, "kernel.js") {
			return ret, ErrPluginPublishInvalid
		}
	}
	for _, field := range ret.Data {
		if len(field) == 0 || len(field) > 128 {
			return ret, ErrPluginPublishInvalid
		}
		for _, char := range field {
			if !(char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '_' || char == '-') {
				return ret, ErrPluginPublishInvalid
			}
		}
	}
	slices.Sort(ret.Resources)
	ret.Resources = slices.Compact(ret.Resources)
	slices.Sort(ret.Data)
	ret.Data = slices.Compact(ret.Data)
	return ret, nil
}

func isPluginPublishResource(declaration PluginPublishDeclaration, resource string) bool {
	// 标准入口及语言包属于插件既有的前端文件约定，其余文件必须显式声明。
	return resource == "index.js" || resource == "index.css" ||
		strings.HasPrefix(resource, "i18n/") && strings.Count(resource, "/") == 1 && strings.HasSuffix(resource, ".json") ||
		slices.Contains(declaration.Resources, resource)
}

func OpenPluginPublishResource(name, resource string) (*os.File, error) {
	if !CheckPluginAccessableInPublish(name) || !util.IsPublishRelativePath(resource) {
		return nil, ErrPluginPublishDenied
	}
	declaration, err := pluginPublishDeclaration(name)
	if err != nil || !isPluginPublishResource(declaration, resource) {
		return nil, ErrPluginPublishDenied
	}
	return util.OpenPublishFile(util.DataDir, "plugins/"+name+"/"+resource)
}

func loadPluginPublishCode(petal *Petal) bool {
	read := func(resource string) ([]byte, error) {
		file, err := OpenPluginPublishResource(petal.Name, resource)
		if err != nil {
			return nil, err
		}
		defer file.Close()
		return io.ReadAll(file)
	}
	data, err := read("index.js")
	if err != nil {
		return false
	}
	petal.JS, petal.CSS, petal.I18n, petal.Kernel = string(data), "", nil, KernelPetal{}
	if data, err = read("index.css"); err == nil {
		petal.CSS = string(data)
	}
	for _, lang := range []string{Conf.Lang, util.LangToLegacy(Conf.Lang), "en", "zh-CN", "zh_CN"} {
		if data, err = read("i18n/" + lang + ".json"); err == nil && json.Unmarshal(data, &petal.I18n) == nil {
			break
		}
	}
	return true
}

// OpenPublishPackageFile 在文件接口中处理公开文件和包资源，私有存储仍由默认拒绝策略保护。
func OpenPublishPackageFile(c *gin.Context, requestPath string) (file *os.File, handled bool, err error) {
	relative := strings.TrimPrefix(strings.ReplaceAll(requestPath, "\\", "/"), "/")
	for _, prefix := range []string{"data/public/", "data/plugins/", "data/widgets/"} {
		if !strings.HasPrefix(relative, prefix) {
			continue
		}
		if !util.IsPublishRelativePath(relative) {
			return nil, true, ErrPluginPublishDenied
		}
		resource := strings.TrimPrefix(relative, prefix)
		switch prefix {
		case "data/public/":
			file, err = util.OpenPublishFile(util.DataDir, "public/"+resource)
		case "data/plugins/":
			name, path, ok := strings.Cut(resource, "/")
			if !ok {
				return nil, true, ErrPluginPublishDenied
			}
			file, err = OpenPluginPublishResource(name, path)
		case "data/widgets/":
			name, _, ok := strings.Cut(resource, "/")
			if !ok || !CheckWidgetAccessableByPublishAccess(c, name, GetPublishAccess()) {
				return nil, true, ErrPluginPublishDenied
			}
			file, err = util.OpenPublishFile(util.DataDir, "widgets/"+resource)
		}
		return file, true, err
	}
	return nil, false, nil
}

func pluginPublishStatePath(name string) string {
	return filepath.Join(util.ConfDir, "plugin-publish", name+".json")
}

func readPluginPublishState(name string) (pluginPublishState, error) {
	state := pluginPublishState{Version: 1}
	file, err := util.OpenPublishFile(util.ConfDir, "plugin-publish/"+name+".json")
	if errors.Is(err, os.ErrNotExist) {
		return state, nil
	}
	if err != nil {
		return state, err
	}
	defer file.Close()
	content, err := io.ReadAll(io.LimitReader(file, 2*1024*1024+1))
	if err != nil {
		return state, err
	}
	state = pluginPublishState{}
	if len(content) > 2*1024*1024 || json.Unmarshal(content, &state) != nil || state.Version != 1 {
		return state, ErrPluginPublishInvalid
	}
	for field, value := range state.Data {
		value = bytes.TrimSpace(value)
		if !slices.Contains(state.Granted, field) || !json.Valid(value) || value[0] == '{' || value[0] == '[' {
			return state, ErrPluginPublishInvalid
		}
	}
	return state, nil
}

func writePluginPublishState(name string, state pluginPublishState) error {
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Join(util.ConfDir, "plugin-publish"), 0700); err != nil {
		return err
	}
	return gulu.File.WriteFileSafer(pluginPublishStatePath(name), data, 0600)
}

func publishFieldsGranted(declaration PluginPublishDeclaration, state pluginPublishState) bool {
	if len(declaration.Data) == 0 {
		return false
	}
	for _, field := range declaration.Data {
		if !slices.Contains(state.Granted, field) {
			return false
		}
	}
	return true
}

// 收窄声明时同步删除授权和快照中的字段，避免字段重新加入声明后恢复旧数据。
func reconcilePluginPublishState(name string, declaration PluginPublishDeclaration) (pluginPublishState, error) {
	state, err := readPluginPublishState(name)
	if err != nil {
		return state, err
	}
	changed := false
	granted := make([]string, 0, len(state.Granted))
	for _, field := range state.Granted {
		if slices.Contains(declaration.Data, field) {
			granted = append(granted, field)
		} else {
			changed = true
			delete(state.Data, field)
		}
	}
	state.Granted = granted
	if changed {
		err = writePluginPublishState(name, state)
	}
	return state, err
}

func GetPluginPublishInfo(name string) (PluginPublishInfo, error) {
	pluginPublishLock.Lock()
	defer pluginPublishLock.Unlock()
	declaration, err := pluginPublishDeclaration(name)
	if err != nil {
		return PluginPublishInfo{}, err
	}
	state, err := reconcilePluginPublishState(name, declaration)
	return PluginPublishInfo{Resources: append([]string{}, declaration.Resources...), Fields: append([]string{}, declaration.Data...),
		Granted: err == nil && publishFieldsGranted(declaration, state)}, err
}

func SetPluginPublishDataGrant(name string, fields []string, enabled bool) error {
	pluginPublishLock.Lock()
	defer pluginPublishLock.Unlock()
	declaration, err := pluginPublishDeclaration(name)
	if err != nil {
		return err
	}
	if _, err = readPluginPublishState(name); err != nil {
		return err
	}
	state := pluginPublishState{Version: 1}
	if enabled {
		slices.Sort(fields)
		if len(fields) == 0 || !slices.Equal(fields, declaration.Data) {
			return ErrPluginPublishInvalid
		}
		state.Granted = fields
	}
	return writePluginPublishState(name, state)
}

func SavePluginPublishData(name string, data map[string]json.RawMessage) error {
	pluginPublishLock.Lock()
	defer pluginPublishLock.Unlock()
	declaration, err := pluginPublishDeclaration(name)
	if err != nil {
		return err
	}
	state, err := reconcilePluginPublishState(name, declaration)
	if err != nil {
		return err
	}
	if !publishFieldsGranted(declaration, state) {
		return ErrPluginPublishDenied
	}
	if data == nil {
		return ErrPluginPublishInvalid
	}
	total := 0
	for field, value := range data {
		value = bytes.TrimSpace(value)
		total += len(value)
		if !slices.Contains(declaration.Data, field) || !json.Valid(value) || value[0] == '{' || value[0] == '[' || total > 1024*1024 {
			return ErrPluginPublishInvalid
		}
	}
	state.Data = data
	return writePluginPublishState(name, state)
}

func LoadPluginPublishData(name string) (map[string]json.RawMessage, error) {
	pluginPublishLock.Lock()
	defer pluginPublishLock.Unlock()
	if !CheckPluginAccessableInPublish(name) {
		return nil, ErrPluginPublishDenied
	}
	declaration, err := pluginPublishDeclaration(name)
	if err != nil {
		return nil, err
	}
	state, err := reconcilePluginPublishState(name, declaration)
	if err != nil {
		return nil, err
	}
	if !publishFieldsGranted(declaration, state) {
		return nil, ErrPluginPublishDenied
	}
	if state.Data == nil {
		return nil, ErrPluginPublishMissing
	}
	data := map[string]json.RawMessage{}
	for _, field := range declaration.Data {
		if value, ok := state.Data[field]; ok {
			data[field] = value
		}
	}
	return data, nil
}

// removePluginPublishData 在持有发布状态锁的卸载流程中撤销授权并删除副本，删除失败时中止卸载。
func removePluginPublishData(name string) error {
	if !bazaar.IsValidPackageName(name) {
		return ErrPluginPublishDenied
	}
	err := os.Remove(pluginPublishStatePath(name))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
