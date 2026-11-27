// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"errors"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
	"github.com/siyuan-note/siyuan/kernel/model"
)

const maxAnkiMultipartOverhead int64 = 1 << 20

var previewAnkiFlashcardPackage = contractHandler(apicontract.PreviewAnkiFlashcardPackage, func(c *gin.Context, input apicontract.FlashcardV2AnkiUploadRequest) apicontract.Response[apicontract.FlashcardV2AnkiPackagePreview] {
	_, writePath, cleanup, err := saveAnkiImportUpload(c)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2AnkiPackagePreview](-1, err.Error())
	}
	defer cleanup()
	preview, err := model.PreviewFlashcardV2AnkiPackage(c.Request.Context(), writePath)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2AnkiPackagePreview](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2AnkiPackagePreview](preview)
}, limitAnkiFlashcardUpload[apicontract.FlashcardV2AnkiPackagePreview])

var importAnkiFlashcardPackage = contractHandler(apicontract.ImportAnkiFlashcardPackage, func(c *gin.Context, input apicontract.FlashcardV2AnkiUploadRequest) apicontract.Response[apicontract.FlashcardV2AnkiImportReport] {
	form, writePath, cleanup, err := saveAnkiImportUpload(c)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2AnkiImportReport](-1, err.Error())
	}
	defer cleanup()
	notebookID := firstFlashcardFormValue(form.Value["notebookID"])
	operationID := firstFlashcardFormValue(form.Value["operationID"])
	if notebookID == "" || operationID == "" {
		return apicontract.Failure[apicontract.FlashcardV2AnkiImportReport](-1, "Anki import notebook and operation ID are required")
	}
	report, err := model.ImportFlashcardV2AnkiPackage(c.Request.Context(), writePath, notebookID,
		operationID, time.Now().UnixMilli())
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2AnkiImportReport](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2AnkiImportReport](report)
}, limitAnkiFlashcardUpload[apicontract.FlashcardV2AnkiImportReport])

func saveAnkiImportUpload(c *gin.Context) (form *multipart.Form, writePath string, cleanup func(), err error) {
	requestLimit := flashcardv2.MaxAnkiPackageArchiveSize + maxAnkiMultipartOverhead
	if c.Request.ContentLength > requestLimit {
		return nil, "", nil, errors.New("Anki package upload exceeds its size limit")
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, requestLimit)
	form, writePath, cleanup, err = saveImportUpload(c)
	if err != nil {
		return
	}
	files := form.File["file"]
	if len(files) == 0 || files[0].Size > flashcardv2.MaxAnkiPackageArchiveSize {
		cleanup()
		return nil, "", nil, errors.New("Anki package upload exceeds its size limit")
	}
	return
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
	flashcardv2.StudyDayOptions
	SessionID string `json:"sessionID"`
}

type getFlashcardHistoryRequest struct {
	CardID string `json:"cardID"`
	Limit  int    `json:"limit"`
	Offset int    `json:"offset"`
}

type listFlashcardConflictsRequest struct {
	Limit int `json:"limit"`
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

var getFlashcardMigrationStatus = contractHandler(apicontract.GetFlashcardMigrationStatus, func(c *gin.Context, input apicontract.EmptyRequest) apicontract.Response[apicontract.FlashcardV2LegacyMigrationStatus] {
	status, err := model.GetFlashcardV2MigrationStatus(c.Request.Context())
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2LegacyMigrationStatus](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2LegacyMigrationStatus](status)
})

var previewFlashcardMigration = contractHandler(apicontract.PreviewFlashcardMigration, func(c *gin.Context, input apicontract.EmptyRequest) apicontract.Response[apicontract.FlashcardV2LegacyFlashcardMigrationPreview] {
	preview, err := model.PreviewLegacyFlashcardMigration(c.Request.Context())
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2LegacyFlashcardMigrationPreview](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2LegacyFlashcardMigrationPreview](preview)
})

var activateFlashcardMigration = contractHandler(apicontract.ActivateFlashcardMigration, func(c *gin.Context, input apicontract.FlashcardV2ActivateFlashcardMigrationRequest) apicontract.Response[apicontract.FlashcardV2LegacyActivationResult] {
	request, err := convertFlashcardPayload[activateFlashcardMigrationRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2LegacyActivationResult](-1, err.Error())
	}
	result, err := model.ActivateLegacyFlashcardMigration(c.Request.Context(), request.MigrationID,
		request.RecordDigest)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2LegacyActivationResult](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2LegacyActivationResult](result)
})

