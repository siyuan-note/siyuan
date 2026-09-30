//go:build cgo

#include "runtime.h"
#include "onnxruntime_c_api.h"
#include <stdlib.h>
#include <string.h>
#if defined(_WIN32)
#include <windows.h>
#else
#include <dlfcn.h>
#endif
#if defined(__APPLE__)
#include <TargetConditionals.h>
#if TARGET_OS_IPHONE
extern const OrtApiBase *ORT_API_CALL OrtGetApiBase(void) __attribute__((weak_import));
#endif
#endif

static const OrtApi *sy_api;
static OrtEnv *sy_env;
struct SyOCRSession { OrtSession *session; char *input; char *output; };
struct SyOCROutput { OrtValue *value; float *data; int64_t shape[8]; size_t rank; size_t count; };

static char *sy_message(const char *message) {
    size_t size = strlen(message) + 1;
    char *result = malloc(size);
    if (result) memcpy(result, message, size);
    return result;
}

static char *sy_status(OrtStatus *status) {
    if (!status) return NULL;
    char *result = sy_message(sy_api->GetErrorMessage(status));
    sy_api->ReleaseStatus(status);
    return result;
}

char *sy_ocr_init(const char *library) {
    if (sy_env) return NULL;
    const OrtApiBase *(ORT_API_CALL *get_api)(void) = NULL;
#if defined(__APPLE__) && TARGET_OS_IPHONE
    get_api = OrtGetApiBase;
#elif defined(_WIN32)
    int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, library, -1, NULL, 0);
    wchar_t *path = calloc(size, sizeof(wchar_t));
    if (!path || !size) { free(path); return sy_message("Invalid ONNX Runtime library path"); }
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, library, -1, path, size);
    HMODULE handle = LoadLibraryExW(path, NULL, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
    free(path);
    if (!handle) return sy_message("Cannot load ONNX Runtime library");
    get_api = (void *)GetProcAddress(handle, "OrtGetApiBase");
#else
    void *handle = dlopen(library, RTLD_NOW | RTLD_LOCAL);
    if (!handle) return sy_message(dlerror());
    get_api = dlsym(handle, "OrtGetApiBase");
#endif
    if (!get_api) return sy_message("ONNX Runtime C API is unavailable");
    /* 所用接口均在 API 23 中，兼容 Intel macOS 的官方 1.23.2 运行库。 */
    sy_api = get_api()->GetApi(23);
    if (!sy_api) return sy_message("ONNX Runtime API version is incompatible");
    return sy_status(sy_api->CreateEnv(ORT_LOGGING_LEVEL_WARNING, "siyuan-ocr", &sy_env));
}

char *sy_ocr_session(const void *model, size_t size, SyOCRSession **session) {
    if (!sy_env) return sy_message("ONNX Runtime is not initialized");
    SyOCRSession *result = calloc(1, sizeof(SyOCRSession));
    if (!result) return sy_message("Cannot allocate OCR session");
    OrtSessionOptions *options = NULL;
    OrtAllocator *allocator = NULL;
    OrtTypeInfo *type = NULL;
    OrtStatus *status = sy_api->CreateSessionOptions(&options);
    if (!status) status = sy_api->SetIntraOpNumThreads(options, 2);
    if (!status) status = sy_api->SetSessionGraphOptimizationLevel(options, ORT_ENABLE_ALL);
    if (!status) status = sy_api->AddSessionConfigEntry(options, "session.intra_op.allow_spinning", "0");
    if (!status) status = sy_api->CreateSessionFromArray(sy_env, model, size, options, &result->session);
    if (options) sy_api->ReleaseSessionOptions(options);
    size_t inputs = 0, outputs = 0;
    if (!status) status = sy_api->SessionGetInputCount(result->session, &inputs);
    if (!status) status = sy_api->SessionGetOutputCount(result->session, &outputs);
    if (!status && (inputs != 1 || outputs != 1)) {
        sy_ocr_close(result);
        return sy_message("OCR models must have one input and one output");
    }
    const OrtTensorTypeAndShapeInfo *info = NULL;
    ONNXTensorElementDataType element;
    size_t rank = 0;
    int64_t dims[4];
    if (!status) status = sy_api->SessionGetInputTypeInfo(result->session, 0, &type);
    if (!status) status = sy_api->CastTypeInfoToTensorInfo(type, &info);
    if (!status && !info) {
        sy_api->ReleaseTypeInfo(type);
        sy_ocr_close(result);
        return sy_message("OCR model input must be a tensor");
    }
    if (!status) status = sy_api->GetTensorElementType(info, &element);
    if (!status) status = sy_api->GetDimensionsCount(info, &rank);
    if (!status && rank == 4) status = sy_api->GetDimensions(info, dims, 4);
    if (type) sy_api->ReleaseTypeInfo(type);
    if (!status && (element != ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT || rank != 4 || dims[1] != 3)) {
        sy_ocr_close(result);
        return sy_message("OCR model input must be a float32 NCHW image with three channels");
    }
    if (!status) status = sy_api->GetAllocatorWithDefaultOptions(&allocator);
    if (!status) status = sy_api->SessionGetInputName(result->session, 0, allocator, &result->input);
    if (!status) status = sy_api->SessionGetOutputName(result->session, 0, allocator, &result->output);
    if (status) { char *error = sy_status(status); sy_ocr_close(result); return error; }
    *session = result;
    return NULL;
}

