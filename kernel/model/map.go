// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License, version 3 or later.

package model

import (
	"errors"
	"path/filepath"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// MapServiceInput 包含只写凭据：省略时保留相同供应商的值，显式空字符串清除该值。
type MapServiceInput struct {
	ID           string
	Name         string
	Provider     string
	APIKey       *string
	SecurityCode *string
}

func normalizeMapConfig(config *conf.Map) *conf.Map {
	if config == nil {
		// 仅缺失配置时预置服务；已保存的空列表表示用户没有服务，不再自动补回。
		// 内置服务使用稳定标识，使其他设备首次初始化后可以解析同步视图中的同一引用。
		return &conf.Map{
			Services: []*conf.MapService{{ID: "builtin-openfreemap", Name: "OpenFreeMap", Provider: conf.MapProviderOpenFreeMap}},
			Revision: ast.NewNodeID(),
		}
	}
	if config.Services == nil {
		config.Services = []*conf.MapService{}
	}
	return config
}

func (appConf *AppConf) GetMap() *conf.Map {
	appConf.m.RLock()
	defer appConf.m.RUnlock()
	return appConf.Map.Masked()
}

// SetMap 原子替换服务列表。本机尚不存在的指定 ID 也会原样保留，允许补充同步视图引用的服务。
func (appConf *AppConf) SetMap(inputs []MapServiceInput, expectedRevision string) (*conf.Map, error) {
	appConf.m.Lock()
	defer appConf.m.Unlock()
	if util.ReadOnly {
		return nil, errors.New("workspace is read-only")
	}
	currentRevision := ""
	if appConf.Map != nil {
		currentRevision = appConf.Map.Revision
	}
	if expectedRevision != currentRevision {
		return nil, errors.New("mapSettingsConflict")
	}
	if len(inputs) > 100 {
		return nil, errors.New("too many map services")
	}
	existing := map[string]*conf.MapService{}
	if appConf.Map != nil {
		for _, service := range appConf.Map.Services {
			if service != nil {
				existing[service.ID] = service
			}
		}
	}
	next := conf.NewMap()
	seen := map[string]bool{}
	for _, input := range inputs {
		id := input.ID
		if id == "" {
			id = ast.NewNodeID()
		}
		if !conf.IsMapServiceID(id) || seen[id] {
			return nil, errors.New("invalid or duplicate map service ID")
		}
		seen[id] = true
		name := strings.TrimSpace(input.Name)
		if name == "" || len(name) > 256 {
			return nil, errors.New("map service name must contain 1 to 256 bytes")
		}
		if !conf.IsMapProvider(input.Provider) {
			return nil, errors.New("unsupported map provider")
		}
		service := &conf.MapService{ID: id, Name: name, Provider: input.Provider}
		if old := existing[id]; old != nil && old.Provider == input.Provider {
			service.APIKey, service.SecurityCode = old.APIKey, old.SecurityCode
		}
		if input.APIKey != nil {
			service.APIKey = strings.TrimSpace(*input.APIKey)
		}
		if input.SecurityCode != nil {
			service.SecurityCode = strings.TrimSpace(*input.SecurityCode)
		}
		if len(service.APIKey) > 4096 || len(service.SecurityCode) > 4096 {
			return nil, errors.New("map credential is too long")
		}
		if service.Provider == conf.MapProviderOpenFreeMap {
			if input.APIKey != nil && service.APIKey != "" || input.SecurityCode != nil && service.SecurityCode != "" {
				return nil, errors.New("OpenFreeMap does not use credentials")
			}
			service.APIKey, service.SecurityCode = "", ""
		} else if service.Provider != conf.MapProviderAMap {
			if input.SecurityCode != nil && service.SecurityCode != "" {
				return nil, errors.New("this map provider does not use a security code")
			}
			service.SecurityCode = ""
		}
		next.Services = append(next.Services, service)
	}
	previous := appConf.Map
	// 版本号与凭据内容无关，只有成功写入后才对其他调用可见。
	next.Revision = ast.NewNodeID()
	appConf.Map = next
	data, err := appConf.marshalForSave()
	if err == nil {
		err = filelock.WriteFile(filepath.Join(util.ConfDir, "conf.json"), data)
	}
	if err != nil {
		appConf.Map = previous
		return nil, errors.New("could not save map configuration")
	}
	return next.Masked(), nil
}

// GetMapRuntime 只返回明确选中且已配置的本机服务，不为缺失 ID 回退到其他服务或借用凭据。
func (appConf *AppConf) GetMapRuntime(serviceID string) (*conf.MapService, error) {
	appConf.m.RLock()
	defer appConf.m.RUnlock()
	if !conf.IsMapServiceID(serviceID) {
		return nil, errors.New("invalid map service ID")
	}
	if appConf.Map != nil {
		for _, service := range appConf.Map.Services {
			if service == nil || service.ID != serviceID {
				continue
			}
			if !service.Configured() {
				return nil, errors.New("map service is not configured on this device")
			}
			ret := *service
			if ret.Provider == conf.MapProviderOpenFreeMap {
				ret.APIKey = ""
			}
			if ret.Provider != conf.MapProviderAMap {
				ret.SecurityCode = ""
			}
			return &ret, nil
		}
	}
	return nil, errors.New("map service is missing on this device")
}
