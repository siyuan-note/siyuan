package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func mapConfPayload(config *conf.Map) *apicontract.MapConfig {
	ret := &apicontract.MapConfig{Services: []*apicontract.MapService{}}
	if config != nil {
		ret.Revision = config.Revision
		for _, service := range config.Services {
			if service != nil && conf.IsMapProvider(service.Provider) {
				ret.Services = append(ret.Services, &apicontract.MapService{
					ID: service.ID, Name: service.Name, Provider: service.Provider,
					HasAPIKey: service.HasAPIKey(), HasSecurityCode: service.HasSecurityCode(), Configured: service.Configured(),
				})
			}
		}
	}
	return ret
}

// 路由中间件之外保留处理器内的权限检查，拒绝发布上下文和非管理员内部调用，并禁止缓存响应。
func mapAdminAdmission[Data any](c *gin.Context) *apicontract.Response[Data] {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	if !model.IsAdminRoleContext(c) {
		response := apicontract.Failure[Data](-1, "administrator access required")
		return &response
	}
	return nil
}

var getMapConf = contractHandler(apicontract.MapGetConf, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[*apicontract.MapConfig] {
	return apicontract.Success(mapConfPayload(model.Conf.GetMap()))
}, mapAdminAdmission[*apicontract.MapConfig])

var setMapConf = contractHandler(apicontract.MapSetConf, serializeSetting("map", func(c *gin.Context, request apicontract.MapSetConfRequest) apicontract.Response[*apicontract.MapConfig] {
	inputs := make([]model.MapServiceInput, len(request.Services))
	for i, service := range request.Services {
		inputs[i] = model.MapServiceInput{ID: service.ID, Name: service.Name, Provider: service.Provider, APIKey: service.APIKey, SecurityCode: service.SecurityCode}
	}
	config, err := model.Conf.SetMap(inputs, request.ExpectedRevision)
	if err != nil {
		return apicontract.Failure[*apicontract.MapConfig](-1, err.Error())
	}
	return apicontract.Success(mapConfPayload(config))
}), mapAdminAdmission[*apicontract.MapConfig])

var getMapRuntime = contractHandler(apicontract.MapGetRuntime, func(c *gin.Context, request apicontract.MapRuntimeRequest) apicontract.Response[*apicontract.MapRuntime] {
	service, err := model.Conf.GetMapRuntime(request.ServiceID)
	if err != nil {
		return apicontract.Failure[*apicontract.MapRuntime](-1, err.Error())
	}
	return apicontract.Success(&apicontract.MapRuntime{Provider: service.Provider, APIKey: service.APIKey, SecurityCode: service.SecurityCode})
}, mapRuntimeAdmission)

func mapRuntimeAdmission(c *gin.Context) *apicontract.Response[*apicontract.MapRuntime] {
	if denied := mapAdminAdmission[*apicontract.MapRuntime](c); denied != nil {
		return denied
	}
	// 沙箱自身导航后不再继承初始 CSP，必须由内核鉴权拒绝 opaque-origin 请求。
	// 跳过空口令检查的启动模式不保证该边界，即使当前设置了口令也不启用 SDK。
	if util.SiYuanAccessAuthCodeBypass {
		response := apicontract.Failure[*apicontract.MapRuntime](-1, "mapAuthenticationBypass")
		return &response
	}
	return nil
}
