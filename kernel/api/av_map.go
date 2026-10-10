package api

import (
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var getAttributeViewMapUnplaced = contractHandler(apicontract.GetAttributeViewMapUnplaced, func(c *gin.Context, request apicontract.AVMapUnplacedRequest) apicontract.Response[apicontract.AVMapUnplacedData] {
	if err := holdAttributeViewRequest(c, request.BlockID, request.ID); err != nil {
		return apicontract.Failure[apicontract.AVMapUnplacedData](-1, model.Conf.Language(314))
	}
	view, _, _, err := model.RenderAttributeViewWithTargetReadOnly(request.BlockID, request.ID, request.ViewID, request.Query,
		1, -1, nil, "", false, false, "", "")
	if err != nil {
		return apicontract.Failure[apicontract.AVMapUnplacedData](-1, err.Error())
	}
	mapped, ok := view.(*av.Map)
	if !ok || mapped.Map == nil {
		return apicontract.Failure[apicontract.AVMapUnplacedData](-1, av.ErrViewNotFound.Error())
	}
	rows := attributeViewMapUnplacedRows(mapped, request.Search)
	total := len(rows)
	rows = paginateAttributeViewRows(rows, avPage(request.Page, 1), avPage(request.PageSize, 50))
	return apicontract.Success(apicontract.AVMapUnplacedData{
		Rows: avContractSlice(rows, toContractAVTableRow), Total: total,
	})
})

func attributeViewMapUnplacedRows(mapped *av.Map, search string) (rows []*av.TableRow) {
	keyID := mapped.Map.LocationKeyID
	if keyID == "" {
		// 与地图显示一致，只在空绑定时按视图顺序派生默认字段，不持久化设置。
		for _, column := range mapped.Columns {
			if column.Type == av.KeyTypeLocation {
				keyID = column.ID
				break
			}
		}
	}
	key := mapped.GetColumn(keyID)
	if key == nil || key.Type != av.KeyTypeLocation {
		return
	}
	search = strings.ToLower(strings.TrimSpace(search))
	// 此集合已完成当前视图的上下文筛选、筛选、搜索和排序，不受地图行分页影响。
	for _, row := range mapped.RowsBeforePagination {
		value := row.GetValue(keyID)
		if value == nil || value.Type != av.KeyTypeLocation {
			continue
		}
		location := value.Location
		if location != nil && (location.Normalize() != nil || location.Latitude != nil || location.Longitude != nil) {
			continue
		}
		if attributeViewRowMatchesTitle(row, search) {
			rows = append(rows, row)
		}
	}
	return
}
