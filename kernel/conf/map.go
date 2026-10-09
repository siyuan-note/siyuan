// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License, version 3 or later.

package conf

import (
	"encoding/hex"
	"regexp"

	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	MapProviderAMap        = "amap"
	MapProviderTencent     = "tencent"
	MapProviderBaidu       = "baidu"
	MapProviderOpenFreeMap = "openfreemap"
)

// Map 将本机地图服务配置保存在 conf.json 中，不参与数据同步。
// 凭据沿用应用现有的 AES 落盘方式，不提供独立保险库的安全保证。
type Map struct {
	Services []*MapService `json:"services"`
	Revision string        `json:"revision"`
}

type MapService struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Provider     string `json:"provider"`
	APIKey       string `json:"apiKey,omitempty"`
	SecurityCode string `json:"securityCode,omitempty"`

	// 清除凭据后保留存在状态，供公开配置 DTO 使用。
	hasAPIKey       bool
	hasSecurityCode bool
}

func NewMap() *Map {
	return &Map{Services: []*MapService{}}
}

var mapServiceIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`)

func IsMapServiceID(id string) bool {
	return mapServiceIDPattern.MatchString(id)
}

func IsMapProvider(provider string) bool {
	switch provider {
	case MapProviderAMap, MapProviderTencent, MapProviderBaidu, MapProviderOpenFreeMap:
		return true
	}
	return false
}

func (service *MapService) HasAPIKey() bool {
	return service != nil && (service.APIKey != "" || service.hasAPIKey)
}

func (service *MapService) HasSecurityCode() bool {
	return service != nil && (service.SecurityCode != "" || service.hasSecurityCode)
}

func (service *MapService) Configured() bool {
	if service == nil {
		return false
	}
	switch service.Provider {
	case MapProviderAMap:
		return service.HasAPIKey() && service.HasSecurityCode()
	case MapProviderTencent, MapProviderBaidu:
		return service.HasAPIKey()
	case MapProviderOpenFreeMap:
		return true
	}
	return false
}

// Masked 返回独立的脱敏副本，保留服务标识和凭据存在状态。
func (config *Map) Masked() *Map {
	ret := NewMap()
	if config == nil {
		return ret
	}
	ret.Revision = config.Revision
	for _, service := range config.Services {
		if service == nil {
			continue
		}
		ret.Services = append(ret.Services, &MapService{
			ID: service.ID, Name: service.Name, Provider: service.Provider,
			hasAPIKey: service.HasAPIKey(), hasSecurityCode: service.HasSecurityCode(),
		})
	}
	return ret
}

func (config *Map) EncryptCredentials() {
	if config == nil {
		return
	}
	for _, service := range config.Services {
		if service == nil {
			continue
		}
		if service.APIKey != "" {
			service.APIKey = util.AESEncrypt(service.APIKey)
		}
		if service.SecurityCode != "" {
			service.SecurityCode = util.AESEncrypt(service.SecurityCode)
		}
	}
}

func (config *Map) DecryptCredentials() {
	if config == nil {
		return
	}
	for _, service := range config.Services {
		if service != nil {
			service.APIKey = decryptMapCredential(service.APIKey)
			service.SecurityCode = decryptMapCredential(service.SecurityCode)
		}
	}
}

// 无法识别的内容保持原样，避免解密失败破坏已保存的凭据。
func decryptMapCredential(value string) (ret string) {
	ret = value
	encrypted, err := hex.DecodeString(value)
	if err != nil || len(encrypted) == 0 || len(encrypted)%16 != 0 {
		return
	}
	defer func() { _ = recover() }()
	decrypted := util.AESDecrypt(value)
	if len(decrypted) == 0 {
		return
	}
	if plain, err := hex.DecodeString(string(decrypted)); err == nil {
		ret = string(plain)
	}
	return
}
