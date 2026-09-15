package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func pluginPublishFailure[T any](err error) apicontract.Response[T] {
	code := http.StatusInternalServerError
	switch {
	case errors.Is(err, model.ErrPluginPublishDenied):
		code = http.StatusForbidden
	case errors.Is(err, model.ErrPluginPublishMissing):
		code = http.StatusNotFound
	case errors.Is(err, model.ErrPluginPublishInvalid):
		code = http.StatusBadRequest
	}
	return apicontract.Failure[T](code, http.StatusText(code))
}

var getPluginPublishInfo = contractHandler(apicontract.GetPluginPublishInfo, func(c *gin.Context, request apicontract.PluginPublishRequest) apicontract.Response[apicontract.PluginPublishInfo] {
	c.Header("Cache-Control", "private, no-store")
	info, err := model.GetPluginPublishInfo(request.PackageName)
	if err != nil {
		return pluginPublishFailure[apicontract.PluginPublishInfo](err)
	}
	return apicontract.Success(apicontract.PluginPublishInfo{Resources: info.Resources, Fields: info.Fields, Granted: info.Granted})
})

var setPluginPublishDataGrant = contractHandler(apicontract.SetPluginPublishDataGrant, func(c *gin.Context, request apicontract.SetPluginPublishDataGrantRequest) apicontract.Response[apicontract.Null] {
	if err := model.SetPluginPublishDataGrant(request.PackageName, request.Fields, request.Enabled); err != nil {
		return pluginPublishFailure[apicontract.Null](err)
	}
	return apicontract.Success(apicontract.Null{})
})

var savePluginPublishData = contractHandler(apicontract.SavePluginPublishData, func(c *gin.Context, request apicontract.SavePluginPublishDataRequest) apicontract.Response[apicontract.Null] {
	data := map[string]json.RawMessage{}
	for key, value := range request.Data {
		raw, err := value.MarshalJSON()
		if err != nil {
			return pluginPublishFailure[apicontract.Null](err)
		}
		data[key] = raw
	}
	if err := model.SavePluginPublishData(request.PackageName, data); err != nil {
		return pluginPublishFailure[apicontract.Null](err)
	}
	return apicontract.Success(apicontract.Null{})
})

var loadPluginPublishData = contractHandler(apicontract.LoadPluginPublishData, func(c *gin.Context, request apicontract.PluginPublishRequest) apicontract.Response[map[string]apicontract.PublishDataValue] {
	c.Header("Cache-Control", "private, no-store")
	data, err := model.LoadPluginPublishData(request.PackageName)
	if err != nil {
		return pluginPublishFailure[map[string]apicontract.PublishDataValue](err)
	}
	result := map[string]apicontract.PublishDataValue{}
	for key, raw := range data {
		var value apicontract.PublishDataValue
		if err = value.UnmarshalJSON(raw); err != nil {
			return pluginPublishFailure[map[string]apicontract.PublishDataValue](err)
		}
		result[key] = value
	}
	return apicontract.Success(result)
})