var mutateFlashcardEntities = contractHandler(apicontract.MutateFlashcardEntities, func(c *gin.Context, input apicontract.FlashcardV2MutateFlashcardEntitiesRequest) apicontract.Response[apicontract.FlashcardV2EntityMutationResult] {
	request, err := convertFlashcardPayload[mutateFlashcardEntitiesRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2EntityMutationResult](-1, err.Error())
	}
	result, err := model.MutateFlashcardV2Entities(c.Request.Context(), request.OperationID, request.Mutations)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2EntityMutationResult](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2EntityMutationResult](result)
})

var getFlashcardEntity = contractHandler(apicontract.GetFlashcardEntity, func(c *gin.Context, input apicontract.FlashcardV2GetFlashcardEntityRequest) apicontract.Response[apicontract.FlashcardV2EntityData] {
	request, err := convertFlashcardPayload[getFlashcardEntityRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2EntityData](-1, err.Error())
	}
	revision, found, err := model.GetFlashcardV2Entity(c.Request.Context(), request.EntityType, request.EntityID)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2EntityData](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2EntityData](struct {
		Found    bool                       `json:"found"`
		Revision flashcardv2.EntityRevision `json:"revision"`
	}{found, revision})
})

var listFlashcardEntities = contractHandler(apicontract.ListFlashcardEntities, func(c *gin.Context, input apicontract.FlashcardV2ListFlashcardEntitiesRequest) apicontract.Response[apicontract.FlashcardV2EntityPage] {
	request, err := convertFlashcardPayload[listFlashcardEntitiesRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2EntityPage](-1, err.Error())
	}
	page, err := model.ListFlashcardV2Entities(c.Request.Context(), request.EntityType, request.Options)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2EntityPage](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2EntityPage](page)
})

var reconcileFlashcardSource = contractHandler(apicontract.ReconcileFlashcardSource, func(c *gin.Context, input apicontract.FlashcardV2ReconcileFlashcardSourceRequest) apicontract.Response[apicontract.FlashcardV2ReconcileResult] {
	request, err := convertFlashcardPayload[reconcileFlashcardSourceRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2ReconcileResult](-1, err.Error())
	}
	result, err := model.ReconcileFlashcardV2Source(c.Request.Context(), request.OperationID, request.SourceID,
		request.UpdatedAt)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2ReconcileResult](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2ReconcileResult](result)
})

var createBasicFlashcardSource = contractHandler(apicontract.CreateBasicFlashcardSource, func(c *gin.Context, input apicontract.FlashcardV2BasicSourceRequest) apicontract.Response[apicontract.FlashcardV2BasicSourceResult] {
	request, err := convertFlashcardPayload[flashcardv2.BasicSourceRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2BasicSourceResult](-1, err.Error())
	}
	result, err := model.CreateFlashcardV2BasicSource(c.Request.Context(), request)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2BasicSourceResult](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2BasicSourceResult](result)
})

var createQuickFlashcardSources = contractHandler(apicontract.CreateQuickFlashcardSources, func(c *gin.Context,
	request apicontract.CreateQuickFlashcardSourcesRequest) apicontract.Response[apicontract.QuickFlashcardSourcesData] {
	result, err := model.CreateFlashcardV2QuickSources(c.Request.Context(), flashcardv2.QuickSourceRequest{
		OperationID: request.OperationID, BlockIDs: request.BlockIDs, CreatedAt: request.CreatedAt,
		Toggle: request.Toggle, DefaultPresetID: request.DefaultPresetID,
	})
	if err != nil {
		return apicontract.Failure[apicontract.QuickFlashcardSourcesData](-1, err.Error())
	}
	return apicontract.Success(apicontract.QuickFlashcardSourcesData{
		SourceIDs: result.SourceIDs, CardIDs: result.CardIDs, Action: result.Action,
	})
})

var manageFlashcardSourceLifecycle = contractHandler(apicontract.ManageFlashcardSourceLifecycle, func(c *gin.Context, input apicontract.FlashcardV2SourceLifecycleRequest) apicontract.Response[apicontract.FlashcardV2SourceLifecycleResult] {
	request, err := convertFlashcardPayload[flashcardv2.SourceLifecycleRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2SourceLifecycleResult](-1, err.Error())
	}
	result, err := model.ManageFlashcardV2SourceLifecycle(c.Request.Context(), request)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2SourceLifecycleResult](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2SourceLifecycleResult](result)
})

