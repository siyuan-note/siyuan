// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func previewAnkiFlashcardPackage(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	_, writePath, cleanup, err := saveImportUpload(c)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	defer cleanup()
	preview, err := model.PreviewFlashcardV2AnkiPackage(c.Request.Context(), writePath)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = preview
}

func importAnkiFlashcardPackage(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	form, writePath, cleanup, err := saveImportUpload(c)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	defer cleanup()
	notebookID := firstFlashcardFormValue(form.Value["notebookID"])
	operationID := firstFlashcardFormValue(form.Value["operationID"])
	if notebookID == "" || operationID == "" {
		setFlashcardAPIError(ret, errors.New("Anki import notebook and operation ID are required"))
		return
	}
	report, err := model.ImportFlashcardV2AnkiPackage(c.Request.Context(), writePath, notebookID,
		operationID, time.Now().UnixMilli())
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = report
}

func firstFlashcardFormValue(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return strings.TrimSpace(values[0])
}

type activateFlashcardMigrationRequest struct {
	MigrationID  string `json:"migrationID"`
	RecordDigest string `json:"recordDigest"`
}

type mutateFlashcardEntitiesRequest struct {
	OperationID string                       `json:"operationID"`
	Mutations   []flashcardv2.EntityMutation `json:"mutations"`
}

type getFlashcardEntityRequest struct {
	EntityType flashcardv2.EntityType `json:"entityType"`
	EntityID   string                 `json:"entityID"`
}

type listFlashcardEntitiesRequest struct {
	EntityType flashcardv2.EntityType        `json:"entityType"`
	Options    flashcardv2.EntityListOptions `json:"options"`
}

type reconcileFlashcardSourceRequest struct {
	OperationID string `json:"operationID"`
	SourceID    string `json:"sourceID"`
	UpdatedAt   int64  `json:"updatedAt"`
}

type queryFlashcardsRequest struct {
	Query   *flashcardv2.QueryAST         `json:"query,omitempty"`
	Options flashcardv2.CardSearchOptions `json:"options"`
}

type previewFlashcardReviewSetRequest struct {
	ReviewSetID string                        `json:"reviewSetID"`
	Query       *flashcardv2.QueryAST         `json:"query,omitempty"`
	Options     flashcardv2.CardSearchOptions `json:"options"`
}

type summarizeFlashcardReviewSetsRequest struct {
	ReviewSetIDs []string `json:"reviewSetIDs"`
	Now          int64    `json:"now"`
}

type getFlashcardSessionQueueRequest struct {
	SessionID string `json:"sessionID"`
}

type getFlashcardHistoryRequest struct {
	CardID string `json:"cardID"`
	Limit  int    `json:"limit"`
	Offset int    `json:"offset"`
}

type deleteFlashcardReviewSetRequest struct {
	OperationID        string `json:"operationID"`
	ReviewSetID        string `json:"reviewSetID"`
	ExpectedRevisionID string `json:"expectedRevisionID,omitempty"`
	DeletedAt          int64  `json:"deletedAt"`
}

type getFlashcardRenderModelRequest struct {
	CardID string `json:"cardID"`
}

type getFlashcardStudyPolicyRequest struct {
	ScopeType string `json:"scopeType"`
	ScopeID   string `json:"scopeID"`
}

func getFlashcardMigrationStatus(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	status, err := model.GetFlashcardV2MigrationStatus(c.Request.Context())
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = status
}

func previewFlashcardMigration(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	preview, err := model.PreviewLegacyFlashcardMigration(c.Request.Context())
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = preview
}

func activateFlashcardMigration(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &activateFlashcardMigrationRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	result, err := model.ActivateLegacyFlashcardMigration(c.Request.Context(), request.MigrationID,
		request.RecordDigest)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = result
}

func mutateFlashcardEntities(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &mutateFlashcardEntitiesRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	result, err := model.MutateFlashcardV2Entities(c.Request.Context(), request.OperationID, request.Mutations)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = result
}

func getFlashcardEntity(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &getFlashcardEntityRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	revision, found, err := model.GetFlashcardV2Entity(c.Request.Context(), request.EntityType, request.EntityID)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = map[string]any{"found": found, "revision": revision}
}

func listFlashcardEntities(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &listFlashcardEntitiesRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	page, err := model.ListFlashcardV2Entities(c.Request.Context(), request.EntityType, request.Options)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = page
}

func reconcileFlashcardSource(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &reconcileFlashcardSourceRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	result, err := model.ReconcileFlashcardV2Source(c.Request.Context(), request.OperationID, request.SourceID,
		request.UpdatedAt)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = result
}

func createBasicFlashcardSource(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &flashcardv2.BasicSourceRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	result, err := model.CreateFlashcardV2BasicSource(c.Request.Context(), *request)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = result
}

