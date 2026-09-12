package api

import (
	"fmt"
	"net/http"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

// contractHandler 将请求绑定和响应类型与注册契约关联，业务入口继续使用现有中间件。
func contractHandler[Request, Data any](endpoint apicontract.Endpoint[Request, Data],
	handler func(*gin.Context, Request) apicontract.Response[Data]) gin.HandlerFunc {
	return func(c *gin.Context) {
		request, err := endpoint.Decode(c.Request.Body)
		if err != nil {
			c.JSON(http.StatusOK, apicontract.Failure[Data](-1, err.Error()))
			return
		}
		c.JSON(http.StatusOK, handler(c, request))
	}
}

// contractFailure 保留既有业务校验的错误码和消息，并限制其错误载荷形态。
func contractFailure[Data any](result *gulu.Result) apicontract.Response[Data] {
	switch data := result.Data.(type) {
	case nil:
		return apicontract.Failure[Data](result.Code, result.Msg)
	case string:
		return apicontract.FailureWithText[Data](result.Code, result.Msg, data)
	default:
		panic(fmt.Sprintf("unsupported API error data %T", result.Data))
	}
}

func notebookContract(box *model.Box) *apicontract.Notebook {
	if box == nil {
		return nil
	}
	return &apicontract.Notebook{
		ID: box.ID, Name: box.Name, Icon: box.Icon, Sort: box.Sort, SortMode: box.SortMode,
		Closed: box.Closed, SubFileCount: box.SubFileCount, NewFlashcardCount: box.NewFlashcardCount,
		DueFlashcardCount: box.DueFlashcardCount, FlashcardCount: box.FlashcardCount,
		Encrypted: box.Encrypted, Unlocked: box.Unlocked, State: string(box.State),
	}
}