var listFlashcardConflicts = contractHandler(apicontract.ListFlashcardConflicts, func(c *gin.Context, input apicontract.FlashcardV2ListFlashcardConflictsRequest) apicontract.Response[[]apicontract.FlashcardV2EntityConflictGroup] {
	request, err := convertFlashcardPayload[listFlashcardConflictsRequest](input)
	if err != nil {
		return apicontract.Failure[[]apicontract.FlashcardV2EntityConflictGroup](-1, err.Error())
	}
	result, err := model.ListFlashcardV2Conflicts(c.Request.Context(), request.Limit)
	if err != nil {
		return apicontract.Failure[[]apicontract.FlashcardV2EntityConflictGroup](-1, err.Error())
	}
	return flashcardPayloadResponse[[]apicontract.FlashcardV2EntityConflictGroup](result)
})

var resolveFlashcardConflict = contractHandler(apicontract.ResolveFlashcardConflict, func(c *gin.Context, input apicontract.FlashcardV2ConflictResolutionRequest) apicontract.Response[apicontract.FlashcardV2EntityRevision] {
	request, err := convertFlashcardPayload[flashcardv2.ConflictResolutionRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2EntityRevision](-1, err.Error())
	}
	result, err := model.ResolveFlashcardV2Conflict(c.Request.Context(), request)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2EntityRevision](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2EntityRevision](result)
})

var createAdvancedFlashcardSource = contractHandler(apicontract.CreateAdvancedFlashcardSource, func(c *gin.Context, input apicontract.FlashcardV2AdvancedSourceRequest) apicontract.Response[apicontract.FlashcardV2AdvancedSourceResult] {
	request, err := convertFlashcardPayload[flashcardv2.AdvancedSourceRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2AdvancedSourceResult](-1, err.Error())
	}
	result, err := model.CreateFlashcardV2AdvancedSource(c.Request.Context(), request)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2AdvancedSourceResult](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2AdvancedSourceResult](result)
})

var updateAdvancedFlashcardSource = contractHandler(apicontract.UpdateAdvancedFlashcardSource, func(c *gin.Context, input apicontract.FlashcardV2AdvancedSourceUpdateRequest) apicontract.Response[apicontract.FlashcardV2AdvancedSourceResult] {
	request, err := convertFlashcardPayload[flashcardv2.AdvancedSourceUpdateRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2AdvancedSourceResult](-1, err.Error())
	}
	result, err := model.UpdateFlashcardV2AdvancedSource(c.Request.Context(), request)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2AdvancedSourceResult](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2AdvancedSourceResult](result)
})

var updateBasicFlashcardDirection = contractHandler(apicontract.UpdateBasicFlashcardDirection, func(c *gin.Context, input apicontract.FlashcardV2BasicDirectionRequest) apicontract.Response[apicontract.FlashcardV2BasicSourceResult] {
	request, err := convertFlashcardPayload[flashcardv2.BasicDirectionRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2BasicSourceResult](-1, err.Error())
	}
	result, err := model.UpdateFlashcardV2BasicDirection(c.Request.Context(), request)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2BasicSourceResult](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2BasicSourceResult](result)
})

var setFlashcardEditLater = contractHandler(apicontract.SetFlashcardEditLater, func(c *gin.Context,
	request apicontract.SetFlashcardEditLaterRequest) apicontract.Response[apicontract.FlashcardEditLaterData] {
	result, err := model.SetFlashcardV2CardEditLater(c.Request.Context(), flashcardv2.SetCardEditLaterRequest{
		OperationID: request.OperationID, CardID: request.CardID, Enabled: request.Enabled, Note: request.Note,
		ChangedAt: request.ChangedAt, ExpectedRevisionID: request.ExpectedRevisionID,
	})
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardEditLaterData](-1, err.Error())
	}
	return apicontract.Success(flashcardEditLaterData(result))
})

var previewFlashcardReviewSet = contractHandler(apicontract.PreviewFlashcardReviewSet, func(c *gin.Context, input apicontract.FlashcardV2PreviewFlashcardReviewSetRequest) apicontract.Response[apicontract.FlashcardV2ReviewSetCardPage] {
	request, err := convertFlashcardPayload[previewFlashcardReviewSetRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2ReviewSetCardPage](-1, err.Error())
	}
	page, err := model.PreviewFlashcardV2ReviewSet(c.Request.Context(), request.ReviewSetID, request.Query,
		request.Options)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2ReviewSetCardPage](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2ReviewSetCardPage](page)
})