func createAdvancedFlashcardSource(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &flashcardv2.AdvancedSourceRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	result, err := model.CreateFlashcardV2AdvancedSource(c.Request.Context(), *request)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = result
}

func updateBasicFlashcardDirection(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &flashcardv2.BasicDirectionRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	result, err := model.UpdateFlashcardV2BasicDirection(c.Request.Context(), *request)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = result
}

func queryFlashcards(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &queryFlashcardsRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	results, err := model.QueryFlashcardV2Cards(c.Request.Context(), request.Query, request.Options)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = map[string]any{"cards": results}
}

func previewFlashcardReviewSet(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &previewFlashcardReviewSetRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	page, err := model.PreviewFlashcardV2ReviewSet(c.Request.Context(), request.ReviewSetID, request.Query,
		request.Options)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = page
}

func summarizeFlashcardReviewSets(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &summarizeFlashcardReviewSetsRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	summaries, err := model.SummarizeFlashcardV2ReviewSets(c.Request.Context(), request.ReviewSetIDs, request.Now)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = map[string]any{"summaries": summaries}
}

func startFlashcardSession(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &flashcardv2.StudyQueueRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	result, err := model.StartFlashcardV2Session(c.Request.Context(), *request)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = result
}

func getFlashcardSessionQueue(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &getFlashcardSessionQueueRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	queue, err := model.GetFlashcardV2SessionQueue(c.Request.Context(), request.SessionID)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = map[string]any{"cards": queue}
}

func updateFlashcardSessionCard(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &flashcardv2.SessionCardUpdateRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	result, err := model.UpdateFlashcardV2SessionCard(c.Request.Context(), *request)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = result
}

func reviewFlashcard(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &flashcardv2.ReviewRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	result, err := model.ReviewFlashcardV2Card(c.Request.Context(), *request)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = result
}

func undoFlashcardReview(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &flashcardv2.ReviewUndoRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	result, err := model.UndoFlashcardV2Review(c.Request.Context(), *request)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = result
}

func manageFlashcards(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &flashcardv2.CardManagementRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	result, err := model.ManageFlashcardV2Cards(c.Request.Context(), *request)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = result
}

func setFlashcardTagAssignments(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &flashcardv2.SetTagAssignmentsRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	result, err := model.SetFlashcardV2TagAssignments(c.Request.Context(), *request)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = result
}

func setFlashcardReviewSetMemberships(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &flashcardv2.SetReviewSetMembershipsRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	result, err := model.SetFlashcardV2ReviewSetMemberships(c.Request.Context(), *request)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = result
}

func saveFlashcardTag(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &flashcardv2.SaveTagRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	result, err := model.SaveFlashcardV2Tag(c.Request.Context(), *request)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = result
}

func getFlashcardStudyPolicy(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &getFlashcardStudyPolicyRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	revision, found, err := model.GetFlashcardV2StudyPolicy(c.Request.Context(), request.ScopeType,
		request.ScopeID)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = map[string]any{"revision": revision, "found": found}
}

func saveFlashcardStudyPolicy(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &flashcardv2.SaveStudyPolicyRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	revision, err := model.SaveFlashcardV2StudyPolicy(c.Request.Context(), *request)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = revision
}

func finishFlashcardSession(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &flashcardv2.FinishSessionRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	result, err := model.FinishFlashcardV2Session(c.Request.Context(), *request)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = result
}

func getFlashcardHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &getFlashcardHistoryRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	history, err := model.GetFlashcardV2History(c.Request.Context(), request.CardID, request.Limit, request.Offset)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = map[string]any{"events": history}
}

func getFlashcardStatistics(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &flashcardv2.StatisticsRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	result, err := model.GetFlashcardV2Statistics(c.Request.Context(), *request)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = result
}

func deleteFlashcardReviewSet(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &deleteFlashcardReviewSetRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	result, err := model.DeleteFlashcardV2ReviewSet(c.Request.Context(), request.OperationID, request.ReviewSetID,
		request.ExpectedRevisionID, request.DeletedAt)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = result
}

func getFlashcardRenderModel(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &getFlashcardRenderModelRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	result, err := model.GetFlashcardV2RenderModel(c.Request.Context(), request.CardID)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = result
}

func bindFlashcardRequest(c *gin.Context, ret *gulu.Result, target any) bool {
	if err := c.ShouldBindJSON(target); err != nil {
		ret.Code = -1
		ret.Msg = "invalid flashcard request: " + err.Error()
		return false
	}
	return true
}

func setFlashcardAPIError(ret *gulu.Result, err error) {
	ret.Code = -1
	ret.Msg = err.Error()
}