void sy_ocr_close(SyOCRSession *session) {
    if (!session) return;
    OrtAllocator *allocator = NULL;
    OrtStatus *status = sy_api->GetAllocatorWithDefaultOptions(&allocator);
    if (status) sy_api->ReleaseStatus(status);
    if (allocator) {
        if (session->input) allocator->Free(allocator, session->input);
        if (session->output) allocator->Free(allocator, session->output);
    }
    if (session->session) sy_api->ReleaseSession(session->session);
    free(session);
}

char *sy_ocr_options(void **options) { return sy_status(sy_api->CreateRunOptions((OrtRunOptions **)options)); }
void sy_ocr_cancel(void *options) {
    OrtStatus *status = sy_api->RunOptionsSetTerminate(options);
    if (status) sy_api->ReleaseStatus(status);
}
void sy_ocr_free_options(void *options) { sy_api->ReleaseRunOptions(options); }

char *sy_ocr_run(SyOCRSession *session, void *options, float *input, size_t count, const int64_t *shape, SyOCROutput **output) {
    OrtMemoryInfo *memory = NULL;
    OrtValue *value = NULL;
    SyOCROutput *result = calloc(1, sizeof(SyOCROutput));
    if (!result) return sy_message("Cannot allocate OCR output");
    OrtStatus *status = sy_api->CreateCpuMemoryInfo(OrtArenaAllocator, OrtMemTypeDefault, &memory);
    if (!status) status = sy_api->CreateTensorWithDataAsOrtValue(memory, input, count * sizeof(float), shape, 4, ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT, &value);
    if (!status) status = sy_api->Run(session->session, options, (const char *const *)&session->input, (const OrtValue *const *)&value, 1, (const char *const *)&session->output, 1, &result->value);
    if (value) sy_api->ReleaseValue(value);
    if (memory) sy_api->ReleaseMemoryInfo(memory);
    OrtTensorTypeAndShapeInfo *info = NULL;
    ONNXTensorElementDataType element;
    if (!status) status = sy_api->GetTensorTypeAndShape(result->value, &info);
    if (!status) status = sy_api->GetTensorElementType(info, &element);
    if (!status) status = sy_api->GetDimensionsCount(info, &result->rank);
    if (!status) status = sy_api->GetTensorShapeElementCount(info, &result->count);
    if (!status && (element != ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT || result->rank > 8 || result->count > 100000000)) {
        sy_api->ReleaseTensorTypeAndShapeInfo(info);
        sy_ocr_free_output(result);
        return sy_message("Unsupported OCR model output tensor");
    }
    if (!status) status = sy_api->GetDimensions(info, result->shape, result->rank);
    if (!status) status = sy_api->GetTensorMutableData(result->value, (void **)&result->data);
    if (info) sy_api->ReleaseTensorTypeAndShapeInfo(info);
    if (status) { char *error = sy_status(status); sy_ocr_free_output(result); return error; }
    *output = result;
    return NULL;
}

int sy_ocr_output(SyOCROutput *output, const float **data, const int64_t **shape, size_t *rank, size_t *count) {
    *data = output->data; *shape = output->shape; *rank = output->rank; *count = output->count;
    return 0;
}
void sy_ocr_free_output(SyOCROutput *output) {
    if (!output) return;
    if (output->value) sy_api->ReleaseValue(output->value);
    free(output);
}