var summarizeFlashcardReviewSets = contractHandler(apicontract.SummarizeFlashcardReviewSets, func(c *gin.Context, input apicontract.FlashcardV2SummarizeFlashcardReviewSetsRequest) apicontract.Response[apicontract.FlashcardV2SummariesData] {
	request, err := convertFlashcardPayload[summarizeFlashcardReviewSetsRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2SummariesData](-1, err.Error())
	}
	summaries, err := model.SummarizeFlashcardV2ReviewSets(c.Request.Context(), request.ReviewSetIDs, request.Now)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2SummariesData](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2SummariesData](struct {
		Summaries map[string]flashcardv2.ReviewSetSummary `json:"summaries"`
	}{summaries})
})

var startFlashcardSession = contractHandler(apicontract.StartFlashcardSession, func(c *gin.Context, input apicontract.FlashcardV2StudyQueueRequest) apicontract.Response[apicontract.FlashcardV2StudyQueueResult] {
	request, err := convertFlashcardPayload[flashcardv2.StudyQueueRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2StudyQueueResult](-1, err.Error())
	}
	result, err := model.StartFlashcardV2Session(c.Request.Context(), request)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2StudyQueueResult](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2StudyQueueResult](result)
})

var getFlashcardSessionQueue = contractHandler(apicontract.GetFlashcardSessionQueue, func(c *gin.Context, input apicontract.FlashcardV2GetFlashcardSessionQueueRequest) apicontract.Response[apicontract.FlashcardV2QueueData] {
	request, err := convertFlashcardPayload[getFlashcardSessionQueueRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2QueueData](-1, err.Error())
	}
	queue, err := model.GetFlashcardV2SessionQueue(c.Request.Context(), request.SessionID, request.StudyDayOptions)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2QueueData](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2QueueData](struct {
		Cards []flashcardv2.SessionQueueCard `json:"cards"`
	}{queue})
})

var updateFlashcardSessionCard = contractHandler(apicontract.UpdateFlashcardSessionCard, func(c *gin.Context, input apicontract.FlashcardV2SessionCardUpdateRequest) apicontract.Response[apicontract.FlashcardV2SessionCard] {
	request, err := convertFlashcardPayload[flashcardv2.SessionCardUpdateRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2SessionCard](-1, err.Error())
	}
	result, err := model.UpdateFlashcardV2SessionCard(c.Request.Context(), request)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2SessionCard](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2SessionCard](result)
})

var reviewFlashcard = contractHandler(apicontract.ReviewFlashcard, func(c *gin.Context, input apicontract.FlashcardV2ReviewRequest) apicontract.Response[apicontract.FlashcardV2ReviewResult] {
	request, err := convertFlashcardPayload[flashcardv2.ReviewRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2ReviewResult](-1, err.Error())
	}
	result, err := model.ReviewFlashcardV2Card(c.Request.Context(), request)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2ReviewResult](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2ReviewResult](result)
})

var undoFlashcardReview = contractHandler(apicontract.UndoFlashcardReview, func(c *gin.Context, input apicontract.FlashcardV2ReviewUndoRequest) apicontract.Response[apicontract.FlashcardV2ReviewUndoResult] {
	request, err := convertFlashcardPayload[flashcardv2.ReviewUndoRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2ReviewUndoResult](-1, err.Error())
	}
	result, err := model.UndoFlashcardV2Review(c.Request.Context(), request)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2ReviewUndoResult](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2ReviewUndoResult](result)
})

var manageFlashcards = contractHandler(apicontract.ManageFlashcards, func(c *gin.Context, input apicontract.FlashcardV2CardManagementRequest) apicontract.Response[apicontract.FlashcardV2CardManagementResult] {
	request, err := convertFlashcardPayload[flashcardv2.CardManagementRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2CardManagementResult](-1, err.Error())
	}
	result, err := model.ManageFlashcardV2Cards(c.Request.Context(), request)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2CardManagementResult](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2CardManagementResult](result)
})

var setFlashcardTagAssignments = contractHandler(apicontract.SetFlashcardTagAssignments, func(c *gin.Context, input apicontract.FlashcardV2SetTagAssignmentsRequest) apicontract.Response[apicontract.FlashcardV2SetTagAssignmentsResult] {
	request, err := convertFlashcardPayload[flashcardv2.SetTagAssignmentsRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2SetTagAssignmentsResult](-1, err.Error())
	}
	result, err := model.SetFlashcardV2TagAssignments(c.Request.Context(), request)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2SetTagAssignmentsResult](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2SetTagAssignmentsResult](result)
})

