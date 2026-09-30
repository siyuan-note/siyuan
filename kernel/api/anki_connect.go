package api

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var ankiConnect = contractHandler(apicontract.AnkiConnect, func(c *gin.Context, request apicontract.AnkiConnectRequest) apicontract.Response[apicontract.AnkiConnectResponse] {
	var data []byte
	err := model.AuthorizeAnkiConnect(c, request.Key)
	if err == nil {
		data, err = model.ProcessAnkiConnect(c.Request.Context(), request, util.ReadOnly || model.IsReadOnlyRoleContext(c))
	}
	if err != nil {
		data, _ = json.Marshal(struct {
			Result *string `json:"result"`
			Error  string  `json:"error"`
		}{Error: err.Error()})
	}
	value, _ := apicontract.NewAnkiConnectResponse(data)
	return apicontract.SuccessDirectJSON(value)
}, func(c *gin.Context) *apicontract.Response[apicontract.AnkiConnectResponse] {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 48<<20)
	return nil
})