var setFlashcardReviewSetMemberships = contractHandler(apicontract.SetFlashcardReviewSetMemberships, func(c *gin.Context, input apicontract.FlashcardV2SetReviewSetMembershipsRequest) apicontract.Response[apicontract.FlashcardV2SetReviewSetMembershipsResult] {
	request, err := convertFlashcardPayload[flashcardv2.SetReviewSetMembershipsRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2SetReviewSetMembershipsResult](-1, err.Error())
	}
	result, err := model.SetFlashcardV2ReviewSetMemberships(c.Request.Context(), request)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2SetReviewSetMembershipsResult](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2SetReviewSetMembershipsResult](result)
})

var saveFlashcardTag = contractHandler(apicontract.SaveFlashcardTag, func(c *gin.Context, input apicontract.FlashcardV2SaveTagRequest) apicontract.Response[apicontract.FlashcardV2EntityRevision] {
	request, err := convertFlashcardPayload[flashcardv2.SaveTagRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2EntityRevision](-1, err.Error())
	}
	result, err := model.SaveFlashcardV2Tag(c.Request.Context(), request)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2EntityRevision](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2EntityRevision](result)
})

var getFlashcardStudyPolicy = contractHandler(apicontract.GetFlashcardStudyPolicy, func(c *gin.Context, input apicontract.FlashcardV2GetFlashcardStudyPolicyRequest) apicontract.Response[apicontract.FlashcardV2EntityData] {
	request, err := convertFlashcardPayload[getFlashcardStudyPolicyRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2EntityData](-1, err.Error())
	}
	revision, found, err := model.GetFlashcardV2StudyPolicy(c.Request.Context(), request.ScopeType,
		request.ScopeID)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2EntityData](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2EntityData](struct {
		Found    bool                       `json:"found"`
		Revision flashcardv2.EntityRevision `json:"revision"`
	}{found, revision})
})

var saveFlashcardStudyPolicy = contractHandler(apicontract.SaveFlashcardStudyPolicy, func(c *gin.Context, input apicontract.FlashcardV2SaveStudyPolicyRequest) apicontract.Response[apicontract.FlashcardV2EntityRevision] {
	request, err := convertFlashcardPayload[flashcardv2.SaveStudyPolicyRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2EntityRevision](-1, err.Error())
	}
	revision, err := model.SaveFlashcardV2StudyPolicy(c.Request.Context(), request)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2EntityRevision](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2EntityRevision](revision)
})

var finishFlashcardSession = contractHandler(apicontract.FinishFlashcardSession, func(c *gin.Context, input apicontract.FlashcardV2FinishSessionRequest) apicontract.Response[apicontract.FlashcardV2StudySession] {
	request, err := convertFlashcardPayload[flashcardv2.FinishSessionRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2StudySession](-1, err.Error())
	}
	result, err := model.FinishFlashcardV2Session(c.Request.Context(), request)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2StudySession](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2StudySession](result)
})

var getFlashcardHistory = contractHandler(apicontract.GetFlashcardHistory, func(c *gin.Context, input apicontract.FlashcardV2GetFlashcardHistoryRequest) apicontract.Response[apicontract.FlashcardV2HistoryData] {
	request, err := convertFlashcardPayload[getFlashcardHistoryRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2HistoryData](-1, err.Error())
	}
	history, err := model.GetFlashcardV2History(c.Request.Context(), request.CardID, request.Limit, request.Offset)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2HistoryData](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2HistoryData](struct {
		Events []flashcardv2.Event `json:"events"`
	}{history})
})

// getFlashcardSourceHistory 处理 POST /api/flashcard/getSourceHistory，要求已认证的管理员及已激活的 v2 存储。
// 响应使用 {code, msg, data}；历史仅包含卡源配置与引用，正文和复习事件由各自的历史入口管理。
// 未指定 revisionID 时，data.versions 返回按 updatedAt、revisionID 依次降序排列的卡源实体修订。
// 每项保留 revisionID、parentRevisionIDs、updatedAt、deleted、payload 等实体修订字段。
// 指定 revisionID 时，data 包含 revision、references、modes、documents，不使用分页参数。
// documents 以仍可访问的块 ID 为键，返回当前 rootID、notebookID 和可读 title 路径；缺失块不产生条目。
// 列表时间排序只用于浏览，版本引用沿父修订与操作批次还原；详情不提供历史正文或完整历史卡面。
// 跨卡源修订、墓碑、无法唯一还原或缺少必需引用的版本返回错误；独立修改引用的历史不按时间猜测版本。
var getFlashcardSourceHistory = contractHandler(apicontract.GetFlashcardSourceHistory, func(c *gin.Context, input apicontract.FlashcardV2SourceHistoryRequest) apicontract.Response[apicontract.FlashcardV2SourceHistoryData] {
	request := input
	if request.RevisionID != "" {
		version, err := model.GetFlashcardV2SourceHistoryVersion(c.Request.Context(), request.SourceID, request.RevisionID)
		if err != nil {
			return apicontract.Failure[apicontract.FlashcardV2SourceHistoryData](-1, err.Error())
		}
		converted, err := convertFlashcardPayload[apicontract.FlashcardV2SourceHistoryVersion](version)
		if err != nil {
			return apicontract.Failure[apicontract.FlashcardV2SourceHistoryData](-1, err.Error())
		}
		return apicontract.Success(apicontract.FlashcardV2SourceHistoryData{Version: &converted})
	}
	versions, err := model.GetFlashcardV2SourceHistory(c.Request.Context(), request.SourceID, request.Limit, request.Offset)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2SourceHistoryData](-1, err.Error())
	}
	converted, err := convertFlashcardPayload[[]apicontract.FlashcardV2EntityRevision](versions)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2SourceHistoryData](-1, err.Error())
	}
	return apicontract.Success(apicontract.FlashcardV2SourceHistoryData{Versions: converted})
})

// restoreFlashcardSourceHistory 处理 POST /api/flashcard/restoreSourceHistory。
// 要求已认证的管理员、已激活的 v2 存储及可写模式，请求字段约束见 RestoreSourceHistoryRequest。
// 响应使用 {code, msg, data}，成功时 data 为本次创建的卡源实体修订，配置、引用和生成卡片原子恢复。
// 稳定卡片保留身份与复习状态，当前卡源预设、优先级及生命周期不回退，也不会自动恢复已软删除卡源。
// 正文、图片、共享模板、标签和卡包成员不参与恢复；引用或挖空标记缺失时应先恢复文档，存在冲突时先解决冲突。
// 超时或结果不确定时使用相同 operationID 及全部原始请求字段重试，修改请求则使用新的 operationID。
var restoreFlashcardSourceHistory = contractHandler(apicontract.RestoreFlashcardSourceHistory, func(c *gin.Context, input apicontract.FlashcardV2RestoreSourceHistoryRequest) apicontract.Response[apicontract.FlashcardV2EntityRevision] {
	request, err := convertFlashcardPayload[flashcardv2.RestoreSourceHistoryRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2EntityRevision](-1, err.Error())
	}
	revision, err := model.RestoreFlashcardV2SourceHistory(c.Request.Context(), request)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2EntityRevision](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2EntityRevision](revision)
})

var getFlashcardStatistics = contractHandler(apicontract.GetFlashcardStatistics, func(c *gin.Context, input apicontract.FlashcardV2StatisticsRequest) apicontract.Response[apicontract.FlashcardV2StatisticsResult] {
	request, err := convertFlashcardPayload[flashcardv2.StatisticsRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2StatisticsResult](-1, err.Error())
	}
	result, err := model.GetFlashcardV2Statistics(c.Request.Context(), request)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2StatisticsResult](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2StatisticsResult](result)
})

var deleteFlashcardReviewSet = contractHandler(apicontract.DeleteFlashcardReviewSet, func(c *gin.Context, input apicontract.FlashcardV2DeleteFlashcardReviewSetRequest) apicontract.Response[apicontract.FlashcardV2EntityMutationResult] {
	request, err := convertFlashcardPayload[deleteFlashcardReviewSetRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2EntityMutationResult](-1, err.Error())
	}
	result, err := model.DeleteFlashcardV2ReviewSet(c.Request.Context(), request.OperationID, request.ReviewSetID,
		request.ExpectedRevisionID, request.DeletedAt)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2EntityMutationResult](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2EntityMutationResult](result)
})

var getFlashcardRenderModel = contractHandler(apicontract.GetFlashcardRenderModel, func(c *gin.Context, input apicontract.FlashcardV2GetFlashcardRenderModelRequest) apicontract.Response[apicontract.FlashcardV2CardRenderModel] {
	request, err := convertFlashcardPayload[getFlashcardRenderModelRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2CardRenderModel](-1, err.Error())
	}
	result, err := model.GetFlashcardV2RenderModel(c.Request.Context(), request.CardID)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2CardRenderModel](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2CardRenderModel](result)
})
