// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// See docs\c_cxx\README.md on generating the Doxygen documentation from this file

/** \mainpage ONNX Runtime
 *
 * ONNX Runtime is a high-performance inference and training graph execution engine for deep learning models.
 *
 * ONNX Runtime's C, C++ APIs offer an easy to use interface to onboard and execute onnx models.
 * - \subpage c_cpp_api "Core C, C++ APIs"
 * - \subpage training_c_cpp_api "Training C, C++ APIs for on-device training"
 *
 * \page c_cpp_api Core C, C++ APIs
 * <h1>C</h1>
 *
 * ::OrtApi - Click here to go to the structure with all C API functions.
 *
 * <h1>C++</h1>
 *
 * ::Ort - Click here to go to the namespace holding all of the C++ wrapper classes
 *
 * It is a set of header only wrapper classes around the C API. The goal is to turn the C style return value error codes into C++ exceptions, and to
 * automate memory management through standard C++ RAII principles.
 *
 * \addtogroup Global
 * ONNX Runtime C API
 * @{
 */

#pragma once
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/** \brief The API version defined in this header
 *
 * This value is used by some API functions to behave as this version of the header expects.
 */
#define ORT_API_VERSION 24

#ifdef __cplusplus
extern "C" {
#endif

//! @}
// SAL2 Definitions
#ifndef _MSC_VER
#define _In_
#define _In_z_
#define _In_opt_
#define _In_opt_z_
#define _Out_
#define _Out_opt_
#define _Outptr_
#define _Outptr_opt_
#define _Inout_
#define _Inout_opt_
#define _Frees_ptr_opt_
#define _Ret_maybenull_
#define _Ret_notnull_
#define _Check_return_
#define _Outptr_result_maybenull_
#define _Outptr_result_maybenull_z_
#define _In_reads_(X)
#define _In_reads_opt_
#define _Inout_updates_(X)
#define _Out_writes_(X)
#define _Out_writes_opt_(X)
#define _Inout_updates_all_(X)
#define _Out_writes_bytes_all_(X)
#define _Out_writes_all_(X)
#define _Success_(X)
#define _Outptr_result_buffer_maybenull_(X)
#define ORT_ALL_ARGS_NONNULL __attribute__((nonnull))
#else
#include <specstrings.h>
#define ORT_ALL_ARGS_NONNULL
#endif

#ifdef _WIN32
// Define ORT_DLL_IMPORT if your program is dynamically linked to Ort.
// dllexport is not used, we use a .def file.
#ifdef ORT_DLL_IMPORT
#define ORT_EXPORT __declspec(dllimport)
#else
#define ORT_EXPORT
#endif
#define ORT_API_CALL __stdcall
#define ORT_MUST_USE_RESULT
#define ORTCHAR_T wchar_t
#else
// To make symbols visible on macOS/iOS
#ifdef __APPLE__
#define ORT_EXPORT __attribute__((visibility("default")))
#else
#define ORT_EXPORT
#endif
#define ORT_API_CALL
#define ORT_MUST_USE_RESULT __attribute__((warn_unused_result))
#define ORTCHAR_T char
#endif

/// ORTCHAR_T, ORT_TSTR are reserved specifically for path handling.
/// All other strings are UTF-8 encoded, use char and std::string
#ifndef ORT_TSTR
#ifdef _WIN32
#define ORT_TSTR(X) L##X
// When X is a macro, L##X is not defined. In this case, we need to use ORT_TSTR_ON_MACRO.
#define ORT_TSTR_ON_MACRO(X) L"" X
#else
#define ORT_TSTR(X) X
#define ORT_TSTR_ON_MACRO(X) X
#endif
#endif

// On Windows, ORT_FILE is a wchar_t version of the __FILE__ macro.
// Otherwise, ORT_FILE is equivalent to __FILE__.
#ifndef ORT_FILE
#define ORT_FILE_INTERNAL(x) ORT_TSTR(x)
#define ORT_FILE ORT_FILE_INTERNAL(__FILE__)
#endif

// Any pointer marked with _In_ or _Out_, cannot be NULL.

// Windows users should use unicode paths when possible to bypass the MAX_PATH limitation
// Every pointer marked with _In_ or _Out_, cannot be NULL. Caller should ensure that.
// for ReleaseXXX(...) functions, they can accept NULL pointer.

#ifdef __cplusplus
// For any compiler with C++11 support, MSVC 2015 and greater, or Clang version supporting noexcept.
// Such complex condition is needed because compilers set __cplusplus value differently.
#ifndef __has_feature
#define __has_feature(x) 0
#endif
#if ((__cplusplus >= 201103L) || (_MSC_VER >= 1900) || (defined(__has_feature) && __has_feature(cxx_noexcept)))
#define NO_EXCEPTION noexcept
#else
#define NO_EXCEPTION throw()
#endif
#else
#define NO_EXCEPTION
#endif

// __VA_ARGS__ on Windows and Linux are different
#define ORT_API(RETURN_TYPE, NAME, ...) RETURN_TYPE ORT_API_CALL NAME(__VA_ARGS__) NO_EXCEPTION

#define ORT_API_T(RETURN_TYPE, NAME, ...) \
  RETURN_TYPE(ORT_API_CALL* NAME)(__VA_ARGS__) NO_EXCEPTION

#define ORT_API_STATUS(NAME, ...)                                                                   \
  _Success_(return == 0) _Check_return_ _Ret_maybenull_ OrtStatusPtr ORT_API_CALL NAME(__VA_ARGS__) \
  NO_EXCEPTION ORT_MUST_USE_RESULT

// XXX: Unfortunately, SAL annotations are known to not work with function pointers
#define ORT_API2_STATUS(NAME, ...) \
  _Check_return_ _Ret_maybenull_ OrtStatusPtr(ORT_API_CALL* NAME)(__VA_ARGS__) NO_EXCEPTION ORT_MUST_USE_RESULT

// Used in *.cc files. Almost as same as ORT_API_STATUS, except without ORT_MUST_USE_RESULT and ORT_EXPORT
#define ORT_API_STATUS_IMPL(NAME, ...) \
  _Success_(return == 0) _Check_return_ _Ret_maybenull_ OrtStatusPtr ORT_API_CALL NAME(__VA_ARGS__) NO_EXCEPTION

#define ORT_CLASS_RELEASE(X) void(ORT_API_CALL * Release##X)(_Frees_ptr_opt_ Ort##X * input)

#ifdef __DOXYGEN__
#undef ORT_API_STATUS
#define ORT_API_STATUS(NAME, ...) OrtStatus* NAME(__VA_ARGS__)
#undef ORT_API2_STATUS
#define ORT_API2_STATUS(NAME, ...) OrtStatus* NAME(__VA_ARGS__)
#undef ORT_CLASS_RELEASE
#define ORT_CLASS_RELEASE(X) void Release##X(Ort##X* input)
#undef NO_EXCEPTION
#define NO_EXCEPTION
#endif
/** \addtogroup Global
 * ONNX Runtime C API
 * @{
 */

/** Copied from TensorProto::DataType
 * Currently, Ort doesn't support complex64, complex128
 */
typedef enum ONNXTensorElementDataType {
  ONNX_TENSOR_ELEMENT_DATA_TYPE_UNDEFINED,
  ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT,   // maps to c type float
  ONNX_TENSOR_ELEMENT_DATA_TYPE_UINT8,   // maps to c type uint8_t
  ONNX_TENSOR_ELEMENT_DATA_TYPE_INT8,    // maps to c type int8_t
  ONNX_TENSOR_ELEMENT_DATA_TYPE_UINT16,  // maps to c type uint16_t
  ONNX_TENSOR_ELEMENT_DATA_TYPE_INT16,   // maps to c type int16_t
  ONNX_TENSOR_ELEMENT_DATA_TYPE_INT32,   // maps to c type int32_t
  ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64,   // maps to c type int64_t
  ONNX_TENSOR_ELEMENT_DATA_TYPE_STRING,  // maps to c++ type std::string
  ONNX_TENSOR_ELEMENT_DATA_TYPE_BOOL,
  ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT16,
  ONNX_TENSOR_ELEMENT_DATA_TYPE_DOUBLE,      // maps to c type double
  ONNX_TENSOR_ELEMENT_DATA_TYPE_UINT32,      // maps to c type uint32_t
  ONNX_TENSOR_ELEMENT_DATA_TYPE_UINT64,      // maps to c type uint64_t
  ONNX_TENSOR_ELEMENT_DATA_TYPE_COMPLEX64,   // complex with float32 real and imaginary components
  ONNX_TENSOR_ELEMENT_DATA_TYPE_COMPLEX128,  // complex with float64 real and imaginary components
  ONNX_TENSOR_ELEMENT_DATA_TYPE_BFLOAT16,    // Non-IEEE floating-point format based on IEEE754 single-precision
  // float 8 types were introduced in onnx 1.14, see https://onnx.ai/onnx/technical/float8.html
  ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT8E4M3FN,    // Non-IEEE floating-point format based on IEEE754 single-precision
  ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT8E4M3FNUZ,  // Non-IEEE floating-point format based on IEEE754 single-precision
  ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT8E5M2,      // Non-IEEE floating-point format based on IEEE754 single-precision
  ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT8E5M2FNUZ,  // Non-IEEE floating-point format based on IEEE754 single-precision
  // Int4 types were introduced in ONNX 1.16. See https://onnx.ai/onnx/technical/int4.html
  ONNX_TENSOR_ELEMENT_DATA_TYPE_UINT4,  // maps to a pair of packed uint4 values (size == 1 byte)
  ONNX_TENSOR_ELEMENT_DATA_TYPE_INT4,   // maps to a pair of packed int4 values (size == 1 byte)
  // Float4 types were introduced in ONNX 1.18. See https://onnx.ai/onnx/technical/float4.html
  ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT4E2M1,  // maps to a pair of packed float4 values (size == 1 byte)
  // Int2 types were introduced in ONNX 1.20. See https://onnx.ai/onnx/technical/int2.html
  ONNX_TENSOR_ELEMENT_DATA_TYPE_UINT2,  // maps to 4 packed uint2 values (size == 1 byte)
  ONNX_TENSOR_ELEMENT_DATA_TYPE_INT2,   // maps to 4 packed int2 values (size == 1 byte)
} ONNXTensorElementDataType;

// Synced with onnx TypeProto oneof
typedef enum ONNXType {
  ONNX_TYPE_UNKNOWN,
  ONNX_TYPE_TENSOR,
  ONNX_TYPE_SEQUENCE,
  ONNX_TYPE_MAP,
  ONNX_TYPE_OPAQUE,
  ONNX_TYPE_SPARSETENSOR,
  ONNX_TYPE_OPTIONAL
} ONNXType;

// These types are synced with internal
// SparseFormatFlags
typedef enum OrtSparseFormat {
  ORT_SPARSE_UNDEFINED = 0,
  ORT_SPARSE_COO = 0x1,
  ORT_SPARSE_CSRC = 0x2,
  ORT_SPARSE_BLOCK_SPARSE = 0x4
} OrtSparseFormat;

// Enum allows to query sparse tensor indices
enum OrtSparseIndicesFormat {
  ORT_SPARSE_COO_INDICES,
  ORT_SPARSE_CSR_INNER_INDICES,
  ORT_SPARSE_CSR_OUTER_INDICES,
  ORT_SPARSE_BLOCK_SPARSE_INDICES
};

/** \brief Logging severity levels
 *
 * In typical API usage, specifying a logging severity level specifies the minimum severity of log messages to show.
 */
typedef enum OrtLoggingLevel {
  ORT_LOGGING_LEVEL_VERBOSE,  ///< Verbose informational messages (least severe).
  ORT_LOGGING_LEVEL_INFO,     ///< Informational messages.
  ORT_LOGGING_LEVEL_WARNING,  ///< Warning messages.
  ORT_LOGGING_LEVEL_ERROR,    ///< Error messages.
  ORT_LOGGING_LEVEL_FATAL,    ///< Fatal error messages (most severe).
} OrtLoggingLevel;

typedef enum OrtErrorCode {
  ORT_OK,
  ORT_FAIL,
  ORT_INVALID_ARGUMENT,
  ORT_NO_SUCHFILE,
  ORT_NO_MODEL,
  ORT_ENGINE_ERROR,
  ORT_RUNTIME_EXCEPTION,
  ORT_INVALID_PROTOBUF,
  ORT_MODEL_LOADED,
  ORT_NOT_IMPLEMENTED,
  ORT_INVALID_GRAPH,
  ORT_EP_FAIL,
  ORT_MODEL_LOAD_CANCELED,
  ORT_MODEL_REQUIRES_COMPILATION,
  ORT_NOT_FOUND,
} OrtErrorCode;

typedef enum OrtOpAttrType {
  ORT_OP_ATTR_UNDEFINED = 0,
  ORT_OP_ATTR_INT,
  ORT_OP_ATTR_INTS,
  ORT_OP_ATTR_FLOAT,
  ORT_OP_ATTR_FLOATS,
  ORT_OP_ATTR_STRING,
  ORT_OP_ATTR_STRINGS,
  ORT_OP_ATTR_GRAPH,
  ORT_OP_ATTR_TENSOR,
} OrtOpAttrType;

//! @}
#define ORT_RUNTIME_CLASS(X) \
  struct Ort##X;             \
  typedef struct Ort##X Ort##X

/** \addtogroup Global
 * ONNX Runtime C API
 * @{
 */
// The actual types defined have an Ort prefix
ORT_RUNTIME_CLASS(Env);
ORT_RUNTIME_CLASS(Status);  // nullptr for Status* indicates success
ORT_RUNTIME_CLASS(MemoryInfo);
ORT_RUNTIME_CLASS(IoBinding);
ORT_RUNTIME_CLASS(Session);  // Don't call ReleaseSession from Dllmain (because session owns a thread pool)
ORT_RUNTIME_CLASS(Value);
ORT_RUNTIME_CLASS(RunOptions);
ORT_RUNTIME_CLASS(TypeInfo);
ORT_RUNTIME_CLASS(TensorTypeAndShapeInfo);
ORT_RUNTIME_CLASS(MapTypeInfo);
ORT_RUNTIME_CLASS(SequenceTypeInfo);
ORT_RUNTIME_CLASS(OptionalTypeInfo);
ORT_RUNTIME_CLASS(SessionOptions);
ORT_RUNTIME_CLASS(CustomOpDomain);
ORT_RUNTIME_CLASS(ModelMetadata);
ORT_RUNTIME_CLASS(ThreadPoolParams);
ORT_RUNTIME_CLASS(ThreadingOptions);
ORT_RUNTIME_CLASS(ArenaCfg);
ORT_RUNTIME_CLASS(PrepackedWeightsContainer);
ORT_RUNTIME_CLASS(TensorRTProviderOptionsV2);
ORT_RUNTIME_CLASS(NvTensorRtRtxProviderOptions);
ORT_RUNTIME_CLASS(CUDAProviderOptionsV2);
ORT_RUNTIME_CLASS(CANNProviderOptions);
ORT_RUNTIME_CLASS(DnnlProviderOptions);
ORT_RUNTIME_CLASS(Op);
ORT_RUNTIME_CLASS(OpAttr);
ORT_RUNTIME_CLASS(Logger);
ORT_RUNTIME_CLASS(ShapeInferContext);
ORT_RUNTIME_CLASS(LoraAdapter);
ORT_RUNTIME_CLASS(ValueInfo);
ORT_RUNTIME_CLASS(Node);
ORT_RUNTIME_CLASS(Graph);
ORT_RUNTIME_CLASS(Model);
ORT_RUNTIME_CLASS(ModelCompilationOptions);
ORT_RUNTIME_CLASS(HardwareDevice);
ORT_RUNTIME_CLASS(EpDevice);
ORT_RUNTIME_CLASS(KeyValuePairs);
ORT_RUNTIME_CLASS(SyncStream);  // Opaque class to create an onnxruntime::Stream.
ORT_RUNTIME_CLASS(ExternalInitializerInfo);
ORT_RUNTIME_CLASS(ExternalResourceImporter);  // Capability object for external resource import
ORT_RUNTIME_CLASS(ExternalMemoryHandle);      // EP-imported view of shared external allocation
ORT_RUNTIME_CLASS(ExternalSemaphoreHandle);   // EP-imported view of shared external semaphore
ORT_RUNTIME_CLASS(DeviceEpIncompatibilityDetails);
ORT_RUNTIME_CLASS(EpAssignedSubgraph);
ORT_RUNTIME_CLASS(EpAssignedNode);

#ifdef _MSC_VER
typedef _Return_type_success_(return == 0) OrtStatus* OrtStatusPtr;
#else
typedef OrtStatus* OrtStatusPtr;
#endif

/** \brief Memory allocation interface
 *
 * Structure of function pointers that defines a memory allocator. This can be created and filled in by the user for custom allocators.
 *
 * When an allocator is passed to any function, be sure that the allocator object is not destroyed until the last allocated object using it is freed.
 */
typedef struct OrtAllocator {
  uint32_t version;  ///< Must be initialized to ORT_API_VERSION

  /// Returns a pointer to an allocated block of `size` bytes
  void*(ORT_API_CALL* Alloc)(struct OrtAllocator* this_, size_t size);

  /// Free a block of memory previously allocated with OrtAllocator::Alloc
  void(ORT_API_CALL* Free)(struct OrtAllocator* this_, void* p);

  /// Return a pointer to an ::OrtMemoryInfo that describes this allocator
  const struct OrtMemoryInfo*(ORT_API_CALL* Info)(const struct OrtAllocator* this_);
  /**
   * @brief Optional allocation function to use for memory allocations made during session initialization.
   * Use this function if you want to separate allocations made by ORT during Run() calls from
   * those made during session initialization. This allows for separate memory management strategies for these
   * allocations.
   *
   * \return pointer to an allocated block of `size` bytes. nullptr if size was 0 or allocation failed.
   *
   * \since 1.18
   */
  void*(ORT_API_CALL* Reserve)(struct OrtAllocator* this_, size_t size);

  /**
   * @brief Function used to get the statistics of the allocator.
   *
   * Return a pointer to the OrtKeyValuePairs structure that contains the statistics of the allocator.
   * The user should call OrtApi::ReleaseKeyValuePairs when done.
   *
   * Current known keys are:
   * - Limit: Bytes limit of the allocator. -1 if no limit is set.
   * - InUse: Number of bytes in use.
   * - TotalAllocated: The total number of allocated bytes by the allocator.
   * - MaxInUse: The maximum bytes in use.
   * - NumAllocs: Number of allocations.
   * - NumReserves: Number of reserves. (Number of calls to Reserve() in arena-based allocators)
   * - NumArenaExtensions: Number of arena extensions (Relevant only for arena based allocators)
   * - NumArenaShrinkages: Number of arena shrinkages (Relevant only for arena based allocators)
   * - MaxAllocSize: The max single allocation seen.
   *
   * The allocator is free to add other entries as appropriate.
   *
   * \note Implementation of this function is optional and GetStats may be set to a nullptr.
   *       If the OrtAllocator is wrapping an internal ORT allocator that does not implement GetStats
   *       the returned OrtKeyValuePairs instance will be empty.
   *
   * \since 1.23
   */
  ORT_API2_STATUS(GetStats, _In_ const struct OrtAllocator* this_, _Outptr_ OrtKeyValuePairs** out);

  /** \brief Allocate using a stream.
   *
   * If the allocator is stream aware this performs allocation using a stream.
   *
   * Alloc will be used if this is nullptr.
   *
   * \param[in] this_ OrtAllocator instance
   * \param[in] size Size of the allocation in bytes. nullptr if size was 0 or allocation failed.
   * \param[in] stream The stream to allocate on.
   *
   * \return pointer to an allocated block of `size` bytes
   *
   * \note Implementation of this function is optional and AllocOnStream may be set to a nullptr.
   * \since 1.23
   */
  void*(ORT_API_CALL* AllocOnStream)(struct OrtAllocator* this_, size_t size, OrtSyncStream* stream);
} OrtAllocator;

typedef void(ORT_API_CALL* OrtLoggingFunction)(
    void* param, OrtLoggingLevel severity, const char* category, const char* logid, const char* code_location,
    const char* message);

/** \brief Graph optimization level
 *
 * Refer to https://www.onnxruntime.ai/docs/performance/graph-optimizations.html#graph-optimization-levels
 * for an in-depth understanding of the Graph Optimization Levels.
 */
typedef enum GraphOptimizationLevel {
  ORT_DISABLE_ALL = 0,
  ORT_ENABLE_BASIC = 1,
  ORT_ENABLE_EXTENDED = 2,
  ORT_ENABLE_LAYOUT = 3,
  ORT_ENABLE_ALL = 99
} GraphOptimizationLevel;

typedef enum ExecutionMode {
  ORT_SEQUENTIAL = 0,
  ORT_PARALLEL = 1,
} ExecutionMode;

/** \brief Language projection identifiers
 * /see OrtApi::SetLanguageProjection
 */
typedef enum OrtLanguageProjection {
  ORT_PROJECTION_C = 0,
  ORT_PROJECTION_CPLUSPLUS = 1,
  ORT_PROJECTION_CSHARP = 2,
  ORT_PROJECTION_PYTHON = 3,
  ORT_PROJECTION_JAVA = 4,
  ORT_PROJECTION_WINML = 5,
  ORT_PROJECTION_NODEJS = 6,
} OrtLanguageProjection;

struct OrtKernelInfo;
typedef struct OrtKernelInfo OrtKernelInfo;
struct OrtKernelContext;
typedef struct OrtKernelContext OrtKernelContext;
struct OrtCustomOp;
typedef struct OrtCustomOp OrtCustomOp;

typedef enum OrtAllocatorType {
  OrtInvalidAllocator = -1,
  OrtDeviceAllocator = 0,
  OrtArenaAllocator = 1,
  OrtReadOnlyAllocator = 2,
} OrtAllocatorType;

/** \brief Memory types for allocated memory, execution provider specific types should be extended in each provider.
 */
// Whenever this struct is updated, please also update the MakeKey function in onnxruntime / core / framework / execution_provider.cc
typedef enum OrtMemType {
  /// Any CPU memory used by non-CPU execution provider
  OrtMemTypeCPUInput = -2,
  /// CPU accessible memory outputted by non-CPU execution provider, i.e. HOST_ACCESSIBLE
  OrtMemTypeCPUOutput = -1,
  /// CPU accessible memory allocated by non-CPU execution provider, i.e. HOST_ACCESSIBLE
  OrtMemTypeCPU = OrtMemTypeCPUOutput,
  /// The default allocator for execution provider
  OrtMemTypeDefault = 0,
} OrtMemType;

/** \brief This matches OrtDevice::MemoryType values */
typedef enum OrtDeviceMemoryType {
  OrtDeviceMemoryType_DEFAULT = 0,          ///< Device memory
  OrtDeviceMemoryType_HOST_ACCESSIBLE = 5,  ///< Shared/pinned memory for transferring between CPU and the device
} OrtDeviceMemoryType;

/** \brief This mimics OrtDevice type constants so they can be returned in the API
 */
typedef enum OrtMemoryInfoDeviceType {
  OrtMemoryInfoDeviceType_CPU = 0,
  OrtMemoryInfoDeviceType_GPU = 1,
  OrtMemoryInfoDeviceType_FPGA = 2,
  OrtMemoryInfoDeviceType_NPU = 3,
} OrtMemoryInfoDeviceType;

typedef enum OrtHardwareDeviceType {
  OrtHardwareDeviceType_CPU,
  OrtHardwareDeviceType_GPU,
  OrtHardwareDeviceType_NPU
} OrtHardwareDeviceType;

/** \brief These are the default EP selection policies used by ORT when doing automatic EP selection.
 */
typedef enum OrtExecutionProviderDevicePolicy {
  OrtExecutionProviderDevicePolicy_DEFAULT,
  OrtExecutionProviderDevicePolicy_PREFER_CPU,
  OrtExecutionProviderDevicePolicy_PREFER_NPU,
  OrtExecutionProviderDevicePolicy_PREFER_GPU,
  OrtExecutionProviderDevicePolicy_MAX_PERFORMANCE,
  OrtExecutionProviderDevicePolicy_MAX_EFFICIENCY,
  OrtExecutionProviderDevicePolicy_MIN_OVERALL_POWER,
} OrtExecutionProviderDevicePolicy;

/** \brief Reasons why an execution provider might not be compatible with a device
 */
typedef enum OrtDeviceEpIncompatibilityReason {
  OrtDeviceEpIncompatibility_NONE = 0,
  OrtDeviceEpIncompatibility_DRIVER_INCOMPATIBLE = 1 << 0,
  OrtDeviceEpIncompatibility_DEVICE_INCOMPATIBLE = 1 << 1,
  OrtDeviceEpIncompatibility_MISSING_DEPENDENCY = 1 << 2,
  OrtDeviceEpIncompatibility_UNKNOWN = 1 << 31
} OrtDeviceEpIncompatibilityReason;

/** \brief Delegate to allow providing custom OrtEpDevice selection logic
 *
 * This delegate is called by the EP selection code to allow the user to provide custom device selection logic.
 * The user can use this to select OrtEpDevice instances from the list of available devices.
 *
 * \param ep_devices The list of available devices.
 * \param num_devices The number of available devices.
 * \param model_metadata The model metadata.
 * \param runtime_metadata The runtime metadata. May be nullptr.
 * \param selected Pre-allocated array to populate with selected OrtEpDevice pointers from ep_devices.
 * \param max_selected The maximum number of devices that can be selected in the pre-allocated array.
                       Currently the maximum is 8.
 * \param num_selected The number of selected devices.
 * \param state Opaque pointer. Required to use the delegate from other languages like C# and python.
 *
 * \return OrtStatus* Selection status. Return nullptr on success.
 *                    Use CreateStatus to provide error info. Use ORT_FAIL as the error code.
 *                    ORT will release the OrtStatus* if not null.
 */
typedef OrtStatus*(ORT_API_CALL* EpSelectionDelegate)(_In_ const OrtEpDevice** ep_devices,
                                                      _In_ size_t num_devices,
                                                      _In_ const OrtKeyValuePairs* model_metadata,
                                                      _In_opt_ const OrtKeyValuePairs* runtime_metadata,
                                                      _Inout_ const OrtEpDevice** selected,
                                                      _In_ size_t max_selected,
                                                      _Out_ size_t* num_selected,
                                                      _In_ void* state);

/** \brief Function called by ORT to write a buffer to a custom destination (e.g., file, stream, etc.).
 *
 * \param state Opaque pointer holding the user's state.
 * \param buffer The buffer to write.
 * \param buffer_num_bytes The size of the buffer in bytes.
 *
 * \return OrtStatus* Write status. Return nullptr on success.
 *                    Use CreateStatus to provide error info. Use ORT_FAIL as the error code.
 *                    ORT will release the OrtStatus* if not null.
 */
typedef OrtStatus*(ORT_API_CALL* OrtWriteBufferFunc)(_In_ void* state,
                                                     _In_ const void* buffer,
                                                     _In_ size_t buffer_num_bytes);

/** \brief Function called by ORT to allow user to specify how an initializer should be saved, that is, either
 * written to an external file or stored within the model. ORT calls this function for every initializer when
 * generating a model.
 *
 * If the function implementation sets the `new_external_info` output parameter to NULL, ORT stores the initializer data
 * within the generated model.
 *
 * Otherwise, if the function implementation sets `new_external_info` to a valid OrtExternalInitializerInfo instance,
 * ORT assumes that this function stores the initializer data in a file. In this case, ORT configures the model's
 * initializer to point to the location specified by the `new_external_info` output parameter.
 *
 * \param[in] state Opaque pointer holding the user's state.
 * \param[in] initializer_name The initializer's name as a null-terminated string.
 * \param[in] initializer_value OrtValue containing the initializer's data, type, and shape.
 * \param[in] external_info If the initializer is originally stored in an external file, `external_info` contains
 *                          the file path, file offset, and the data's byte size within the file. Otherwise,
 *                          `external_info` is NULL if the initializer is not originally stored in a file.
 * \param[out] new_external_info Output parameter set to a new OrtExternalInitializerInfo instance indicating the
 *                               location where the function implementation stored the initializer data.
 *                               The function implementation must use `OrtApi::CreateExternalInitializerInfo()` to
 *                               create the instance.
 *                               If the function implementation sets `new_external_info` to NULL,
 *                               ORT stores the initializers within the model.
 *
 * \note ORT takes ownership of the `new_external_info` output parameter.
 *
 * \return OrtStatus* Write status. Return nullptr on success.
 *                    Use CreateStatus to provide error info. Use ORT_FAIL as the error code.
 *                    ORT will release the OrtStatus* if not null.
 */
typedef OrtStatus*(ORT_API_CALL* OrtGetInitializerLocationFunc)(
    _In_ void* state,
    _In_ const char* initializer_name,
    _In_ const OrtValue* initializer_value,
    _In_opt_ const OrtExternalInitializerInfo* external_info,
    _Outptr_result_maybenull_ OrtExternalInitializerInfo** new_external_info);

/** \brief Algorithm to use for cuDNN Convolution Op
 */
typedef enum OrtCudnnConvAlgoSearch {
  OrtCudnnConvAlgoSearchExhaustive,  // expensive exhaustive benchmarking using cudnnFindConvolutionForwardAlgorithmEx
  OrtCudnnConvAlgoSearchHeuristic,   // lightweight heuristic based search using cudnnGetConvolutionForwardAlgorithm_v7
  OrtCudnnConvAlgoSearchDefault,     // default algorithm using CUDNN_CONVOLUTION_FWD_ALGO_IMPLICIT_PRECOMP_GEMM
} OrtCudnnConvAlgoSearch;

/** \brief CUDA Provider Options
 *
 * \see OrtApi::SessionOptionsAppendExecutionProvider_CUDA
 */
typedef struct OrtCUDAProviderOptions {
#ifdef __cplusplus
  OrtCUDAProviderOptions()
      : device_id{},
        cudnn_conv_algo_search{OrtCudnnConvAlgoSearchExhaustive},
        gpu_mem_limit{SIZE_MAX},
        arena_extend_strategy{},
        do_copy_in_default_stream{1},
        has_user_compute_stream{},
        user_compute_stream{},
        default_memory_arena_cfg{},
        tunable_op_enable{false},
        tunable_op_tuning_enable{false},
        tunable_op_max_tuning_duration_ms{} {}
#endif

  /** \brief CUDA device Id
   *   Defaults to 0.
   */
  int device_id;

  /** \brief CUDA Convolution algorithm search configuration.
   *   See enum OrtCudnnConvAlgoSearch for more details.
   *   Defaults to OrtCudnnConvAlgoSearchExhaustive.
   */
  OrtCudnnConvAlgoSearch cudnn_conv_algo_search;

  /** \brief CUDA memory limit (To use all possible memory pass in maximum size_t)
   *   Defaults to SIZE_MAX.
   *   \note If a ::OrtArenaCfg has been applied, it will override this field
   */
  size_t gpu_mem_limit;

  /** \brief Strategy used to grow the memory arena
   *   0 = kNextPowerOfTwo<br>
   *   1 = kSameAsRequested<br>
   *   Defaults to 0.
   *   \note If a ::OrtArenaCfg has been applied, it will override this field
   */
  int arena_extend_strategy;

  /** \brief Flag indicating if copying needs to take place on the same stream as the compute stream in the CUDA EP
   *   0 = Use separate streams for copying and compute.
   *   1 = Use the same stream for copying and compute.
   *   Defaults to 1.
   *   WARNING: Setting this to 0 may result in data races for some models.
   *   Please see issue #4829 for more details.
   */
  int do_copy_in_default_stream;

  /** \brief Flag indicating if there is a user provided compute stream
   *   Defaults to 0.
   */
  int has_user_compute_stream;

  /** \brief User provided compute stream.
   *   If provided, please set `has_user_compute_stream` to 1.
   */
  void* user_compute_stream;

  /** \brief CUDA memory arena configuration parameters
   */
  OrtArenaCfg* default_memory_arena_cfg;

  /** \brief Enable TunableOp for using.
   *   Set it to 1/0 to enable/disable TunableOp. Otherwise, it is disabled by default.
   *   This option can be overridden by environment variable ORT_CUDA_TUNABLE_OP_ENABLE.
   */
  int tunable_op_enable;

  /** \brief Enable TunableOp for tuning.
   *   Set it to 1/0 to enable/disable TunableOp tuning. Otherwise, it is disabled by default.
   *   This option can be overridden by environment variable ORT_CUDA_TUNABLE_OP_TUNING_ENABLE.
   */
  int tunable_op_tuning_enable;

  /** \brief Max tuning duration time limit for each instance of TunableOp.
   *   Defaults to 0 to disable the limit.
   */
  int tunable_op_max_tuning_duration_ms;

} OrtCUDAProviderOptions;

/** \brief ROCM Provider Options
 *
 * \see OrtApi::SessionOptionsAppendExecutionProvider_ROCM
 */
typedef struct OrtROCMProviderOptions {
#ifdef __cplusplus
  OrtROCMProviderOptions()
      : device_id{},
        miopen_conv_exhaustive_search{0},
        gpu_mem_limit{SIZE_MAX},
        arena_extend_strategy{},
        do_copy_in_default_stream{1},
        has_user_compute_stream{},
        user_compute_stream{},
        default_memory_arena_cfg{},
        enable_hip_graph{false},
        tunable_op_enable{false},
        tunable_op_tuning_enable{false},
        tunable_op_max_tuning_duration_ms{} {}
#endif

  /** \brief ROCM device Id
   *   Defaults to 0.
   */
  int device_id;

  /** \brief ROCM MIOpen Convolution algorithm exhaustive search option.
   *   Defaults to 0 (false).
   */
  int miopen_conv_exhaustive_search;

  /** \brief ROCM memory limit (To use all possible memory pass in maximum size_t)
   *   Defaults to SIZE_MAX.
   *   \note If a ::OrtArenaCfg has been applied, it will override this field
   */
  size_t gpu_mem_limit;

  /** \brief Strategy used to grow the memory arena
   *   0 = kNextPowerOfTwo<br>
   *   1 = kSameAsRequested<br>
   *   Defaults to 0.
   *   \note If a ::OrtArenaCfg has been applied, it will override this field
   */
  int arena_extend_strategy;

  /** \brief Flag indicating if copying needs to take place on the same stream as the compute stream in the ROCM EP
   *   0 = Use separate streams for copying and compute.
   *   1 = Use the same stream for copying and compute.
   *   Defaults to 1.
   *   WARNING: Setting this to 0 may result in data races for some models.
   *   Please see issue #4829 for more details.
   */
  int do_copy_in_default_stream;

  /** \brief Flag indicating if there is a user provided compute stream
   *   Defaults to 0.
   */
  int has_user_compute_stream;

  /** \brief User provided compute stream.
   *   If provided, please set `has_user_compute_stream` to 1.
   */
  void* user_compute_stream;

  /** \brief ROCM memory arena configuration parameters
   */
  OrtArenaCfg* default_memory_arena_cfg;

  int enable_hip_graph;

  /** \brief Enable TunableOp for using.
   *   Set it to 1/0 to enable/disable TunableOp. Otherwise, it is disabled by default.
   *   This option can be overridden by environment variable ORT_ROCM_TUNABLE_OP_ENABLE.
   */
  int tunable_op_enable;

  /** \brief Enable TunableOp for tuning.
   *   Set it to 1/0 to enable/disable TunableOp tuning. Otherwise, it is disabled by default.
   *   This option can be overridden by environment variable ORT_ROCM_TUNABLE_OP_TUNING_ENABLE.
   */
  int tunable_op_tuning_enable;

  /** \brief Max tuning duration time limit for each instance of TunableOp.
   *   Defaults to 0 to disable the limit.
   */
  int tunable_op_max_tuning_duration_ms;

} OrtROCMProviderOptions;

/** \brief TensorRT Provider Options
 *
 * \see OrtApi::SessionOptionsAppendExecutionProvider_TensorRT
 */
typedef struct OrtTensorRTProviderOptions {
  int device_id;                                ///< CUDA device id (0 = default device)
  int has_user_compute_stream;                  // indicator of user specified CUDA compute stream.
  void* user_compute_stream;                    // user specified CUDA compute stream.
  int trt_max_partition_iterations;             // maximum iterations for TensorRT parser to get capability
  int trt_min_subgraph_size;                    // minimum size of TensorRT subgraphs
  size_t trt_max_workspace_size;                // maximum workspace size for TensorRT.
  int trt_fp16_enable;                          // enable TensorRT FP16 precision. Default 0 = false, nonzero = true
  int trt_int8_enable;                          // enable TensorRT INT8 precision. Default 0 = false, nonzero = true
  const char* trt_int8_calibration_table_name;  // TensorRT INT8 calibration table name.
  int trt_int8_use_native_calibration_table;    // use native TensorRT generated calibration table. Default 0 = false, nonzero = true
  int trt_dla_enable;                           // enable DLA. Default 0 = false, nonzero = true
  int trt_dla_core;                             // DLA core number. Default 0
  int trt_dump_subgraphs;                       // dump TRT subgraph. Default 0 = false, nonzero = true
  int trt_engine_cache_enable;                  // enable engine caching. Default 0 = false, nonzero = true
  const char* trt_engine_cache_path;            // specify engine cache path
  int trt_engine_decryption_enable;             // enable engine decryption. Default 0 = false, nonzero = true
  const char* trt_engine_decryption_lib_path;   // specify engine decryption library path
  int trt_force_sequential_engine_build;        // force building TensorRT engine sequentially. Default 0 = false, nonzero = true
  // This is the legacy struct and don't add new fields here.
  // For new field that can be represented by string, please add it in include/onnxruntime/core/providers/tensorrt/tensorrt_provider_options.h
  // For non-string field, need to create a new separate api to handle it.
} OrtTensorRTProviderOptions;

/** \brief MIGraphX Provider Options
 *
 * \see OrtApi::SessionOptionsAppendExecutionProvider_MIGraphX
 */
typedef struct OrtMIGraphXProviderOptions {
  int device_id;                                     // hip device id.
  int migraphx_fp16_enable;                          // MIGraphX FP16 precision. Default 0 = false, nonzero = true
  int migraphx_fp8_enable;                           // MIGraphX FP8 precision. Default 0 = false, nonzero = true
  int migraphx_int8_enable;                          // MIGraphX INT8 precision. Default 0 = false, nonzero = true
  int migraphx_use_native_calibration_table;         // MIGraphx INT8 cal table. Default 0 = false, nonzero = true
  const char* migraphx_int8_calibration_table_name;  // MIGraphx INT8 calibration table name
  int migraphx_save_compiled_model;                  // migraphx save compiled model. Default 0 = false, nonzero = true
  const char* migraphx_save_model_path;              // migraphx model path name
  int migraphx_load_compiled_model;                  // migraphx int8 cal table. Default 0 = false, nonzero = true
  const char* migraphx_load_model_path;              // migraphx model path name
  bool migraphx_exhaustive_tune;                     // MIGraphX tuned compile. Default = false, nonzero = true

  /** \brief MIGraphX memory limit (To use all possible memory pass in maximum size_t)
   *   Defaults to SIZE_MAX.
   *   \note If a ::OrtArenaCfg has been applied, it will override this field
   */
  size_t migraphx_mem_limit;

  /** \brief Strategy used to grow the memory arena
   *   0 = kNextPowerOfTwo<br>
   *   1 = kSameAsRequested<br>
   *   Defaults to 0.
   *   \note If a ::OrtArenaCfg has been applied, it will override this field
   */
  int migraphx_arena_extend_strategy;

  // This is the legacy struct and don't add new fields here.
} OrtMIGraphXProviderOptions;

/** \brief OpenVINO Provider Options
 *  \brief This Struct is frozen since ORT 1.13.0. Its maintained part of Legacy API for compatibility.
 *  \brief For latest OpenVINO Provider Options update to the ProviderOptions map.
 *  \brief Latest OpenVINO Provider Options are listed in the
 *  \htmlonly
 *  <a href="https://onnxruntime.ai/docs/execution-providers/OpenVINO-ExecutionProvider.html#summary-of-options">onnxruntime document.</a>
 *  \endhtmlonly
 * \see OrtApi::SessionOptionsAppendExecutionProvider()
 */
typedef struct OrtOpenVINOProviderOptions {
#ifdef __cplusplus
  OrtOpenVINOProviderOptions() : device_type{},
                                 enable_npu_fast_compile{},
                                 device_id{},
                                 num_of_threads{},
                                 cache_dir{},
                                 context{},
                                 enable_opencl_throttling{},
                                 enable_dynamic_shapes{} {}
#endif
  /** \brief Device type string
   *
   * Valid settings are one of: "CPU_FP32", "CPU_FP16", "GPU_FP32", "GPU_FP16"
   */
  const char* device_type;
  unsigned char enable_npu_fast_compile;  ///< 0 = disabled, nonzero = enabled
  const char* device_id;
  size_t num_of_threads;  ///< 0 = Use default number of threads
  const char* cache_dir;  // path is set to empty by default
  void* context;
  unsigned char enable_opencl_throttling;  ///< 0 = disabled, nonzero = enabled
  unsigned char enable_dynamic_shapes;     ///< 0 = disabled, nonzero = enabled
} OrtOpenVINOProviderOptions;

struct OrtApi;
typedef struct OrtApi OrtApi;

struct OrtTrainingApi;
typedef struct OrtTrainingApi OrtTrainingApi;

struct OrtModelEditorApi;
typedef struct OrtModelEditorApi OrtModelEditorApi;

struct OrtCompileApi;
typedef struct OrtCompileApi OrtCompileApi;

struct OrtInteropApi;
typedef struct OrtInteropApi OrtInteropApi;

struct OrtEpApi;
typedef struct OrtEpApi OrtEpApi;

/** \brief The helper interface to get the right version of OrtApi
 *
 * Get a pointer to this structure through ::OrtGetApiBase
 */
struct OrtApiBase {
  /** \brief Get a pointer to the requested version of the ::OrtApi
   *
   * \param[in] version Must be ::ORT_API_VERSION
   * \return The ::OrtApi for the version requested, nullptr will be returned if this version is unsupported, for example when using a runtime
   *   older than the version created with this header file.
   *
   * One can call GetVersionString() to get the version of the Onnxruntime library for logging
   * and error reporting purposes.
   */
  const OrtApi*(ORT_API_CALL* GetApi)(uint32_t version)NO_EXCEPTION;

  /** \brief Returns a null terminated string of the version of the Onnxruntime library (eg: "1.8.1")
   *
   *  \return UTF-8 encoded version string. Do not deallocate the returned buffer.
   */
  const char*(ORT_API_CALL* GetVersionString)(void)NO_EXCEPTION;
};

typedef struct OrtApiBase OrtApiBase;

/** \brief The Onnxruntime library's entry point to access the C API
 *
 * Call this to get the a pointer to an ::OrtApiBase
 */
ORT_EXPORT const OrtApiBase* ORT_API_CALL OrtGetApiBase(void) NO_EXCEPTION;

/** \brief Thread work loop function
 *
 * Onnxruntime will provide the working loop on custom thread creation
 * Argument is an onnxruntime built-in type which will be provided when thread pool calls OrtCustomCreateThreadFn
 */
typedef void (*OrtThreadWorkerFn)(void* ort_worker_fn_param);

typedef const struct OrtCustomHandleType {
  char __place_holder;
}* OrtCustomThreadHandle;

/** \brief Ort custom thread creation function
 *
 * The function should return a thread handle to be used in onnxruntime thread pools
 * Onnxruntime will throw exception on return value of nullptr or 0, indicating that the function failed to create a thread
 */
typedef OrtCustomThreadHandle (*OrtCustomCreateThreadFn)(void* ort_custom_thread_creation_options, OrtThreadWorkerFn ort_thread_worker_fn, void* ort_worker_fn_param);

/** \brief Custom thread join function
 *
 * Onnxruntime thread pool destructor will call the function to join a custom thread.
 * Argument ort_custom_thread_handle is the value returned by OrtCustomCreateThreadFn
 */
typedef void (*OrtCustomJoinThreadFn)(OrtCustomThreadHandle ort_custom_thread_handle);

typedef OrtStatus*(ORT_API_CALL* RegisterCustomOpsFn)(OrtSessionOptions* options, const OrtApiBase* api);

/** \brief Callback function for RunAsync
 *
 * \param[in] user_data User specific data that passed back to the callback
 * \param[out] outputs On succeed, outputs host inference results, on error, the value will be nullptr
 * \param[out] num_outputs Number of outputs, on error, the value will be zero
 * \param[out] status On error, status will provide details
 */
typedef void (*RunAsyncCallbackFn)(void* user_data, OrtValue** outputs, size_t num_outputs, OrtStatusPtr status);

/** \brief External memory handle type for importing GPU resources.
 *
 * \todo Add OPAQUE_WIN32 for Windows Vulkan-specific memory handles
 * \todo Add POSIX file descriptor (OPAQUE_FD) for Linux Vulkan/CUDA/OpenCL interop
 * \todo Add Linux DMA-BUF file descriptor for embedded GPU memory sharing
 *
 * \since Version 1.24.
 */
typedef enum OrtExternalMemoryHandleType {
  ORT_EXTERNAL_MEMORY_HANDLE_TYPE_D3D12_RESOURCE = 0, /**< Shared HANDLE from ID3D12Device::CreateSharedHandle(resource) */
  ORT_EXTERNAL_MEMORY_HANDLE_TYPE_D3D12_HEAP = 1,     /**< Shared HANDLE from ID3D12Device::CreateSharedHandle(heap) */
} OrtExternalMemoryHandleType;

/** \brief Descriptor for importing external memory.
 *
 * \note The version field must be set to ORT_API_VERSION.
 *       This ensures forward compatibility as fields may be added in future versions.
 *
 * \since Version 1.24.
 */
typedef struct OrtExternalMemoryDescriptor {
  uint32_t version;                        /**< Must be ORT_API_VERSION */
  OrtExternalMemoryHandleType handle_type; /**< Type of the external memory handle */
  void* native_handle;                     /**< Platform-specific handle (e.g., Windows HANDLE) */
  size_t size_bytes;                       /**< Total size in bytes of the external allocation */
  size_t offset_bytes;                     /**< Offset in bytes into the allocation (default 0).
                                                Base offset for the imported memory region. */
} OrtExternalMemoryDescriptor;

/** \brief External semaphore type for GPU synchronization.
 *
 * \since Version 1.24.
 */
typedef enum OrtExternalSemaphoreType {
  ORT_EXTERNAL_SEMAPHORE_D3D12_FENCE = 0, /**< Shared HANDLE from ID3D12Device::CreateSharedHandle(fence) */
} OrtExternalSemaphoreType;

/** \brief Descriptor for importing external semaphores.
 *
 * \note The version field must be set to ORT_API_VERSION.
 *       This ensures forward compatibility as fields may be added in future versions.
 *
 * \since Version 1.24.
 */
typedef struct OrtExternalSemaphoreDescriptor {
  uint32_t version;              /**< Must be ORT_API_VERSION */
  OrtExternalSemaphoreType type; /**< Type of the external semaphore */
  void* native_handle;           /**< Platform-specific handle (e.g., Windows HANDLE) */
} OrtExternalSemaphoreDescriptor;

/** \brief Descriptor for creating a tensor from imported external memory.
 *
 * \note The version field must be set to ORT_API_VERSION.
 *       This ensures forward compatibility as fields may be added in future versions.
 *
 * \since Version 1.24.
 */
typedef struct OrtExternalTensorDescriptor {
  uint32_t version;                       /**< Must be ORT_API_VERSION */
  ONNXTensorElementDataType element_type; /**< Data type of tensor elements */
  const int64_t* shape;                   /**< Array of dimension sizes */
  size_t rank;                            /**< Number of dimensions */
  size_t offset_bytes;                    /**< Additional offset within imported memory (default 0).
                                               Applied relative to OrtExternalMemoryDescriptor::offset_bytes.
                                               Enables multiple tensors from the same imported memory handle. */
} OrtExternalTensorDescriptor;

/*
 * Public enum for compiled model compatibility across EPs.
 */
typedef enum OrtCompiledModelCompatibility {
  OrtCompiledModelCompatibility_EP_NOT_APPLICABLE = 0,
  OrtCompiledModelCompatibility_EP_SUPPORTED_OPTIMAL,
  OrtCompiledModelCompatibility_EP_SUPPORTED_PREFER_RECOMPILATION,
  OrtCompiledModelCompatibility_EP_UNSUPPORTED,
} OrtCompiledModelCompatibility;

/** \brief Configuration options for creating an OrtEnv.
 *
 * \note The version field must be set to ORT_API_VERSION.
 *       This ensures forward compatibility as fields may be added in future versions.
 *
 * \since Version 1.24.
 */
typedef struct OrtEnvCreationOptions {
  uint32_t version;  ///< Must be set to ORT_API_VERSION

  /** \brief The logging severity level for the environment. Must be set to a value from OrtLoggingLevel.
   *
   * \note Logging messages which are less severe than the `logging_severity_level` are not emitted.
   *
   * \note Serves as the default logging severity level for session creation and runs.
   *       Use OrtApi::SetSessionLogSeverityLevel to set a logging severity level for the creation of specific session.
   *       Use OrtApi::RunOptionsSetRunLogSeverityLevel to set a logging severity level for a specific session run.
   *
   * \since Version 1.24.
   */
  int32_t logging_severity_level;

  /** \brief The log identifier. Must be set to a valid UTF-8 null-terminated string.
   *
   * \note This string identifier is copied by ORT.
   *
   * \since Version 1.24.
   */
  const char* log_id;

  /** \brief Optional custom logging function. May be set to NULL.
   *
   * \note The OrtEnvCreationOptions::custom_logging_param is provided as the first argument to this logging function.
   *       This allows passing custom state into the logging function.
   *
   * \note This function is only called when a message's severity meets or exceeds the set logging severity level.
   *
   * \since Version 1.24.
   */
  OrtLoggingFunction custom_logging_function;

  /** \brief Optional state to pass as the first argument to OrtEnvCreationOptions::custom_logger_function.
   *         May be set to NULL.
   *
   * \since Version 1.24.
   */
  void* custom_logging_param;

  /** \brief Optional threading options for creating an environment with global thread pools shared across sessions.
   *         May be set to NULL.
   *
   * \note The OrtThreadingOptions instance is copied by ORT.
   *
   * \note Use OrtApi::CreateThreadingOptions() to create an instance of OrtThreadingOptions.
   *
   * \note Use this in conjunction with OrtApi::DisablePerSessionThreads or else the session will use its own
   *       thread pools.
   *
   * \since Version 1.24.
   */
  const OrtThreadingOptions* threading_options;

  /** \brief Optional environment configuration entries represented as string key-value pairs. May be set to NULL.
   *
   * \note The OrtKeyValuePairs instance is copied by ORT.
   *
   * \note Refer to onnxruntime_env_config_keys.h for common config entry keys and their supported values.
   *
   * \note An application provides environment-level configuration options for execution provider libraries by
   *       using keys with the prefix 'ep_factory.\\<ep_name\\>.'. Ex: the key 'ep_factory.my_ep.some_ep_key' represents
   *       a key named 'some_ep_key' that is meant to be consumed by an execution provider named 'my_ep'. Refer to
   *       the specific execution provider's documentation for valid keys and values.
   *
   * \note An application may separately set session-level configuration options for execution providers via other APIs
   *       such as SessionOptionsAppendExecutionProvider_V2, which store configuration entries within OrtSessionOptions.
   *       If an environment-level configuration conflicts with a session-level configuration, then
   *       precedence is determined by the execution provider library itself.
   *
   * \since Version 1.24.
   */
  const OrtKeyValuePairs* config_entries;

  //
  // End of fields available in ORT 1.24
  //

} OrtEnvCreationOptions;

/** \brief The C API
 *
 * All C API functions are defined inside this structure as pointers to functions.
 * Call OrtApiBase::GetApi to get a pointer to it
 *
 * \nosubgrouping
 */
struct OrtApi {
  /// \name OrtStatus
  /// @{

  /**
   * \brief Create an OrtStatus from a null terminated string
   *
   * \param[in] code
   * \param[in] msg A null-terminated string. Its contents will be copied.
   * \return A new OrtStatus object, must be destroyed with OrtApi::ReleaseStatus
   */
  OrtStatus*(ORT_API_CALL* CreateStatus)(OrtErrorCode code, _In_ const char* msg)NO_EXCEPTION ORT_ALL_ARGS_NONNULL;

  /** \brief Get OrtErrorCode from OrtStatus
   *
   * \param[in] status
   * \return OrtErrorCode that \p status was created with
   */
  OrtErrorCode(ORT_API_CALL* GetErrorCode)(_In_ const OrtStatus* status) NO_EXCEPTION ORT_ALL_ARGS_NONNULL;

  /** \brief Get error string from OrtStatus
   *
   * \param[in] status
   * \return The error message inside the `status`. Do not free the returned value.
   */
  const char*(ORT_API_CALL* GetErrorMessage)(_In_ const OrtStatus* status)NO_EXCEPTION ORT_ALL_ARGS_NONNULL;

  /// @}
  /// \name OrtEnv
  /// @{

  /** \brief Create an OrtEnv
   *
   * \note Invoking this function will return the same instance of the environment as that returned by a previous call
   * to another env creation function; all arguments to this function will be ignored.
   * \param[in] log_severity_level The log severity level.
   * \param[in] logid The log identifier.
   * \param[out] out Returned newly created OrtEnv. Must be freed with OrtApi::ReleaseEnv
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateEnv, OrtLoggingLevel log_severity_level, _In_ const char* logid, _Outptr_ OrtEnv** out);

  /** \brief Create an OrtEnv
   *
   * \note Invoking this function will return the same instance of the environment as that returned by a previous call
   * to another env creation function; all arguments to this function will be ignored. If you want to provide your
   * own logging function, consider setting it using the SetUserLoggingFunction API instead.
   * \param[in] logging_function A pointer to a logging function.
   * \param[in] logger_param A pointer to arbitrary data passed as the ::OrtLoggingFunction `param` parameter to
   *                         `logging_function`. This parameter is optional.
   * \param[in] log_severity_level The log severity level.
   * \param[in] logid The log identifier.
   * \param[out] out Returned newly created OrtEnv. Must be freed with OrtApi::ReleaseEnv
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateEnvWithCustomLogger, _In_ OrtLoggingFunction logging_function, _In_opt_ void* logger_param,
                  _In_ OrtLoggingLevel log_severity_level, _In_ const char* logid, _Outptr_ OrtEnv** out);

  /** \brief Enable Telemetry
   *
   * \note Telemetry events are on by default since they are lightweight
   * \param[in] env
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(EnableTelemetryEvents, _In_ const OrtEnv* env);
  /** \brief Disable Telemetry
   *
   * \see OrtApi::EnableTelemetryEvents
   * \param[in] env
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(DisableTelemetryEvents, _In_ const OrtEnv* env);

  /// @}
  /// \name OrtSession
  /// @{

  /** \brief Create an OrtSession from a model file
   *
   * \param[in] env
   * \param[in] model_path
   * \param[in] options
   * \param[out] out Returned newly created OrtSession. Must be freed with OrtApi::ReleaseSession
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  // TODO: document the path separator convention? '/' vs '\'
  // TODO: should specify the access characteristics of model_path. Is this read only during the
  // execution of CreateSession, or does the OrtSession retain a handle to the file/directory
  // and continue to access throughout the OrtSession lifetime?
  //  What sort of access is needed to model_path : read or read/write?
  ORT_API2_STATUS(CreateSession, _In_ const OrtEnv* env, _In_ const ORTCHAR_T* model_path,
                  _In_ const OrtSessionOptions* options, _Outptr_ OrtSession** out);

  /** \brief Create an OrtSession from memory
   *
   * \param[in] env
   * \param[in] model_data
   * \param[in] model_data_length
   * \param[in] options
   * \param[out] out Returned newly created OrtSession. Must be freed with OrtApi::ReleaseSession
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateSessionFromArray, _In_ const OrtEnv* env,
                  _In_ const void* model_data, size_t model_data_length,
                  _In_ const OrtSessionOptions* options, _Outptr_ OrtSession** out);

  /** \brief Run the model in an ::OrtSession
   *
   * Will not return until the model run has completed. Multiple threads might be used to run the model based on
   * the options in the ::OrtSession and settings used when creating the ::OrtEnv
   *
   * \param[in] session
   * \param[in] run_options If nullptr, will use a default ::OrtRunOptions
   * \param[in] input_names Array of null terminated UTF8 encoded strings of the input names
   * \param[in] inputs Array of ::OrtValue%s of the input values
   * \param[in] input_len Number of elements in the input_names and inputs arrays
   * \param[in] output_names Array of null terminated UTF8 encoded strings of the output names
   * \param[in] output_names_len Number of elements in the output_names and outputs array
   * \param[out] outputs Array of ::OrtValue%s that the outputs are stored in. This can also be
   *     an array of nullptr values, in this case ::OrtValue objects will be allocated and pointers
   *     to them will be set into the `outputs` array.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(Run, _Inout_ OrtSession* session, _In_opt_ const OrtRunOptions* run_options,
                  _In_reads_(input_len) const char* const* input_names,
                  _In_reads_(input_len) const OrtValue* const* inputs, size_t input_len,
                  _In_reads_(output_names_len) const char* const* output_names, size_t output_names_len,
                  _Inout_updates_all_(output_names_len) OrtValue** outputs);

  /// @}
  /// \name OrtSessionOptions
  /// @{

  /** \brief Create an ::OrtSessionOptions object
   *
   * To use additional providers, you must build ORT with the extra providers enabled. Then call one of these
   * functions to enable them in the session:<br>
   *   OrtSessionOptionsAppendExecutionProvider_CPU<br>
   *   OrtSessionOptionsAppendExecutionProvider_CUDA<br>
   *   OrtSessionOptionsAppendExecutionProvider_(remaining providers...)<br>
   * The order they are called indicates the preference order as well. In other words call this method
   * on your most preferred execution provider first followed by the less preferred ones.
   * If none are called Ort will use its internal CPU execution provider.
   *
   * \param[out] options The newly created OrtSessionOptions. Must be freed with OrtApi::ReleaseSessionOptions
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateSessionOptions, _Outptr_ OrtSessionOptions** options);

  /** \brief Set filepath to save optimized model after graph level transformations
   *
   * \param[in] options
   * \param[in] optimized_model_filepath
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SetOptimizedModelFilePath, _Inout_ OrtSessionOptions* options,
                  _In_ const ORTCHAR_T* optimized_model_filepath);

  /** \brief Create a copy of an existing ::OrtSessionOptions
   *
   * \param[in] in_options OrtSessionOptions to copy
   * \param[out] out_options Returned newly created ::OrtSessionOptions. Must be freed with OrtApi::ReleaseSessionOptions
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CloneSessionOptions, _In_ const OrtSessionOptions* in_options,
                  _Outptr_ OrtSessionOptions** out_options);

  /** \brief Set execution mode
   *
   * Controls whether you want to execute operators in your graph sequentially or in parallel. Usually when the model
   *  has many branches, setting this option to ExecutionMode.ORT_PARALLEL will give you better performance.
   *  See [docs/ONNX_Runtime_Perf_Tuning.md] for more details.
   *
   * \param[in] options
   * \param[in] execution_mode
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SetSessionExecutionMode, _Inout_ OrtSessionOptions* options, ExecutionMode execution_mode);

  /** \brief Enable profiling for a session
   *
   * \param[in] options
   * \param[in] profile_file_prefix
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(EnableProfiling, _Inout_ OrtSessionOptions* options, _In_ const ORTCHAR_T* profile_file_prefix);

  /** \brief Disable profiling for a session
   *
   * \param[in] options
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(DisableProfiling, _Inout_ OrtSessionOptions* options);

  /** \brief Enable the memory pattern optimization
   *
   * The idea is if the input shapes are the same, we could trace the internal memory allocation
   * and generate a memory pattern for future request. So next time we could just do one allocation
   * with a big chunk for all the internal memory allocation.
   * \note Memory pattern optimization is only available when Sequential Execution mode is enabled (see OrtApi::SetSessionExecutionMode)
   *
   * \see OrtApi::DisableMemPattern
   *
   * \param[in] options
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(EnableMemPattern, _Inout_ OrtSessionOptions* options);

  /** \brief Disable the memory pattern optimization
   *
   * \see OrtApi::EnableMemPattern
   *
   * \param[in] options
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(DisableMemPattern, _Inout_ OrtSessionOptions* options);

  /** \brief Enable the memory arena on CPU
   *
   * Arena may pre-allocate memory for future usage.
   *
   * \param[in] options
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(EnableCpuMemArena, _Inout_ OrtSessionOptions* options);

  /** \brief Disable the memory arena on CPU
   *
   * \param[in] options
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(DisableCpuMemArena, _Inout_ OrtSessionOptions* options);

  /** \brief Set session log id
   *
   * \param[in] options
   * \param[in] logid The log identifier.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SetSessionLogId, _Inout_ OrtSessionOptions* options, const char* logid);

  /** \brief Set session log verbosity level
   *
   * Applies to session load, initialization, etc
   *
   * \param[in] options
   * \param[in] session_log_verbosity_level \snippet{doc} snippets.dox Log Verbosity Level
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SetSessionLogVerbosityLevel, _Inout_ OrtSessionOptions* options, int session_log_verbosity_level);

  /** \brief Set session log severity level
   *
   * \param[in] options
   * \param[in] session_log_severity_level The log severity level (refer to ::OrtLoggingLevel for possible values).
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SetSessionLogSeverityLevel, _Inout_ OrtSessionOptions* options, int session_log_severity_level);

  /** \brief Set the optimization level to apply when loading a graph
   *
   * Please see https://onnxruntime.ai/docs/performance/model-optimizations/graph-optimizations.html for an in-depth explanation
   * \param[in,out] options The session options object
   * \param[in] graph_optimization_level The optimization level
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SetSessionGraphOptimizationLevel, _Inout_ OrtSessionOptions* options,
                  GraphOptimizationLevel graph_optimization_level);

  /** \brief Sets the number of threads used to parallelize the execution within nodes
   *
   * When running a single node operation, ex. add, this sets the maximum number of threads to use.
   *
   * \note If built with OpenMP, this has no effect on the number of threads used. In this case
   *       use the OpenMP env variables to configure the number of intra op num threads.
   *
   * \param[in] options
   * \param[in] intra_op_num_threads Number of threads to use<br>
   *   A value of 0 will use the default number of threads<br>
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SetIntraOpNumThreads, _Inout_ OrtSessionOptions* options, int intra_op_num_threads);

  /** \brief Sets the number of threads used to parallelize the execution of the graph
   *
   * If nodes can be run in parallel, this sets the maximum number of threads to use to run them in parallel.
   *
   * \note If sequential execution is enabled this value is ignored, it acts as if it was set to 1.
   *
   * \param[in] options
   * \param[in] inter_op_num_threads Number of threads to use<br>
   *   A value of 0 will use the default number of threads<br>
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SetInterOpNumThreads, _Inout_ OrtSessionOptions* options, int inter_op_num_threads);

  /// @}
  /// \name OrtCustomOpDomain
  /// @{

  /** \brief Create a custom op domain
   *
   * \param[in] domain
   * \param[out] out Newly created domain. Must be freed with OrtApi::ReleaseCustomOpDomain
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateCustomOpDomain, _In_ const char* domain, _Outptr_ OrtCustomOpDomain** out);

  /** \brief Add a custom op to a custom op domain
   *
   * \note The OrtCustomOp* pointer must remain valid until the ::OrtCustomOpDomain using it is released
   *
   * \param[in] custom_op_domain
   * \param[in] op
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CustomOpDomain_Add, _Inout_ OrtCustomOpDomain* custom_op_domain, _In_ const OrtCustomOp* op);

  /// @}
  /// \name OrtSessionOptions
  /// @{

  /** \brief Add custom op domain to a session options
   *
   * \note The OrtCustomOpDomain* must not be deleted until all sessions using it are released
   *
   * \param[in] options
   * \param[in] custom_op_domain
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(AddCustomOpDomain, _Inout_ OrtSessionOptions* options, _In_ OrtCustomOpDomain* custom_op_domain);

  /** \deprecated Use OrtApi::RegisterCustomOpsLibrary_V2.
   *
   * Registers custom ops from a shared library.
   *
   * Loads a shared library (dll on windows, so on linux, etc) named 'library_path' and looks for this entry point:
   *		OrtStatus* RegisterCustomOps(OrtSessionOptions * options, const OrtApiBase* api);
   * It then passes in the provided session options to this function along with the api base.
   * The handle to the loaded library is returned in library_handle. It can be freed by the caller after all sessions using the passed in
   * session options are destroyed, or if an error occurs and it is non null.
   *
   * \param[in] options
   * \param[in] library_path
   * \param[out] library_handle OS specific handle to the loaded library (Use FreeLibrary on Windows, dlclose on Linux, etc.. to unload)
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(RegisterCustomOpsLibrary, _Inout_ OrtSessionOptions* options, _In_ const char* library_path, _Outptr_ void** library_handle);

  /// @}
  /// \name OrtSession
  /// @{

  /** \brief Get input count for a session
   *
   * This number must also match the number of inputs passed to OrtApi::Run
   *
   * \see OrtApi::SessionGetInputTypeInfo, OrtApi::SessionGetInputName, OrtApi::Session
   *
   * \param[in] session
   * \param[out] out Number of inputs
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SessionGetInputCount, _In_ const OrtSession* session, _Out_ size_t* out);

  /** \brief Get output count for a session
   *
   * This number must also match the number of outputs returned by OrtApi::Run
   *
   * \see OrtApi::SessionGetOutputTypeInfo, OrtApi::SessionGetOutputName, OrtApi::Session
   *
   * \param[in] session
   * \param[out] out Number of outputs
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SessionGetOutputCount, _In_ const OrtSession* session, _Out_ size_t* out);

  /** \brief Get overridable initializer count
   *
   * \see OrtApi::SessionGetOverridableInitializerTypeInfo, OrtApi::SessionGetOverridableInitializerName
   *
   * \param[in] session
   * \param[in] out
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SessionGetOverridableInitializerCount, _In_ const OrtSession* session, _Out_ size_t* out);

  /** \brief Get input type information
   *
   * \param[in] session
   * \param[in] index Must be between 0 (inclusive) and what OrtApi::SessionGetInputCount returns (exclusive)
   * \param[out] type_info Must be freed with OrtApi::ReleaseTypeInfo
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SessionGetInputTypeInfo, _In_ const OrtSession* session, size_t index, _Outptr_ OrtTypeInfo** type_info);

  /** \brief Get output type information
   *
   * \param[in] session
   * \param[in] index Must be between 0 (inclusive) and what OrtApi::SessionGetOutputCount returns (exclusive)
   * \param[out] type_info Must be freed with OrtApi::ReleaseTypeInfo
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SessionGetOutputTypeInfo, _In_ const OrtSession* session, size_t index, _Outptr_ OrtTypeInfo** type_info);

  /** \brief Get overridable initializer type information
   *
   * \param[in] session
   * \param[in] index Must be between 0 (inclusive) and what OrtApi::SessionGetOverridableInitializerCount returns (exclusive)
   * \param[out] type_info Must be freed with OrtApi::ReleaseTypeInfo
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SessionGetOverridableInitializerTypeInfo, _In_ const OrtSession* session, size_t index, _Outptr_ OrtTypeInfo** type_info);

  /** \brief Get input name
   *
   * \param[in] session
   * \param[in] index Must be between 0 (inclusive) and what OrtApi::SessionGetInputCount returns (exclusive)
   * \param[in] allocator
   * \param[out] value Set to a null terminated UTF-8 encoded string allocated using `allocator`. Must be freed using `allocator`.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SessionGetInputName, _In_ const OrtSession* session, size_t index, _Inout_ OrtAllocator* allocator, _Outptr_ char** value);

  /** \brief Get output name
   *
   * \param[in] session
   * \param[in] index Must be between 0 (inclusive) and what OrtApi::SessionGetOutputCount returns (exclusive)
   * \param[in] allocator
   * \param[out] value Set to a null terminated UTF-8 encoded string allocated using `allocator`. Must be freed using `allocator`.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SessionGetOutputName, _In_ const OrtSession* session, size_t index, _Inout_ OrtAllocator* allocator, _Outptr_ char** value);

  /** \brief Get overridable initializer name
   *
   * \param[in] session
   * \param[in] index Must be between 0 (inclusive) and what OrtApi::SessionGetOverridableInitializerCount returns (exclusive)
   * \param[in] allocator
   * \param[out] value Set to a null terminated UTF-8 encoded string allocated using `allocator`. Must be freed using `allocator`.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SessionGetOverridableInitializerName, _In_ const OrtSession* session, size_t index,
                  _Inout_ OrtAllocator* allocator, _Outptr_ char** value);

  /// @}
  /// \name OrtRunOptions
  /// @{

  /** \brief Create an OrtRunOptions
   *
   * \param[out] out Returned newly created ::OrtRunOptions. Must be freed with OrtApi::ReleaseRunOptions
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateRunOptions, _Outptr_ OrtRunOptions** out);

  /** \brief Set per-run log verbosity level
   *
   * \see OrtApi::RunOptionsGetRunLogVerbosityLevel
   *
   * \param[in] options
   * \param[in] log_verbosity_level \snippet{doc} snippets.dox Log Verbosity Level
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(RunOptionsSetRunLogVerbosityLevel, _Inout_ OrtRunOptions* options, int log_verbosity_level);

  /** \brief Set per-run log severity level
   *
   * \see OrtApi::RunOptionsGetRunLogSeverityLevel
   *
   * \param[in] options
   * \param[in] log_severity_level The log severity level (refer to ::OrtLoggingLevel for possible values).
   */
  ORT_API2_STATUS(RunOptionsSetRunLogSeverityLevel, _Inout_ OrtRunOptions* options, int log_severity_level);

  /** \brief Set per-run tag
   *
   * This is used in a per-run log identifier.
   *
   * \see OrtApi::RunOptionsGetRunTag
   *
   * \param[in] options
   * \param[in] run_tag The run tag.
   */
  ORT_API2_STATUS(RunOptionsSetRunTag, _Inout_ OrtRunOptions* options, _In_ const char* run_tag);

  /** \brief Get per-run log verbosity level
   *
   * \see OrtApi::RunOptionsSetRunLogVerbosityLevel
   *
   * \param[in] options
   * \param[out] log_verbosity_level \snippet{doc} snippets.dox Log Verbosity Level
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(RunOptionsGetRunLogVerbosityLevel, _In_ const OrtRunOptions* options,
                  _Out_ int* log_verbosity_level);

  /** \brief Get per-run log severity level
   *
   * \see OrtApi::RunOptionsSetRunLogSeverityLevel
   *
   * \param[in] options
   * \param[out] log_severity_level The log severity level (refer to ::OrtLoggingLevel for possible values).
   */
  ORT_API2_STATUS(RunOptionsGetRunLogSeverityLevel, _In_ const OrtRunOptions* options, _Out_ int* log_severity_level);

  /** \brief Get per-run tag
   *
   * This is used in a per-run log identifier.
   *
   * \see OrtApi::RunOptionsSetRunTag
   *
   * \param[in] options
   * \param[out] run_tag The run tag.
   *                     Do not free this value, it is owned by `options`. It will be invalidated if the run tag
   *                     changes (i.e., with OrtApi::RunOptionsSetRunTag) or `options` is freed.
   */
  ORT_API2_STATUS(RunOptionsGetRunTag, _In_ const OrtRunOptions* options, _Out_ const char** run_tag);

  /** \brief Set terminate flag
   *
   * If a currently executing session needs to be force terminated, this can be called from another thread to force it to fail with an error.
   *
   * \param[in] options
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(RunOptionsSetTerminate, _Inout_ OrtRunOptions* options);

  /** \brief Clears the terminate flag
   *
   * Used so the OrtRunOptions instance can be used in a new OrtApi::Run call without it instantly terminating
   *
   * \param[in] options
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(RunOptionsUnsetTerminate, _Inout_ OrtRunOptions* options);

  /// @}
  /// \name OrtValue
  /// @{

  /** \brief Create a tensor
   *
   * Create a tensor using a supplied ::OrtAllocator
   *
   * \param[in] allocator
   * \param[in] shape Pointer to the tensor shape dimensions.
   * \param[in] shape_len The number of tensor shape dimensions.
   * \param[in] type
   * \param[out] out Returns newly created ::OrtValue. Must be freed with OrtApi::ReleaseValue
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateTensorAsOrtValue, _Inout_ OrtAllocator* allocator, _In_ const int64_t* shape, size_t shape_len,
                  ONNXTensorElementDataType type, _Outptr_ OrtValue** out);

  /** \brief Create a tensor backed by a user supplied buffer
   *
   * Create a tensor with user's buffer. You can fill the buffer either before calling this function or after.
   * p_data is owned by caller. ReleaseValue won't release p_data.
   *
   * If you wish to transfer ownership of p_data to ORT use CreateTensorWithDataAndDeleterAsOrtValue.
   *
   * \param[in] info Memory description of where the p_data buffer resides (CPU vs GPU etc).
   * \param[in] p_data Pointer to the data buffer.
   * \param[in] p_data_len The number of bytes in the data buffer.
   * \param[in] shape Pointer to the tensor shape dimensions.
   * \param[in] shape_len The number of tensor shape dimensions.
   * \param[in] type The data type.
   * \param[out] out Returns newly created ::OrtValue. Must be freed with OrtApi::ReleaseValue
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateTensorWithDataAsOrtValue, _In_ const OrtMemoryInfo* info, _Inout_ void* p_data,
                  size_t p_data_len, _In_ const int64_t* shape, size_t shape_len, ONNXTensorElementDataType type,
                  _Outptr_ OrtValue** out);

  /** \brief Return if an ::OrtValue is a tensor type
   *
   * \param[in] value A tensor type (string tensors are not supported)
   * \param[out] out Set to 1 iff ::OrtValue is a tensor, 0 otherwise
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(IsTensor, _In_ const OrtValue* value, _Out_ int* out);

  /** \brief Get a pointer to the raw data inside a tensor
   *
   * Used to read/write/modify the internal tensor data directly.
   * \note The returned pointer is valid until the \p value is destroyed.
   *
   * \param[in] value A tensor type (string tensors are not supported)
   * \param[out] out Filled in with a pointer to the internal storage
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetTensorMutableData, _In_ OrtValue* value, _Outptr_ void** out);

  /** \brief Set all strings at once in a string tensor
   *
   * \param[in,out] value A tensor of type ONNX_TENSOR_ELEMENT_DATA_TYPE_STRING
   * \param[in] s An array of strings. Each string in this array must be null terminated.
   * \param[in] s_len Count of strings in s (Must match the size of \p value's tensor shape)
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(FillStringTensor, _Inout_ OrtValue* value, _In_ const char* const* s, size_t s_len);

  /** \brief Get total byte length for all strings in a string tensor
   *
   * Typically used with OrtApi::GetStringTensorContent
   *
   * \param[in] value A tensor of type ONNX_TENSOR_ELEMENT_DATA_TYPE_STRING
   * \param[out] len Total byte length of all strings (does not include trailing nulls)
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetStringTensorDataLength, _In_ const OrtValue* value, _Out_ size_t* len);

  /** \brief Get all strings from a string tensor
   *
   * An example of the results:<br>
   * Given \p value is a string tensor with the strings { "This" "is" "a" "test" }<br>
   * \p s must have a size of 11 bytes<br>
   * \p offsets must have 4 elements<br>
   * After the call, these values will be filled in:<br>
   * \p s will contain "Thisisatest"<br>
   * \p offsets will contain { 0, 4, 6, 7 }<br>
   * The length of the last string is just s_len - offsets[last]
   *
   * \param[in] value A tensor of type ONNX_TENSOR_ELEMENT_DATA_TYPE_STRING
   * \param[in] s Buffer to sequentially write all tensor strings to. Each string is NOT null-terminated.
   * \param[in] s_len Number of bytes of buffer pointed to by \p s (Get it from OrtApi::GetStringTensorDataLength)
   * \param[out] offsets Array of start offsets into the strings written to \p s
   * \param[in] offsets_len Number of elements in offsets
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetStringTensorContent, _In_ const OrtValue* value, _Out_writes_bytes_all_(s_len) void* s,
                  size_t s_len, _Out_writes_all_(offsets_len) size_t* offsets, size_t offsets_len);

  /// @}
  /// \name OrtTypeInfo
  /// @{

  /** \brief Get ::OrtTensorTypeAndShapeInfo from an ::OrtTypeInfo
   *
   * \param[in] type_info
   * \param[out] out Do not free this value, it will be valid until type_info is freed.
   *             If type_info does not represent tensor, this value will be set to nullptr.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CastTypeInfoToTensorInfo, _In_ const OrtTypeInfo* type_info,
                  _Outptr_result_maybenull_ const OrtTensorTypeAndShapeInfo** out);

  /** \brief Get ::ONNXType from ::OrtTypeInfo
   *
   * \param[in] type_info
   * \param[out] out
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetOnnxTypeFromTypeInfo, _In_ const OrtTypeInfo* type_info, _Out_ enum ONNXType* out);

  /// @}
  /// \name OrtTensorTypeAndShapeInfo
  /// @{

  /** \brief Create an ::OrtTensorTypeAndShapeInfo object
   *
   * \param[out] out Returns newly created ::OrtTensorTypeAndShapeInfo. Must be freed with OrtApi::ReleaseTensorTypeAndShapeInfo
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateTensorTypeAndShapeInfo, _Outptr_ OrtTensorTypeAndShapeInfo** out);

  /** \brief Set element type in ::OrtTensorTypeAndShapeInfo
   *
   * \param[in] info
   * \param[in] type
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SetTensorElementType, _Inout_ OrtTensorTypeAndShapeInfo* info, enum ONNXTensorElementDataType type);

  /** \brief Set shape information in ::OrtTensorTypeAndShapeInfo
   *
   * \param[in] info
   * \param[in] dim_values Array with `dim_count` elements. Can contain negative values.
   * \param[in] dim_count Number of elements in `dim_values`
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SetDimensions, OrtTensorTypeAndShapeInfo* info, _In_ const int64_t* dim_values, size_t dim_count);

  /** \brief Get element type in ::OrtTensorTypeAndShapeInfo
   *
   * \see OrtApi::SetTensorElementType
   *
   * \param[in] info
   * \param[out] out
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetTensorElementType, _In_ const OrtTensorTypeAndShapeInfo* info,
                  _Out_ enum ONNXTensorElementDataType* out);

  /** \brief Get dimension count in ::OrtTensorTypeAndShapeInfo
   *
   * \see OrtApi::GetDimensions
   *
   * \param[in] info
   * \param[out] out
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetDimensionsCount, _In_ const OrtTensorTypeAndShapeInfo* info, _Out_ size_t* out);

  /** \brief Get dimensions in ::OrtTensorTypeAndShapeInfo
   *
   * \param[in] info
   * \param[out] dim_values Array with `dim_values_length` elements. On return, filled with the dimensions stored in the ::OrtTensorTypeAndShapeInfo
   * \param[in] dim_values_length Number of elements in `dim_values`. Use OrtApi::GetDimensionsCount to get this value
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetDimensions, _In_ const OrtTensorTypeAndShapeInfo* info, _Out_ int64_t* dim_values,
                  size_t dim_values_length);

  /** \brief Get symbolic dimension names in ::OrtTensorTypeAndShapeInfo
   *
   * \param[in] info
   * \param[in] dim_params Array with `dim_params_length` elements. On return filled with pointers to null terminated strings of the dimension names
   * \param[in] dim_params_length Number of elements in `dim_params`. Use OrtApi::GetDimensionsCount to get this value
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetSymbolicDimensions, _In_ const OrtTensorTypeAndShapeInfo* info,
                  _Out_writes_all_(dim_params_length) const char* dim_params[], size_t dim_params_length);

  /** \brief Get total number of elements in a tensor shape from an ::OrtTensorTypeAndShapeInfo
   *
   * Return the number of elements specified by the tensor shape (all dimensions multiplied by each other).
   * For 0 dimensions, 1 is returned. If any dimension is less than 0, the result is always -1.
   *
   * Examples:<br>
   * [] = 1<br>
   * [1,3,4] = 12<br>
   * [2,0,4] = 0<br>
   * [-1,3,4] = -1<br>
   *
   * \param[in] info
   * \param[out] out Number of elements
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetTensorShapeElementCount, _In_ const OrtTensorTypeAndShapeInfo* info, _Out_ size_t* out);

  /// @}
  /// \name OrtValue
  /// @{

  /** \brief Get type and shape information from a tensor ::OrtValue
   *
   * \param[in] value Must be a tensor (not a map/sequence/etc) or will return failure
   * \param[out] out Newly created ::OrtTensorTypeAndShapeInfo. Must be freed with OrtApi::ReleaseTensorTypeAndShapeInfo
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetTensorTypeAndShape, _In_ const OrtValue* value, _Outptr_ OrtTensorTypeAndShapeInfo** out);

  /** \brief Get type information of an OrtValue
   *
   * \param[in] value
   * \param[out] out Newly created ::OrtTypeInfo. Must be freed with OrtApi::ReleaseTypeInfo
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetTypeInfo, _In_ const OrtValue* value, _Outptr_result_maybenull_ OrtTypeInfo** out);

  /** \brief Get ONNXType of an ::OrtValue
   *
   * \param[in] value
   * \param[out] out
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetValueType, _In_ const OrtValue* value, _Out_ enum ONNXType* out);

  /// @}
  /// \name OrtMemoryInfo
  /// @{

  /** \brief Create an ::OrtMemoryInfo
   *
   * \param[in] name
   * \param[in] type
   * \param[in] id
   * \param[in] mem_type
   * \param[out] out Newly created ::OrtMemoryInfo. Must be freed with OrtAPi::ReleaseMemoryInfo
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateMemoryInfo, _In_ const char* name, enum OrtAllocatorType type, int id,
                  enum OrtMemType mem_type, _Outptr_ OrtMemoryInfo** out);

  /** \brief Create an ::OrtMemoryInfo for CPU memory
   *
   * Special case version of OrtApi::CreateMemoryInfo for CPU based memory. Same as using OrtApi::CreateMemoryInfo with name = "Cpu" and id = 0.
   *
   * \param[in] type
   * \param[in] mem_type
   * \param[out] out
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateCpuMemoryInfo, enum OrtAllocatorType type, enum OrtMemType mem_type,
                  _Outptr_ OrtMemoryInfo** out);

  /** \brief Compare ::OrtMemoryInfo objects for equality
   *
   * Compares all settings of each ::OrtMemoryInfo for equality
   *
   * \param[in] info1
   * \param[in] info2
   * \param[out] out Set to 0 if equal, -1 if not equal
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CompareMemoryInfo, _In_ const OrtMemoryInfo* info1, _In_ const OrtMemoryInfo* info2, _Out_ int* out);

  /** \brief Get name from ::OrtMemoryInfo
   *
   * \param[in] ptr
   * \param[out] out Writes null terminated string to this pointer. Do NOT free the returned pointer. It is valid for the lifetime of the ::OrtMemoryInfo
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(MemoryInfoGetName, _In_ const OrtMemoryInfo* ptr, _Out_ const char** out);

  /** \brief Get the device id from ::OrtMemoryInfo
   */
  ORT_API2_STATUS(MemoryInfoGetId, _In_ const OrtMemoryInfo* ptr, _Out_ int* out);

  /** \brief Get the ::OrtMemType from ::OrtMemoryInfo
   */
  ORT_API2_STATUS(MemoryInfoGetMemType, _In_ const OrtMemoryInfo* ptr, _Out_ OrtMemType* out);

  /** \brief Get the ::OrtAllocatorType from ::OrtMemoryInfo
   */
  ORT_API2_STATUS(MemoryInfoGetType, _In_ const OrtMemoryInfo* ptr, _Out_ OrtAllocatorType* out);

  /// @}
  /// \name OrtAllocator
  /// @{

  /// \brief Calls OrtAllocator::Alloc function
  ORT_API2_STATUS(AllocatorAlloc, _Inout_ OrtAllocator* ort_allocator, size_t size, _Outptr_ void** out);
  /// \brief Calls OrtAllocator::Free function
  ORT_API2_STATUS(AllocatorFree, _Inout_ OrtAllocator* ort_allocator, void* p);
  /// \brief Calls OrtAllocator::Info function
  ORT_API2_STATUS(AllocatorGetInfo, _In_ const OrtAllocator* ort_allocator, _Outptr_ const struct OrtMemoryInfo** out);

  /** \brief Get the default allocator
   *
   * The default allocator is a CPU based, non-arena. Always returns the same pointer to the same default allocator.
   *
   * \param[out] out Returned value should NOT be freed
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetAllocatorWithDefaultOptions, _Outptr_ OrtAllocator** out);

  /// @}
  /// \name OrtSessionOptions
  /// @{

  /** \brief Override session symbolic dimensions
   *
   * Override symbolic dimensions (by specific denotation strings) with actual values if known at session initialization time to enable
   * optimizations that can take advantage of fixed values (such as memory planning, etc)
   *
   * \param[in] options
   * \param[in] dim_denotation
   * \param[in] dim_value
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(AddFreeDimensionOverride, _Inout_ OrtSessionOptions* options, _In_ const char* dim_denotation,
                  _In_ int64_t dim_value);

  /// @}
  /// \name OrtValue
  /// @{

  /* Internal information (not seen in Doxygen)
   *
   * APIs to support non-tensor types - map and sequence.
   * Currently only the following types are supported
   * Note: the following types should be kept in sync with data_types.h
   * Map types
   * =========
   * std::map<std::string, std::string>
   * std::map<std::string, int64_t>
   * std::map<std::string, float>
   * std::map<std::string, double>
   * std::map<int64_t, std::string>
   * std::map<int64_t, int64_t>
   * std::map<int64_t, float>
   * std::map<int64_t, double>
   *
   * Sequence types
   * ==============
   * std::vector<std::string>
   * std::vector<int64_t>
   * std::vector<float>
   * std::vector<double>
   * std::vector<std::map<std::string, float>>
   * std::vector<std::map<int64_t, float>
   */

  /** \brief Get non tensor data from an ::OrtValue
   *
   * If `value` is of type ONNX_TYPE_MAP, you need to retrieve the keys and values
   * separately. Use index=0 to retrieve keys and index=1 to retrieve values.
   * If `value` is of type ONNX_TYPE_SEQUENCE, use index to retrieve the index'th element
   * of the sequence.
   *
   * \param[in] value
   * \param[in] index See above for usage based on `value` type
   * \param[in] allocator Allocator used to allocate ::OrtValue
   * \param[out] out Created ::OrtValue that holds the element requested. Must be freed with OrtApi::ReleaseValue
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetValue, _In_ const OrtValue* value, int index, _Inout_ OrtAllocator* allocator,
                  _Outptr_ OrtValue** out);

  /** \brief Get non tensor value count from an ::OrtValue
   *
   * If `value` is of type ONNX_TYPE_MAP 2 will always be returned. For ONNX_TYPE_SEQUENCE
   * the number of elements in the sequence will be returned
   *
   * \param[in] value
   * \param[out] out
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetValueCount, _In_ const OrtValue* value, _Out_ size_t* out);

  /** \brief Create a map or sequence ::OrtValue
   *
   * To construct a map (ONNX_TYPE_MAP), use num_values = 2 and `in` should be an array of 2 ::OrtValue%s
   * representing keys and values.<br>
   *
   * To construct a sequence (ONNX_TYPE_SEQUENCE), use num_values = N where N is the number of the elements in the
   * sequence. 'in' should be an array of N ::OrtValue%s.
   *
   * \param[in] in See above for details
   * \param[in] num_values
   * \param[in] value_type Must be either ONNX_TYPE_MAP or ONNX_TYPE_SEQUENCE
   * \param[out] out Newly created ::OrtValue. Must be freed with OrtApi::ReleaseValue
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateValue, _In_reads_(num_values) const OrtValue* const* in, size_t num_values,
                  enum ONNXType value_type, _Outptr_ OrtValue** out);

  /** \brief Create an opaque (custom user defined type) ::OrtValue
   *
   * Constructs an ::OrtValue that contains a value of non-standard type created for
   * experiments or while awaiting standardization. ::OrtValue in this case would contain
   * an internal representation of the Opaque type. Opaque types are distinguished from
   * each other by two strings 1) domain and 2) type name. The combination of the two
   * must be unique, so the type representation is properly identified internally. The combination
   * must be properly registered from within ORT at both compile/run time or by another API.
   *
   * To construct the ::OrtValue pass domain and type names, also a pointer to a data container
   * the type of which must be known to both ORT and the client program. That data container may or may
   * not match the internal representation of the Opaque type. The sizeof(data_container) is passed for
   * verification purposes.
   *
   * \param[in] domain_name Null terminated string of the domain name
   * \param[in] type_name Null terminated string of the type name
   * \param[in] data_container User pointer Data to populate ::OrtValue
   * \param[in] data_container_size Size in bytes of what `data_container` points to
   * \param[out] out Newly created ::OrtValue. Must be freed with OrtApi::ReleaseValue
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateOpaqueValue, _In_z_ const char* domain_name, _In_z_ const char* type_name,
                  _In_ const void* data_container, size_t data_container_size, _Outptr_ OrtValue** out);

  /** \brief Get internal data from an opaque (custom user defined type) ::OrtValue
   *
   * Copies internal data from an opaque value into a user provided buffer
   *
   * \see OrtApi::CreateOpaqueValue
   *
   * \param[in] domain_name Null terminated string of the domain name
   * \param[in] type_name Null terminated string of the type name
   * \param[in] in The opaque ::OrtValue
   * \param[out] data_container Buffer to copy data into
   * \param[out] data_container_size Size in bytes of the buffer pointed to by data_container. Must match the size of the internal buffer.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetOpaqueValue, _In_ const char* domain_name, _In_ const char* type_name, _In_ const OrtValue* in,
                  _Out_ void* data_container, size_t data_container_size);

  /// @}
  /// \name OrtKernelInfo
  /// Custom operator APIs.
  /// @{

  /** \brief Get a float stored as an attribute in the graph node
   *
   * \param[in] info ::OrtKernelInfo instance
   * \param[in] name Null terminated string of the name of the attribute
   * \param[out] out Pointer to memory where the attribute will be stored
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(KernelInfoGetAttribute_float, _In_ const OrtKernelInfo* info, _In_ const char* name,
                  _Out_ float* out);

  /** \brief Fetch a 64-bit int stored as an attribute in the graph node
   *
   * \param[in] info ::OrtKernelInfo instance
   * \param[in] name Null terminated string of the name of the attribute
   * \param[out] out Pointer to memory where the attribute will be stored
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(KernelInfoGetAttribute_int64, _In_ const OrtKernelInfo* info, _In_ const char* name,
                  _Out_ int64_t* out);

  /** \brief Fetch a string stored as an attribute in the graph node
   *
   * If `out` is nullptr, the value of `size` is set to the true size of the string
   * attribute, and a success status is returned.
   *
   * If the `size` parameter is greater than or equal to the actual string attribute's size,
   * the value of `size` is set to the true size of the string attribute, the provided memory
   * is filled with the attribute's contents, and a success status is returned.
   *
   * If the `size` parameter is less than the actual string attribute's size and `out`
   * is not nullptr, the value of `size` is set to the true size of the string attribute
   * and a failure status is returned.)
   *
   * \param[in] info ::OrtKernelInfo instance
   * \param[in] name Null terminated string of the name of the attribute
   * \param[out] out Pointer to memory where the attribute will be stored
   * \param[in,out] size See above comments for details
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(KernelInfoGetAttribute_string, _In_ const OrtKernelInfo* info, _In_ const char* name, _Out_ char* out,
                  _Inout_ size_t* size);

  /// @}
  /// \name OrtKernelContext
  /// Custom operator APIs.
  /// @{

  /** \brief Used for custom operators, get the input count of a kernel
   *
   * \see ::OrtCustomOp
   */
  ORT_API2_STATUS(KernelContext_GetInputCount, _In_ const OrtKernelContext* context, _Out_ size_t* out);

  /** \brief Used for custom operators, get the output count of a kernel
   *
   * \see ::OrtCustomOp
   */
  ORT_API2_STATUS(KernelContext_GetOutputCount, _In_ const OrtKernelContext* context, _Out_ size_t* out);

  /** \brief Used for custom operators, get an input of a kernel
   *
   * The function attempts fetches the input of the kernel. If the input is optional
   * and not present, the function returns success and out is set to nullptr.
   *
   * \param[in] context ::OrtKernelContext instance
   * \param[in] index See KernelContext_GetInputCount for boundaries check.
   * \param[out] out OrtValue if the input is present otherwise is set nullptr
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(KernelContext_GetInput, _In_ const OrtKernelContext* context, _In_ size_t index,
                  _Out_ const OrtValue** out);

  /** \brief Used for custom operators, get an output of a kernel
   *
   * The function attempts fetches the output of the kernel. If the output is optional
   * and not present, the function returns success and out is set to nullptr.
   *
   * \param[in] context ::OrtKernelContext instance
   * \param[in] index See KernelContext_GetOutputCount for boundaries check.
   * \param[in] dim_values output dimensions
   * \param[in] dim_count number of dimensions
   * \param[out] out a ptr to OrtValue to output otherwise set to nullptr
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(KernelContext_GetOutput, _Inout_ OrtKernelContext* context, _In_ size_t index,
                  _In_ const int64_t* dim_values, size_t dim_count, _Outptr_ OrtValue** out);

  /// @}
  /// \name OrtEnv
  /// @{
  ORT_CLASS_RELEASE(Env);
  /// @}
  /// \name OrtStatus
  /// @{
  ORT_CLASS_RELEASE(Status);
  /// @}
  /// \name OrtMemoryInfo
  /// @{
  ORT_CLASS_RELEASE(MemoryInfo);
  /// @}
  /// \name OrtSession
  /// @{
  ORT_CLASS_RELEASE(Session);  // Don't call ReleaseSession from Dllmain (because session owns a thread pool)
  /// @}
  /// \name OrtValue
  /// @{
  ORT_CLASS_RELEASE(Value);
  /// @}
  /// \name OrtRunOptions
  /// @{
  ORT_CLASS_RELEASE(RunOptions);
  /// @}
  /// \name OrtTypeInfo
  /// @{
  ORT_CLASS_RELEASE(TypeInfo);
  /// @}
  /// \name OrtTensorTypeAndShapeInfo
  /// @{
  ORT_CLASS_RELEASE(TensorTypeAndShapeInfo);
  /// @}
  /// \name OrtSessionOptions
  /// @{
  ORT_CLASS_RELEASE(SessionOptions);
  /// @}
  /// \name OrtCustomOpDomain
  /// @{
  ORT_CLASS_RELEASE(CustomOpDomain);

  /// @}
  /// \name OrtTypeInfo
  /// @{

  /** \brief Get denotation from type information
   *
   * Augments ::OrtTypeInfo to return denotations on the type.
   *
   * This is used by WinML to determine if an input/output is intended to be an Image or a Tensor.
   *
   * \param[in] type_info
   * \param[out] denotation Pointer to the null terminated denotation string is written to this pointer. This pointer is valid until the object is destroyed or the name is changed, do not free.
   * \param[out] len Length in bytes of the string returned in `denotation`
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetDenotationFromTypeInfo, _In_ const OrtTypeInfo* type_info, _Out_ const char** const denotation,
                  _Out_ size_t* len);

  /** \brief Get detailed map information from an ::OrtTypeInfo
   *
   * This augments ::OrtTypeInfo to return an ::OrtMapTypeInfo when the type is a map.
   * The OrtMapTypeInfo has additional information about the map's key type and value type.
   *
   * This is used by WinML to support model reflection APIs.
   *
   * \param[out] type_info
   * \param[out] out A pointer to the ::OrtMapTypeInfo. Do not free this value. If type_info
   *             does not contain a map, this value will be set to nullptr.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CastTypeInfoToMapTypeInfo, _In_ const OrtTypeInfo* type_info,
                  _Outptr_result_maybenull_ const OrtMapTypeInfo** out);

  /** \brief Cast ::OrtTypeInfo to an ::OrtSequenceTypeInfo
   *
   * This api augments ::OrtTypeInfo to return an ::OrtSequenceTypeInfo when the type is a sequence.
   * The ::OrtSequenceTypeInfo has additional information about the sequence's element type.
   *
   * This is used by WinML to support model reflection APIs.
   *
   * \param[in] type_info
   * \param[out] out A pointer to the OrtSequenceTypeInfo. Do not free this value. If type_info
   *             doesn not contain a sequence, this value will be set to nullptr.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CastTypeInfoToSequenceTypeInfo, _In_ const OrtTypeInfo* type_info,
                  _Outptr_result_maybenull_ const OrtSequenceTypeInfo** out);

  /// @}
  /// \name OrtMapTypeInfo
  /// @{

  /** \brief Get key type from an ::OrtMapTypeInfo
   *
   * Key types are restricted to being scalar types.
   *
   * This is used by WinML to support model reflection APIs.
   *
   * \param[in] map_type_info
   * \param[out] out
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetMapKeyType, _In_ const OrtMapTypeInfo* map_type_info, _Out_ enum ONNXTensorElementDataType* out);

  /** \brief Get the value type from an ::OrtMapTypeInfo
   *
   * \param[in] map_type_info
   * \param[out] type_info A copy of the OrtTypeInfo for the map value type.
   *                       The user must free this value with ReleaseTypeInfo.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetMapValueType, _In_ const OrtMapTypeInfo* map_type_info, _Outptr_ OrtTypeInfo** type_info);

  /// @}
  /// \name OrtSequenceTypeInfo
  /// @{

  /** \brief Get element type from an ::OrtSequenceTypeInfo
   *
   * This is used by WinML to support model reflection APIs.
   *
   * \param[in] sequence_type_info
   * \param[out] type_info A copy of the OrtTypeInfo for the sequence element type.
   *                       The user must free this value with ReleaseTypeInfo.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetSequenceElementType, _In_ const OrtSequenceTypeInfo* sequence_type_info,
                  _Outptr_ OrtTypeInfo** type_info);

  /// @}
  /// \name OrtMapTypeInfo
  /// @{
  ORT_CLASS_RELEASE(MapTypeInfo);
  /// @}
  /// \name OrtSequenceTypeInfo
  /// @{
  ORT_CLASS_RELEASE(SequenceTypeInfo);

  /// @}
  /// \name OrtSession
  /// @{

  /** \brief End profiling and return filename of the profile data
   *
   * Profiling is turned on through OrtApi::EnableProfiling
   *
   * \param[in] session
   * \param[in] allocator
   * \param[out] out Null terminated string of the filename, allocated using `allocator`. Must be freed using `allocator`
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SessionEndProfiling, _In_ OrtSession* session, _Inout_ OrtAllocator* allocator, _Outptr_ char** out);

  /** \brief Get ::OrtModelMetadata from an ::OrtSession
   *
   * \param[in] session
   * \param[out] out Newly created ::OrtModelMetadata. Must be freed using OrtApi::ReleaseModelMetadata
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SessionGetModelMetadata, _In_ const OrtSession* session, _Outptr_ OrtModelMetadata** out);

  /// @}
  /// \name OrtModelMetadata
  /// @{

  /** \brief Get `producer name` from an ::OrtModelMetadata
   *
   * \param[in] model_metadata
   * \param[in] allocator
   * \param[out] value Set to a null terminated string allocated using `allocator`. Must be freed using `allocator`
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(ModelMetadataGetProducerName, _In_ const OrtModelMetadata* model_metadata,
                  _Inout_ OrtAllocator* allocator, _Outptr_ char** value);

  /** \brief Get `graph name` from an ::OrtModelMetadata
   *
   * \param[in] model_metadata
   * \param[in] allocator
   * \param[out] value Set to a null terminated string allocated using `allocator`. Must be freed using `allocator`
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(ModelMetadataGetGraphName, _In_ const OrtModelMetadata* model_metadata,
                  _Inout_ OrtAllocator* allocator, _Outptr_ char** value);

  /** \brief Get `domain` from an ::OrtModelMetadata
   *
   * \param[in] model_metadata
   * \param[in] allocator
   * \param[out] value Set to a null terminated string allocated using `allocator`. Must be freed using `allocator`
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(ModelMetadataGetDomain, _In_ const OrtModelMetadata* model_metadata, _Inout_ OrtAllocator* allocator,
                  _Outptr_ char** value);

  /** \brief Get `description` from an ::OrtModelMetadata
   *
   * \param[in] model_metadata
   * \param[in] allocator
   * \param[out] value Set to a null terminated string allocated using `allocator`. Must be freed using `allocator`
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(ModelMetadataGetDescription, _In_ const OrtModelMetadata* model_metadata,
                  _Inout_ OrtAllocator* allocator, _Outptr_ char** value);

  /** \brief Return data for a key in the custom metadata map in an ::OrtModelMetadata
   *
   * \param[in] model_metadata
   * \param[in] allocator
   * \param[in] key Null terminated string
   * \param[out] value Set to a null terminated string allocated using `allocator`. Must be freed using `allocator`
   * `value` will be set to nullptr if the given key is not found in the custom metadata map.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(ModelMetadataLookupCustomMetadataMap, _In_ const OrtModelMetadata* model_metadata,
                  _Inout_ OrtAllocator* allocator, _In_ const char* key, _Outptr_result_maybenull_ char** value);

  /** \brief Get version number from an ::OrtModelMetadata
   *
   * \param[in] model_metadata
   * \param[out] value Set to the version number
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(ModelMetadataGetVersion, _In_ const OrtModelMetadata* model_metadata, _Out_ int64_t* value);

  ORT_CLASS_RELEASE(ModelMetadata);

  /// @}
  /// \name OrtEnv
  /// @{

  /** \brief Create an OrtEnv
   *
   * Create an environment with global threadpools that will be shared across sessions.
   * Use this in conjunction with OrtApi::DisablePerSessionThreads or else the session will use
   * its own thread pools.
   *
   * \param[in] log_severity_level The log severity level.
   * \param[in] logid The log identifier.
   * \param[in] tp_options
   * \param[out] out Returned newly created OrtEnv. Must be freed with OrtApi::ReleaseEnv
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateEnvWithGlobalThreadPools, OrtLoggingLevel log_severity_level, _In_ const char* logid,
                  _In_ const OrtThreadingOptions* tp_options, _Outptr_ OrtEnv** out);

  /// @}
  /// \name OrtSessionOptions
  /// @{

  /** \brief Use global thread pool on a session
   *
   * Disable using per session thread pool and use the shared global threadpool.
   * This should be used in conjunction with OrtApi::CreateEnvWithGlobalThreadPools.
   *
   * \param[in] options
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(DisablePerSessionThreads, _Inout_ OrtSessionOptions* options);

  /// @}
  /// \name OrtThreadingOptions
  /// @{

  /** \brief Create an ::OrtThreadingOptions
   *
   * \param[out] out Newly created ::OrtThreadingOptions. Must be freed with OrtApi::ReleaseThreadingOptions
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateThreadingOptions, _Outptr_ OrtThreadingOptions** out);

  ORT_CLASS_RELEASE(ThreadingOptions);

  /// @}
  /// \name OrtModelMetadata
  /// @{

  /**
   *
   * \param[in] model_metadata
   * \param[in] allocator
   * \param[out] keys Array of null terminated strings (array count = num_keys) allocated using `allocator`.
   *  The strings and the pointer array must be freed using `allocator`
   *  `keys` will be set to nullptr if the custom metadata map is empty.
   * \param[out] num_keys Set to the number of elements in the `keys` array
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(ModelMetadataGetCustomMetadataMapKeys, _In_ const OrtModelMetadata* model_metadata,
                  _Inout_ OrtAllocator* allocator, _Outptr_result_buffer_maybenull_(*num_keys) char*** keys, _Out_ int64_t* num_keys);

  /// @}
  /// \name OrtSessionOptions
  /// @{

  /**
   *
   * Override symbolic dimensions (by specific name strings) with actual values
   * if known at session initialization time to enable optimizations that can
   * take advantage of fixed values (such as memory planning, etc)
   *
   */
  ORT_API2_STATUS(AddFreeDimensionOverrideByName,
                  _Inout_ OrtSessionOptions* options, _In_ const char* dim_name,
                  _In_ int64_t dim_value);

  /// @}
  /// \name Misc
  /// @{

  /** \brief Get the names of all available providers
   *
   * \note The providers in the list are not guaranteed to be usable. They may fail to load due to missing system dependencies.
   *    For example, if the CUDA/cuDNN libraries are not installed, the CUDA provider will report an error when it is added to the session options.
   *
   * \param[out] out_ptr Set to a pointer to an array of null terminated strings of the available providers. The entries and the
   *    array itself must be freed using OrtApi::ReleaseAvailableProviders
   * \param[out] provider_length Set to the number of entries in the `out_ptr` array
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetAvailableProviders, _Outptr_ char*** out_ptr, _Out_ int* provider_length);

  /** \brief Release data from OrtApi::GetAvailableProviders. This API will never fail
   * so you can rely on it in a noexcept code.
   *
   * \param[in] ptr The `out_ptr` result from OrtApi::GetAvailableProviders.
   * \param[in] providers_length The `provider_length` result from OrtApi::GetAvailableProviders
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(ReleaseAvailableProviders, _In_ char** ptr,
                  _In_ int providers_length);

  /// @}
  /// \name OrtValue
  /// @{

  /** \brief Get the length of a single string in a string tensor
   *
   * \param[in] value A string tensor
   * \param[in] index Index of the string in the tensor
   * \param[out] out Set to number of bytes of the string element
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetStringTensorElementLength, _In_ const OrtValue* value, size_t index, _Out_ size_t* out);

  /** \brief Get a single string from a string tensor
   *
   * \param[in] value A string tensor
   * \param[in] s_len Number of bytes in the `s` buffer. Must match the value returned by OrtApi::GetStringTensorElementLength.
   * \param[in] index Index of the string in the tensor
   * \param[out] s The string element contents in UTF-8 encoding. The string is NOT null-terminated.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetStringTensorElement, _In_ const OrtValue* value, size_t s_len, size_t index, _Out_writes_bytes_all_(s_len) void* s);

  /** \brief Set a single string in a string tensor
   *
   * \param[in] value A string tensor
   * \param[in] s A null terminated UTF-8 encoded string
   * \param[in] index Index of the string in the tensor to set
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(FillStringTensorElement, _Inout_ OrtValue* value, _In_ const char* s, size_t index);

  /// @}
  /// \name OrtSessionOptions
  /// @{

  /** \brief Set a session configuration entry as a pair of strings
   *
   * If a configuration with same key exists, this will overwrite the configuration with the given config_value.
   *
   * The config_key and the format of config_value are defined in onnxruntime_session_options_config_keys.h
   *
   * \param[in] options
   * \param[in] config_key A null terminated string representation of the config key
   * \param[in] config_value A null terminated string representation of the config value
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(AddSessionConfigEntry, _Inout_ OrtSessionOptions* options,
                  _In_z_ const char* config_key, _In_z_ const char* config_value);

  /// @}
  /// \name OrtAllocator
  /// @{

  /** \brief Create an allocator for an ::OrtSession following an ::OrtMemoryInfo
   *
   * The allocator wraps the internal allocator from the OrtSession and becomes invalid when the session does.
   *
   * \param[in] session
   * \param[in] mem_info valid ::OrtMemoryInfo instance
   * \param[out] out Newly created ::OrtAllocator. Must be freed with OrtApi::ReleaseAllocator
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateAllocator, _In_ const OrtSession* session, _In_ const OrtMemoryInfo* mem_info,
                  _Outptr_ OrtAllocator** out);

  /** \brief Release an ::OrtAllocator obtained from OrtApi::CreateAllocator
   */
  ORT_CLASS_RELEASE(Allocator);

  /// @}
  /// \name OrtSession
  /// @{

  /** \brief Run a model using Io Bindings for the inputs & outputs
   *
   * \see OrtApi::Run
   *
   * \param[in] session
   * \param[in] run_options
   * \param[in] binding_ptr
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(RunWithBinding, _Inout_ OrtSession* session, _In_ const OrtRunOptions* run_options, _In_ const OrtIoBinding* binding_ptr);

  /** \brief Create an ::OrtIoBinding instance
   *
   * An IoBinding object allows one to bind pre-allocated ::OrtValue%s to input names.
   * Thus if you want to use a raw on device buffer as input or output you can avoid
   * extra copy during runtime.
   *
   * \param[in] session
   * \param[out] out Newly created ::OrtIoBinding. Must be freed with OrtApi::ReleaseIoBinding
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateIoBinding, _Inout_ OrtSession* session, _Outptr_ OrtIoBinding** out);

  /// @}
  /// \name OrtIoBinding
  /// @{

  /** \brief Release an ::OrtIoBinding obtained from OrtApi::CreateIoBinding
   */
  ORT_CLASS_RELEASE(IoBinding);

  /** \brief Bind an ::OrtValue to an ::OrtIoBinding input
   *
   * When using OrtApi::RunWithBinding this value is used for the named input
   *
   * \param[in] binding_ptr
   * \param[in] name Name for the model input
   * \param[in] val_ptr ::OrtValue of Tensor type.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(BindInput, _Inout_ OrtIoBinding* binding_ptr, _In_ const char* name, _In_ const OrtValue* val_ptr);

  /** \brief Bind an ::OrtValue to an ::OrtIoBinding output
   *
   * When using OrtApi::RunWithBinding this value is used for the named output
   *
   * \param[in] binding_ptr
   * \param[in] name Null terminated string of the model output name
   * \param[in] val_ptr ::OrtValue of Tensor type.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(BindOutput, _Inout_ OrtIoBinding* binding_ptr, _In_ const char* name, _In_ const OrtValue* val_ptr);

  /** \brief Bind an ::OrtIoBinding output to a device
   *
   * Binds the ::OrtValue to a device which is specified by ::OrtMemoryInfo.
   * You can either create an instance of ::OrtMemoryInfo with a device id or obtain one from the allocator that you have created/are using
   * This is useful when one or more outputs have dynamic shapes and, it is hard to pre-allocate and bind a chunk of
   * memory within ::OrtValue ahead of time.
   *
   * \see OrtApi::RunWithBinding
   *
   * \param[in] binding_ptr
   * \param[in] name Null terminated string of the device name
   * \param[in] mem_info_ptr
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(BindOutputToDevice, _Inout_ OrtIoBinding* binding_ptr, _In_ const char* name, _In_ const OrtMemoryInfo* mem_info_ptr);

  /** \brief Get the names of an ::OrtIoBinding's outputs
   *
   * Returns the names of the outputs in the order they were bound. This is useful after running the model
   * with bound outputs because the returned names are in order in which output ::OrtValue are returned. This is useful if
   * the order of outputs and their names is not known.
   *
   * \param[in] binding_ptr
   * \param[in] allocator Allocator used to allocate continuous buffers for output strings and lengths.
   * \param[out] buffer Returns an array of non-null terminated UTF-8 strings. The number of strings stored is returned in the count parameter.
   *   This buffer is allocated using `allocator` and must be freed using it.
   * \param[out] lengths Returns an array of `count` lengths of the strings returned in `buffer`
   *   This buffer is allocated using `allocator` and must be freed using it.
   * \param[out] count Number of strings returned. If `binding_ptr` has no bound outputs, zero is returned,
   *              no memory allocation is performed and buffer and lengths are set to nullptr.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetBoundOutputNames, _In_ const OrtIoBinding* binding_ptr, _In_ OrtAllocator* allocator,
                  _Out_ char** buffer, _Out_writes_all_(count) size_t** lengths, _Out_ size_t* count);

  /** \brief Get the output ::OrtValue objects from an ::OrtIoBinding
   *
   * Returns an array of pointers to individually allocated ::OrtValue%s that contain results of a model execution with OrtApi::RunWithBinding
   * The array contains the same number of ::OrtValue%s and they are in the same order as they were bound with OrtApi::BindOutput
   * or OrtApi::BindOutputToDevice.
   *
   * The returned ::OrtValue%s must be released using OrtApi::ReleaseValue after they are no longer needed.
   * The array is allocated using the specified instance of the allocator and must be freed using the same allocator after
   * all the ::OrtValue%s contained therein are individually released.
   *
   * \param[in] binding_ptr
   * \param[in] allocator Allocator used to allocate output array
   * \param[out] output Set to the allocated array of allocated ::OrtValue outputs. Set to nullptr if there are 0 outputs.
   * \param[out] output_count Set to number of ::OrtValue%s returned
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetBoundOutputValues, _In_ const OrtIoBinding* binding_ptr, _In_ OrtAllocator* allocator,
                  _Out_writes_all_(output_count) OrtValue*** output, _Out_ size_t* output_count);

  /** \brief Clears any previously set Inputs for an ::OrtIoBinding
   */
  void(ORT_API_CALL* ClearBoundInputs)(_Inout_ OrtIoBinding* binding_ptr) NO_EXCEPTION ORT_ALL_ARGS_NONNULL;

  /** \brief Clears any previously set Outputs for an ::OrtIoBinding
   */
  void(ORT_API_CALL* ClearBoundOutputs)(_Inout_ OrtIoBinding* binding_ptr) NO_EXCEPTION ORT_ALL_ARGS_NONNULL;

  /// @}
  /// \name OrtValue
  /// @{

  /** \brief Direct memory access to a specified tensor element
   *
   * For example, given a tensor with shape of [3,224,224], a pointer to the element at location [2,150,128] can be retrieved
   *
   * This function only works for numeric type tensors (No strings, etc).
   * This is a no-copy method whose returned pointer is valid until the passed in ::OrtValue is free'd.
   *
   * \param[in] value
   * \param[in] location_values Pointer to an array of index values that specify an element's location relative to its shape
   * \param[in] location_values_count Number of elements in location_values. Must match the number of elements in the tensor's shape.
   * \param[out] out Set to a pointer to the element specified
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(TensorAt, _Inout_ OrtValue* value, const int64_t* location_values, size_t location_values_count, _Outptr_ void** out);

  /// @}
  /// \name OrtEnv
  /// @{

  /** \brief Create an allocator and register it with the ::OrtEnv
   *
   * Enables sharing the allocator between multiple sessions that use the same env instance.
   * Lifetime of the created allocator will be valid for the duration of the environment.
   * Returns an error if an allocator with the same ::OrtMemoryInfo is already registered.
   *
   * See https://onnxruntime.ai/docs/get-started/with-c.html for details.
   *
   * \param[in] env ::OrtEnv instance
   * \param[in] mem_info
   * \param[in] arena_cfg Pass nullptr for defaults
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateAndRegisterAllocator, _Inout_ OrtEnv* env, _In_ const OrtMemoryInfo* mem_info,
                  _In_ const OrtArenaCfg* arena_cfg);

  /** \brief Set language projection
   *
   * Set the language projection for collecting telemetry data when Env is created.
   *
   * The default is ORT_PROJECTION_C, which means it will classify the language not in the list to C also.
   *
   * \param[in] ort_env
   * \param[in] projection
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SetLanguageProjection, _In_ const OrtEnv* ort_env, _In_ OrtLanguageProjection projection);

  /// @}
  /// \name OrtSession
  /// @{

  /** \brief Return the time that profiling was started
   *
   * \note The timer precision varies per platform. On Windows and MacOS, the precision will be ~100ns
   *
   * \param[in] session
   * \param[out] out nanoseconds of profiling's start time
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SessionGetProfilingStartTimeNs, _In_ const OrtSession* session, _Outptr_ uint64_t* out);

  /// @}
  /// \name OrtThreadingOptions
  /// @{

  /** \brief Set global intra-op thread count
   *
   * This configures the global thread pool options to be used in the call to OrtApi::CreateEnvWithGlobalThreadPools
   *
   * \param[in] tp_options
   * \param[in] intra_op_num_threads Number of threads, special values:<br>
   *    0 = Use default thread count<br>
   *    1 = The invoking thread will be used; no threads will be created in the thread pool.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SetGlobalIntraOpNumThreads, _Inout_ OrtThreadingOptions* tp_options, int intra_op_num_threads);

  /** \brief Set global inter-op thread count
   *
   * This configures the global thread pool options to be used in the call to OrtApi::CreateEnvWithGlobalThreadPools
   *
   * \param[in] tp_options
   * \param[in] inter_op_num_threads Number of threads, special values:<br>
   *    0 = Use default thread count<br>
   *    1 = The invoking thread will be used; no threads will be created in the thread pool.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SetGlobalInterOpNumThreads, _Inout_ OrtThreadingOptions* tp_options, int inter_op_num_threads);

  /** \brief Set global spin control options
   *
   * This will configure the global thread pool options to be used in the call to OrtApi::CreateEnvWithGlobalThreadPools.
   * Allow spinning of thread pools when their queues are empty. This will set the value for both
   * inter_op and intra_op threadpools.
   *
   * \param[in] tp_options
   * \param[in] allow_spinning Valid values are 0 or 1.<br>
   *   0 = It won't spin (recommended if CPU usage is high)<br>
   *   1 = Threadpool will spin to wait for queue to become non-empty
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SetGlobalSpinControl, _Inout_ OrtThreadingOptions* tp_options, int allow_spinning);

  /// @}
  /// \name OrtSessionOptions
  /// @{

  /** \brief Add a pre-allocated initializer to a session
   *
   * If a model contains an initializer with a name that is same as the name passed to this call,
   * ORT will use this initializer instance instead of deserializing one from the model file. This
   * is useful when you want to share the same initializer across sessions.
   *
   * \param[in] options
   * \param[in] name Null terminated string of the initializer name
   * \param[in] val ::OrtValue containing the initializer. Its lifetime and the underlying initializer buffer must be
   *   managed by the user (created using the OrtApi::CreateTensorWithDataAsOrtValue) and it must outlive the session object
   *   to which it is added.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(AddInitializer, _Inout_ OrtSessionOptions* options, _In_z_ const char* name,
                  _In_ const OrtValue* val);

  /// @}
  /// \name OrtEnv
  /// @{

  /**
   * Create a custom environment with global threadpools and logger that will be shared across sessions.
   * Use this in conjunction with OrtApi::DisablePerSessionThreads or else the session will use
   * its own thread pools.
   *
   * \param[in] logging_function A pointer to a logging function.
   * \param[in] logger_param A pointer to arbitrary data passed as the ::OrtLoggingFunction `param` parameter to
   *                         `logging_function`.
   * \param[in] log_severity_level The log severity level.
   * \param[in] logid The log identifier.
   * \param[in] tp_options
   * \param[out] out Newly created OrtEnv. Must be freed with OrtApi::ReleaseEnv
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateEnvWithCustomLoggerAndGlobalThreadPools, OrtLoggingFunction logging_function, _In_opt_ void* logger_param, OrtLoggingLevel log_severity_level,
                  _In_ const char* logid, _In_ const struct OrtThreadingOptions* tp_options, _Outptr_ OrtEnv** out);

  /// @}
  /// \name OrtSessionOptions
  /// @{

  /** \brief Append CUDA provider to session options
   *
   * If CUDA is not available (due to a non CUDA enabled build, or if CUDA is not installed on the system), this function will return failure.
   *
   * \param[in] options
   * \param[in] cuda_options
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SessionOptionsAppendExecutionProvider_CUDA,
                  _In_ OrtSessionOptions* options, _In_ const OrtCUDAProviderOptions* cuda_options);

  /** \brief Append ROCM execution provider to the session options
   *
   * If ROCM is not available (due to a non ROCM enabled build, or if ROCM is not installed on the system), this function will return failure.
   *
   * \param[in] options
   * \param[in] rocm_options
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SessionOptionsAppendExecutionProvider_ROCM,
                  _In_ OrtSessionOptions* options, _In_ const OrtROCMProviderOptions* rocm_options);

  /** \brief Append OpenVINO execution provider to the session options
   *
   * If OpenVINO is not available (due to a non OpenVINO enabled build, or if OpenVINO is not installed on the system), this function will fail.
   *
   * \param[in] options
   * \param[in] provider_options
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SessionOptionsAppendExecutionProvider_OpenVINO,
                  _In_ OrtSessionOptions* options, _In_ const OrtOpenVINOProviderOptions* provider_options);

  /// @}
  /// \name OrtThreadingOptions
  /// @{

  /** \brief Set threading flush-to-zero and denormal-as-zero
   *
   * Sets global thread pool options to be used in the call to OrtApi::CreateEnvWithGlobalThreadPools.
   * Flush-to-zero and denormal-as-zero are applied to threads in both intra and inter global thread pool.
   * \note This option is not needed if the models used have no denormals. Having no denormals is recommended as this option may hurt model accuracy.
   *
   * \param[in] tp_options
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SetGlobalDenormalAsZero, _Inout_ OrtThreadingOptions* tp_options);

  /// @}
  /// \name OrtArenaCfg
  /// @{

  /** \deprecated Use OrtApi::CreateArenaCfgV2
   *
   * This will create the configuration of an arena that can eventually be used to define an arena based allocator's behavior
   *
   * \param[in] max_mem Use 0 to allow ORT to choose the default
   * \param[in] arena_extend_strategy Use -1 to allow ORT to choose the default, 0 = kNextPowerOfTwo, 1 = kSameAsRequested
   * \param[in] initial_chunk_size_bytes Use -1 to allow ORT to choose the default
   * \param[in] max_dead_bytes_per_chunk Use -1 to allow ORT to choose the default
   * \param[in] out A pointer to an OrtArenaCfg instance
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateArenaCfg, _In_ size_t max_mem, int arena_extend_strategy, int initial_chunk_size_bytes,
                  int max_dead_bytes_per_chunk, _Outptr_ OrtArenaCfg** out);

  ORT_CLASS_RELEASE(ArenaCfg);

  /// @}
  /// \name OrtModelMetadata
  /// @{

  /**
   * Use this to obtain the description of the graph present in the model
   * (doc_string field of the GraphProto message within the ModelProto message).
   * If it doesn't exist, an empty string will be returned.
   *
   * \param[in] model_metadata An instance of ::OrtModelMetadata
   * \param[in] allocator Allocator used to allocate the string that will be returned back
   * \param[out] value Set to a null terminated string allocated using `allocator`.  The caller is responsible for freeing it using `allocator`
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(ModelMetadataGetGraphDescription, _In_ const OrtModelMetadata* model_metadata,
                  _Inout_ OrtAllocator* allocator, _Outptr_ char** value);

  /// @}
  /// \name OrtSessionOptions
  /// @{

  /** \brief Append TensorRT provider to session options
   *
   * If TensorRT is not available (due to a non TensorRT enabled build, or if TensorRT is not installed on the system), this function will return failure.
   *
   * \param[in] options
   * \param[in] tensorrt_options
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SessionOptionsAppendExecutionProvider_TensorRT,
                  _In_ OrtSessionOptions* options, _In_ const OrtTensorRTProviderOptions* tensorrt_options);

  /// @}
  /// \name Misc
  /// @{

  /** \brief Set current GPU device ID
   *
   * Set the current device id of the GPU execution provider (CUDA/tensorrt/rocm). The device id should be less
   * than the total number of devices available. This is only useful when multiple-GPUs are installed and it is
   * required to restrict execution to a single GPU.
   *
   * \param[in] device_id
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SetCurrentGpuDeviceId, _In_ int device_id);

  /** \brief Get current GPU device ID
   *
   * Get the current device id of the GPU execution provider (CUDA/tensorrt/rocm).
   *
   * \see OrtApi::SetCurrentGpuDeviceId
   *
   * \param[out] device_id
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetCurrentGpuDeviceId, _In_ int* device_id);

  /// @}
  /// \name OrtKernelInfo
  /// Custom operator APIs.
  /// @{

  /** \brief Fetch an array of int64_t values stored as an attribute in the graph node
   *
   *
   * If `out` is nullptr, the value of `size` is set to the true size of the attribute
   * array's size, and a success status is returned.
   *
   * If the `size` parameter is greater than or equal to the actual attribute array's size,
   * the value of `size` is set to the true size of the attribute array's size,
   * the provided memory is filled with the attribute's contents,
   * and a success status is returned.
   *
   * If the `size` parameter is less than the actual attribute array's size and `out`
   * is not nullptr, the value of `size` is set to the true size of the attribute array's size
   * and a failure status is returned.)
   *
   * \param[in] info instance
   * \param[in] name name of the attribute to be parsed
   * \param[out] out pointer to memory where the attribute's contents are to be stored
   * \param[in, out] size actual size of attribute array
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(KernelInfoGetAttributeArray_float, _In_ const OrtKernelInfo* info, _In_ const char* name,
                  _Out_ float* out, _Inout_ size_t* size);

  /** \brief Fetch an array of int64_t values stored as an attribute in the graph node
   *
   * If `out` is nullptr, the value of `size` is set to the true size of the attribute
   * array's size, and a success status is returned.
   *
   * If the `size` parameter is greater than or equal to the actual attribute array's size,
   * the value of `size` is set to the true size of the attribute array's size,
   * the provided memory is filled with the attribute's contents,
   * and a success status is returned.
   *
   * If the `size` parameter is less than the actual attribute array's size and `out`
   * is not nullptr, the value of `size` is set to the true size of the attribute array's size
   * and a failure status is returned.)
   *
   * \param[in] info instance
   * \param[in] name name of the attribute to be parsed
   * \param[out] out pointer to memory where the attribute's contents are to be stored
   * \param[in, out] size actual size of attribute array
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(KernelInfoGetAttributeArray_int64, _In_ const OrtKernelInfo* info, _In_ const char* name,
                  _Out_ int64_t* out, _Inout_ size_t* size);

  /// @}
  /// \name OrtArenaCfg
  /// @{

  /** \brief Create an ::OrtArenaCfg
   *
   * Create the configuration of an arena that can eventually be used to define an arena based allocator's behavior.
   *
   * Supported keys are (See https://onnxruntime.ai/docs/get-started/with-c.html for details on what the
   * following parameters mean and how to choose these values.):
   * "max_mem": Maximum memory that can be allocated by the arena based allocator.
   *  Use 0 for ORT to pick the best value. Default is 0.
   * "arena_extend_strategy": 0 = kNextPowerOfTwo, 1 = kSameAsRequested.
   *  Use -1 to allow ORT to choose the default.
   * "initial_chunk_size_bytes": (Possible) Size of the first allocation in the arena.
   *  Only relevant if arena strategy is `kNextPowerOfTwo`. Use -1 to allow ORT to choose the default.
   *  Ultimately, the first allocation size is determined by the allocation memory request.
   * "max_dead_bytes_per_chunk": Threshold of unused memory in an allocated chunk of arena memory after
   *  crossing which the current chunk is chunked into 2.
   * "initial_growth_chunk_size_bytes": (Possible) Size of the second allocation in the arena.
   *  Only relevant if arena strategy is `kNextPowerOfTwo`. Use -1 to allow ORT to choose the default.
   * "max_power_of_two_extend_bytes": The maximum extend size if arena strategy is `kNextPowerOfTwo`.
   *  It is not an allocation limit, it is only a limit for extension when requested byte is less than the limit.
   *  When requested bytes is more than the limit, allocator will still return as requested.
   *  Use -1 to allow ORT to choose the default 1GB for max_power_of_two_extend_bytes.
   *  Ultimately, the allocation size is determined by the allocation memory request.
   *  Further allocation sizes are governed by the arena extend strategy.
   *
   * \param[in] arena_config_keys Keys to configure the arena
   * \param[in] arena_config_values Values to configure the arena
   * \param[in] num_keys Number of keys in `arena_config_keys` and `arena_config_values`
   * \param[out] out Newly created ::OrtArenaCfg. Must be freed with OrtApi::ReleaseArenaCfg
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateArenaCfgV2, _In_reads_(num_keys) const char* const* arena_config_keys,
                  _In_reads_(num_keys) const size_t* arena_config_values, _In_ size_t num_keys,
                  _Outptr_ OrtArenaCfg** out);

  /// @}
  /// \name OrtRunOptions
  /// @{

  /** \brief Set a single run configuration entry as a pair of strings
   *
   * If a configuration with same key exists, this will overwrite the configuration with the given config_value
   *
   * The config_key and the format of config_value are defined in onnxruntime_run_options_config_keys.h
   *
   * \param[in] options
   * \param[in] config_key A null terminated string representation of the config key
   * \param[in] config_value  A null terminated string representation of the config value
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(AddRunConfigEntry, _Inout_ OrtRunOptions* options,
                  _In_z_ const char* config_key, _In_z_ const char* config_value);

  /// @}
  /// \name OrtPrepackedWeightsContainer
  /// @{

  /** \brief Create an ::OrtPrepackedWeightsContainer
   *
   * This container will hold pre-packed buffers of shared initializers for sharing between sessions
   * (i.e.) if there are shared initializers that can be shared between sessions, the pre-packed buffers
   * of these (if any) may possibly be shared to provide memory footprint savings. Pass this container
   * to sessions that you would like to share pre-packed buffers of shared initializers at session
   * creation time.
   *
   *  \param[out] out Newly created ::OrtPrepackedWeightsContainer. Must be freed with OrtApi::ReleasePrepackedWeightsContainer
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreatePrepackedWeightsContainer, _Outptr_ OrtPrepackedWeightsContainer** out);

  /** \brief Release OrtPrepackedWeightsContainer instance
   *
   * \note instance must not be released until the sessions using it are released
   */
  ORT_CLASS_RELEASE(PrepackedWeightsContainer);

  /// @}
  /// \name OrtSession
  /// @{

  /** \brief Create session with prepacked weights container
   *
   * Same functionality offered by OrtApi::CreateSession except that a container that contains
   * pre-packed weights' buffers is written into/read from by the created session.
   * This is useful when used in conjunction with OrtApi::AddInitializer which injects
   * shared initializer info into sessions. Wherever possible, the pre-packed versions of these
   * shared initializers are cached in this container so that multiple sessions can just re-use
   * these instead of duplicating these in memory.
   *
   * \param[in] env OrtEnv instance instance
   * \param[in] model_path Null terminated string of the path (wchar on Windows, char otherwise)
   * \param[in] options
   * \param[in] prepacked_weights_container
   * \param[out] out Newly created ::OrtSession. Must be freed with OrtApi::ReleaseSession
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateSessionWithPrepackedWeightsContainer, _In_ const OrtEnv* env, _In_ const ORTCHAR_T* model_path,
                  _In_ const OrtSessionOptions* options,
                  _Inout_ OrtPrepackedWeightsContainer* prepacked_weights_container,
                  _Outptr_ OrtSession** out);

  /** \brief Create session from memory with prepacked weights container
   *
   * Same functionality offered by OrtApi::CreateSessionFromArray except that a container that contains
   * pre-packed weights' buffers is written into/read from by the created session.
   * This is useful when used in conjunction with OrtApi::AddInitializer which injects
   * shared initializer info into sessions. Wherever possible, the pre-packed versions of these
   * shared initializers are cached in this container so that multiple sessions can just re-use
   * these instead of duplicating these in memory.
   *
   * \param[in] env
   * \param[in] model_data Array of bytes holding the model
   * \param[in] model_data_length Number of bytes in `model_data_model`
   * \param[in] options
   * \param[in] prepacked_weights_container
   * \param[out] out Newly created ::OrtSession. Must be freed with OrtApi::ReleaseSession
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateSessionFromArrayWithPrepackedWeightsContainer, _In_ const OrtEnv* env,
                  _In_ const void* model_data, size_t model_data_length,
                  _In_ const OrtSessionOptions* options,
                  _Inout_ OrtPrepackedWeightsContainer* prepacked_weights_container,
                  _Outptr_ OrtSession** out);

  /// @}
  /// \name OrtSessionOptions
  /// @{

  /** \brief Append TensorRT execution provider to the session options
   *
   * If TensorRT is not available (due to a non TensorRT enabled build), this function will return failure.
   *
   * This is slightly different from OrtApi::SessionOptionsAppendExecutionProvider_TensorRT, it takes an
   * ::OrtTensorRTProviderOptions which is publicly defined. This takes an opaque ::OrtTensorRTProviderOptionsV2
   * which must be created with OrtApi::CreateTensorRTProviderOptions.
   *
   * For OrtApi::SessionOptionsAppendExecutionProvider_TensorRT, the user needs to instantiate ::OrtTensorRTProviderOptions
   * as well as allocate/release buffers for some members of ::OrtTensorRTProviderOptions.
   * Here, OrtApi::CreateTensorRTProviderOptions and Ortapi::ReleaseTensorRTProviderOptions will do the memory management for you.
   *
   * \param[in] options
   * \param[in] tensorrt_options
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SessionOptionsAppendExecutionProvider_TensorRT_V2,
                  _In_ OrtSessionOptions* options, _In_ const OrtTensorRTProviderOptionsV2* tensorrt_options);

  /// @}
  /// \name OrtTensorRTProviderOptionsV2
  /// @{

  /** \brief Create an OrtTensorRTProviderOptionsV2
   *
   * \param[out] out Newly created ::OrtTensorRTProviderOptionsV2. Must be released with OrtApi::ReleaseTensorRTProviderOptions
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateTensorRTProviderOptions, _Outptr_ OrtTensorRTProviderOptionsV2** out);

  /** \brief Set options in a TensorRT Execution Provider.
   *
   * Please refer to https://onnxruntime.ai/docs/execution-providers/TensorRT-ExecutionProvider.html#cc
   * to know the available keys and values. Key should be in null terminated string format of the member of ::OrtTensorRTProviderOptionsV2
   * and value should be its related range. Recreates the options and only sets the supplied values.
   *
   * For example, key="trt_max_workspace_size" and value="2147483648"
   *
   * \param[in] tensorrt_options
   * \param[in] provider_options_keys Array of UTF-8 null-terminated string for provider options keys
   * \param[in] provider_options_values Array of UTF-8 null-terminated string for provider options values
   * \param[in] num_keys Number of elements in the `provider_option_keys` and `provider_options_values` arrays
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(UpdateTensorRTProviderOptions, _Inout_ OrtTensorRTProviderOptionsV2* tensorrt_options,
                  _In_reads_(num_keys) const char* const* provider_options_keys,
                  _In_reads_(num_keys) const char* const* provider_options_values,
                  _In_ size_t num_keys);

  /** \brief Get serialized TensorRT provider options string.
   *
   * For example, "trt_max_workspace_size=2147483648;trt_max_partition_iterations=10;trt_int8_enable=1;......"
   *
   * \param tensorrt_options - OrtTensorRTProviderOptionsV2 instance
   * \param allocator - a ptr to an instance of OrtAllocator obtained with OrtApi::CreateAllocator or OrtApi::GetAllocatorWithDefaultOptions
   *                      the specified allocator will be used to allocate continuous buffers for output strings and lengths.
   * \param ptr - is a UTF-8 null terminated string allocated using 'allocator'. The caller is responsible for using the same allocator to free it.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetTensorRTProviderOptionsAsString, _In_ const OrtTensorRTProviderOptionsV2* tensorrt_options, _Inout_ OrtAllocator* allocator, _Outptr_ char** ptr);

  /** \brief Release an ::OrtTensorRTProviderOptionsV2
   *
   * \note This is an exception in the naming convention of other Release* functions, as the name of the method does not have the V2 suffix, but the type does
   */
  void(ORT_API_CALL* ReleaseTensorRTProviderOptions)(_Frees_ptr_opt_ OrtTensorRTProviderOptionsV2* input);

  /// @}
  /// \name OrtSessionOptions
  /// @{

  /** \brief Enable custom operators
   *
   * See onnxruntime-extensions: https://github.com/microsoft/onnxruntime-extensions.git
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(EnableOrtCustomOps, _Inout_ OrtSessionOptions* options);

  /// @}
  /// \name OrtAllocator
  /// @{

  /** \brief Register a custom allocator
   *
   * Enables sharing between multiple sessions that use the same env instance.
   * Returns an error if an allocator with the same ::OrtMemoryInfo is already registered.
   *
   * The behavior of this is exactly the same as OrtApi::CreateAndRegisterAllocator except
   * instead of ORT creating an allocator based on provided info, in this case
   * ORT uses the user-provided custom allocator.
   * See https://onnxruntime.ai/docs/get-started/with-c.html for details.
   *
   * \param[in] env
   * \param[in] allocator User provided allocator
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(RegisterAllocator, _Inout_ OrtEnv* env, _In_ OrtAllocator* allocator);

  /** \brief Unregister a custom allocator
   *
   * It is an error if you provide an ::OrtMemoryInfo not corresponding to any
   * registered allocators for sharing.
   *
   * \param[in] env
   * \param[in] mem_info
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(UnregisterAllocator, _Inout_ OrtEnv* env,
                  _In_ const OrtMemoryInfo* mem_info);

  /// @}
  /// \name OrtValue
  /// @{

  /** \brief Sets *out to 1 iff an ::OrtValue is a SparseTensor, and 0 otherwise
   *
   * \param[in] value existing ::OrtValue
   * \param[out] out unless an error occurs, contains 1 iff the value contains an instance
   *  of sparse tensor or 0 otherwise.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(IsSparseTensor, _In_ const OrtValue* value, _Out_ int* out);

  /** \brief Create an ::OrtValue with a sparse tensor that is empty.
   *
   * Use FillSparseTensor<Format>() functions to populate sparse tensor with non-zero values and
   * format specific indices data.
   * Use ReleaseValue to destroy the sparse tensor, this will also release the buffer inside the output value
   * if any was allocated.
   * \param[in,out] allocator allocator to use when performing an allocation. Allocation will be performed
   *   by FillSparseTensor<Format>() APIs. The lifespan of the allocator instance must eclipse the lifespan
   *   this sparse tensor instance as the same allocator will be used to free memory.
   * \param[in] dense_shape shape of the original dense tensor
   * \param[in] dense_shape_len number of shape dimensions being passed
   * \param[in] type must be one of TENSOR_ELEMENT_DATA_TYPE_xxxx
   * \param[out] out Should be freed by calling ReleaseValue
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateSparseTensorAsOrtValue, _Inout_ OrtAllocator* allocator, _In_ const int64_t* dense_shape,
                  size_t dense_shape_len, ONNXTensorElementDataType type, _Outptr_ OrtValue** out);

  /**
   * This fills populates an empty tensor that was created using OrtApi::CreateSparseTensorAsOrtValue.
   * This will allocate required memory and copy the supplied NNZ values and COO indices into that memory allocation.
   * Memory allocation is performed using the allocator that was specified with OrtApi::CreateSparseTensorAsOrtValue.
   *
   * \param[in,out] ort_value ::OrtValue to populate with data
   * \param[in] data_mem_info serves to identify the location of the data to be copied. If the allocator specified
   *  at the creation time has memory info that is not the same as mem_info argument to this function a X-device copy will be performed.
   *  String data is assumed to be on CPU and will only be copied into a CPU allocated buffer.
   * \param[in] values_shape pointer to values shape array
   * \param[in] values_shape_len length of the values_shape
   * \param[in] values pointer to an array of values. For strings, pass const char**.
   * \param[in] indices_data pointer to a location of COO indices
   * \param[in] indices_num number of COO indices
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(FillSparseTensorCoo, _Inout_ OrtValue* ort_value, _In_ const OrtMemoryInfo* data_mem_info,
                  _In_ const int64_t* values_shape, size_t values_shape_len, _In_ const void* values,
                  _In_ const int64_t* indices_data, size_t indices_num);

  /**
   * This fills populates an empty tensor that was created using OrtApi::CreateSparseTensorAsOrtValue.
   * This will allocate required memory and copy the supplied NNZ values and CSR indices into that memory allocation.
   * Memory allocation is performed using the allocator that was specified with OrtApi::CreateSparseTensorAsOrtValue.
   *
   * \param[in,out] ort_value ::OrtValue to populate with data
   * \param[in] data_mem_info serves to identify the location of the data to be copied. If the allocator specified
   *  at the creation time has memory info that is not the same as mem_info argument to this function a X-device copy will be performed.
   *  String data is assumed to be on CPU and will only be copied into a CPU allocated buffer.
   * \param[in] values_shape pointer to values shape array
   * \param[in] values_shape_len length of the values_shape
   * \param[in] values - pointer to an array of values. For strings, pass const char**.
   * \param[in] inner_indices_data pointer to a location of CSR inner indices
   * \param[in] inner_indices_num number of CSR inner indices
   * \param[in] outer_indices_data pointer to a location of CSR outer indices
   * \param[in] outer_indices_num number of CSR outer indices
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(FillSparseTensorCsr, _Inout_ OrtValue* ort_value, _In_ const OrtMemoryInfo* data_mem_info,
                  _In_ const int64_t* values_shape, size_t values_shape_len, _In_ const void* values,
                  _In_ const int64_t* inner_indices_data, size_t inner_indices_num,
                  _In_ const int64_t* outer_indices_data, size_t outer_indices_num);

  /**
   * This fills populates an empty tensor that was created using OrtApi::CreateSparseTensorAsOrtValue.
   * This will allocate required memory and copy the supplied NNZ values and BlockSparse indices into that memory allocation.
   * Memory allocation is performed using the allocator that was specified with OrtApi::CreateSparseTensorAsOrtValue.
   *
   * \param[in,out] ort_value ::OrtValue to populate with data
   * \param[in] data_mem_info serves to identify the location of the data to be copied. If the allocator specified
   *  at the creation time has memory info that is not the same as mem_info argument to this function a X-device copy will be performed.
   *  String data is assumed to be on CPU and will only be copied into a CPU allocated buffer.
   * \param[in] values_shape
   * \param[in] values_shape_len
   * \param[in] values structure with values information
   * \param[in] indices_shape_data pointer to a location of indices shape
   * \param[in] indices_shape_len length of the block sparse indices shape
   * \param[in] indices_data pointer to a location of indices data. Shape will determine the length of the indices data.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(FillSparseTensorBlockSparse, _Inout_ OrtValue* ort_value, _In_ const OrtMemoryInfo* data_mem_info,
                  _In_ const int64_t* values_shape, size_t values_shape_len, _In_ const void* values,
                  _In_ const int64_t* indices_shape_data, size_t indices_shape_len,
                  _In_ const int32_t* indices_data);

  /**
   * Create an ::OrtValue with a sparse tensor. This is the first step.
   * Next, use Use<Format>Indices() functions to supply sparse tensor with
   * format specific indices data and set its sparse format to a specific enum value.
   * This will not perform memory allocations. It will
   * use supplied user buffer which should outlive the created sparse tensor.
   * Use OrtApi::ReleaseValue to destroy the sparse tensor. It would not release the supplied values buffer.
   * This function can not be used to map strings from the user allocated memory. Strings must always be copied
   * and have UTF-8 encoding. Therefore, use OrtApi::CreateSparseTensorAsOrtValue above and then fill it with data
   * using appropriate Make*() function.
   *
   * \param[in] info memory info where sparse values reside.
   * \param[in,out] p_data pointer to a user allocated buffer with values. To create a full sparse tensor with no non-zero
   *   values, pass nullptr
   * \param[in] dense_shape shape of the original dense tensor
   * \param[in] dense_shape_len number of shape dimensions being passed
   * \param[in] values_shape shape of the values data. To create a fully sparse tensor with no non-zero values,
   *   pass {0} shape.
   * \param[in] values_shape_len number of values shape dimensions
   * \param[in] type must be one of TENSOR_ELEMENT_DATA_TYPE_xxxx
   * \param[out] out Should be freed by calling ReleaseValue
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(CreateSparseTensorWithValuesAsOrtValue, _In_ const OrtMemoryInfo* info, _Inout_ void* p_data,
                  _In_ const int64_t* dense_shape, size_t dense_shape_len,
                  _In_ const int64_t* values_shape, size_t values_shape_len,
                  ONNXTensorElementDataType type, _Outptr_ OrtValue** out);

  /**
   * This assigns Coo format indices to the SparseTensor that was created by
   * OrtApi::CreateSparseTensorWithValuesAsOrtValue above. It also sets OrtSparseFormat to
   * ORT_SPARSE_COO. This will not allocate any additional memory for data. The life span of
   * indices_data buffer should eclipse the life span of this ::OrtValue.
   *
   * \param[in,out] ort_value ::OrtValue instance constructed with OrtApi::CreateSparseTensorWithValuesAsOrtValue
   * \param[in,out] indices_data pointer to a user pre-allocated buffer or nullptr for fully sparse tensors.
   * \param[in] indices_num  number of COO indices. Should either be 0 for fully sparse tensors, be equal
   *  to the number of nnz values specified to OrtApi::CreateSparseTensorWithValuesAsOrtValue for 1-D {nnz} indices or
   *  be twice as number of nnz values for a  2-D indices {nnz, 2}
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(UseCooIndices, _Inout_ OrtValue* ort_value, _Inout_ int64_t* indices_data, size_t indices_num);

  /**
   * The assigns CSR format indices to the SparseTensor that was created by
   * OrtApi::CreateSparseTensorWithValuesAsOrtValue above. It also sets OrtSparseFormat to
   * ORT_SPARSE_CSRC. This will not allocate any additional memory for data. The life spans of
   * inner_data and outer_data buffers should eclipse the life span of this ::OrtValue.
   *
   * \param[in,out] ort_value ::OrtValue instance constructed with OrtApi::CreateSparseTensorWithValuesAsOrtValue
   * \param[in,out] inner_data pointer to a user pre-allocated buffer or nullptr for fully sparse tensors.
   * \param[in] inner_num  number of inner CSR indices. Should either be 0 for fully sparse tensors or be equal
   * to the number of nnz values specified to OrtApi::CreateSparseTensorWithValuesAsOrtValue.
   * \param[in,out] outer_data pointer to user pre-allocated buffer or nullptr for fully sparse tensors.
   * \param[in] outer_num number of CSR outer indices. Should either be 0 for fully sparse tensors or
   * equal to rows + 1 of the dense shape.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(UseCsrIndices, _Inout_ OrtValue* ort_value, _Inout_ int64_t* inner_data, size_t inner_num,
                  _Inout_ int64_t* outer_data, size_t outer_num);

  /**
   * The assigns BlockSparse format indices to the SparseTensor that was created by
   * OrtApi::CreateSparseTensorWithValuesAsOrtValue above. It also sets OrtSparseFormat to
   * ORT_SPARSE_BLOCK_SPARSE. This will not allocate any additional memory for data. The life span of
   * indices_data buffer must eclipse the lifespan of this ::OrtValue.
   *
   * \param[in,out] ort_value OrtValue instance constructed with OrtApi::CreateSparseTensorWithValuesAsOrtValue
   * \param[in] indices_shape pointer to indices shape. Use {0} for fully sparse tensors
   * \param[in] indices_shape_len length of the indices shape
   * \param[in,out] indices_data pointer to user pre-allocated buffer or nullptr for fully sparse tensors.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(UseBlockSparseIndices, _Inout_ OrtValue* ort_value, const int64_t* indices_shape, size_t indices_shape_len, _Inout_ int32_t* indices_data);

  /** \brief Returns sparse tensor format enum iff a given ort value contains an instance of sparse tensor.
   *
   * \param[in] ort_value ::OrtValue that contains an instance of sparse tensor
   * \param[out] out pointer to out parameter
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetSparseTensorFormat, _In_ const OrtValue* ort_value, _Out_ enum OrtSparseFormat* out);

  /** \brief Returns data type and shape of sparse tensor values (nnz) iff ::OrtValue contains a SparseTensor.
   *
   * \param[in] ort_value An ::OrtValue that contains a fully constructed sparse tensor
   * \param[out] out Must be freed by OrtApi::ReleaseTensorTypeAndShapeInfo
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetSparseTensorValuesTypeAndShape, _In_ const OrtValue* ort_value, _Outptr_ OrtTensorTypeAndShapeInfo** out);

  /** \brief Returns numeric data for sparse tensor values (nnz). For string values use GetStringTensor*().
   *
   * \param[in] ort_value an instance of ::OrtValue containing sparse tensor
   * \param[out] out returns a pointer to values data.  Do not attempt to free this ptr.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetSparseTensorValues, _In_ const OrtValue* ort_value, _Outptr_ const void** out);

  /** \brief Returns data type, shape for the type of indices specified by indices_format.
   *
   * \param[in] ort_value ::OrtValue containing sparse tensor.
   * \param[in] indices_format One of the indices formats. It is an error to request a format that the sparse
   * tensor does not contain.
   * \param[out] out an instance of ::OrtTensorTypeAndShapeInfo. Must be freed by OrtApi::ReleaseTensorTypeAndShapeInfo
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetSparseTensorIndicesTypeShape, _In_ const OrtValue* ort_value, enum OrtSparseIndicesFormat indices_format, _Outptr_ OrtTensorTypeAndShapeInfo** out);

  /** \brief Returns indices data for the type of the indices specified by indices_format
   *
   * \param[in] ort_value ::OrtValue containing sparse tensor.
   * \param[in] indices_format One of the indices formats. It is an error to request a format that the sparse tensor does not contain.
   * \param[out] num_indices Pointer to where the number of indices entries is returned
   * \param[out] indices Returned pointer to the indices data. Do not free the returned pointer as it refers to internal data owned by the ::OrtValue
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetSparseTensorIndices, _In_ const OrtValue* ort_value, enum OrtSparseIndicesFormat indices_format, _Out_ size_t* num_indices, _Outptr_ const void** indices);
  /// @}
  /// \name OrtSessionOptions
  /// @{

  /**
   * \brief Sets out to 1 iff an optional type OrtValue has an element, 0 otherwise (OrtValue is None)
   * Use this API to find if the optional type OrtValue is None or not.
   * If the optional type OrtValue is not None, use the OrtValue just like any other OrtValue.
   * For example, if you get an OrtValue that corresponds to Optional(tensor) and
   * if HasValue() returns true, use it as tensor and so on.

   * \param[in] value Input OrtValue.
   * \param[out] out indicating if the input OrtValue contains data (1) or if it is a None (0)
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(HasValue, _In_ const OrtValue* value, _Out_ int* out);

  /// @}
  /// \name OrtKernelContext
  /// Custom operator APIs.
  /// @{

  /** \brief Used for custom operators, gets the GPU compute stream to use to launch the custom a GPU kernel
   *   \see ::OrtCustomOp
   * \param[in]  context OrtKernelContext instance
   * \param[out] out Returns pointer to a GPU compute stream that can be used to launch the custom GPU kernel.
   *             If retrieving the GPU compute stream is not relevant (GPU not enabled in the build, kernel partitioned to
   *             some other EP), then a nullptr is returned as the output param.
   *             Do not free or mutate the returned pointer as it refers to internal data owned by the underlying session.
   *             Only use it for custom kernel launching.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(KernelContext_GetGPUComputeStream, _In_ const OrtKernelContext* context, _Outptr_ void** out);

  /// @}
  /// \name GetTensorMemoryInfo
  /// @{
  /** \brief Returns a pointer to the ::OrtMemoryInfo of a Tensor
   * \param[in] value ::OrtValue containing tensor.
   * \param[out] mem_info ::OrtMemoryInfo of the tensor. Do NOT free the returned pointer. It is valid for the lifetime of the ::OrtValue
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetTensorMemoryInfo, _In_ const OrtValue* value, _Out_ const OrtMemoryInfo** mem_info);

  /// @}
  /// \name GetExecutionProviderApi
  /// @{
  /** \brief Get a pointer to the requested version of the Execution Provider specific
   * API extensions to the OrtApi
   * \param[in] provider_name The name of the execution provider name. Currently only the following
   * values are supported: "DML".
   * \param[in] version Must be ::ORT_API_VERSION.
   * \param[out] provider_api A void pointer containing a reference to the execution provider versioned api structure.
   * For example, the provider_api pointer can be cast to the OrtDmlApi* when the provider_name is "DML".
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetExecutionProviderApi, _In_ const char* provider_name, _In_ uint32_t version, _Outptr_ const void** provider_api);

  /// @}

  /// \name SessionOptions
  /// @{
  /** \brief Set custom thread creation function
   *
   * \param[in] options Session options
   * \param[in] ort_custom_create_thread_fn Custom thread creation function
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SessionOptionsSetCustomCreateThreadFn, _Inout_ OrtSessionOptions* options, _In_ OrtCustomCreateThreadFn ort_custom_create_thread_fn);

  /** \brief Set creation options for custom thread
   *
   * \param[in] options Session options
   * \param[in] ort_custom_thread_creation_options Custom thread creation options (can be nullptr)
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SessionOptionsSetCustomThreadCreationOptions, _Inout_ OrtSessionOptions* options, _In_ void* ort_custom_thread_creation_options);

  /** \brief Set custom thread join function
   *
   * \param[in] options Session options
   * \param[in] ort_custom_join_thread_fn Custom join thread function, must not be nullptr when ort_custom_create_thread_fn is set
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SessionOptionsSetCustomJoinThreadFn, _Inout_ OrtSessionOptions* options, _In_ OrtCustomJoinThreadFn ort_custom_join_thread_fn);
  /// @}

  /// \name OrtThreadingOptions
  /// @{
  /** \brief Set custom thread creation function for global thread pools
   *
   * \param[inout] tp_options
   * \param[in] ort_custom_create_thread_fn Custom thread creation function
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SetGlobalCustomCreateThreadFn, _Inout_ OrtThreadingOptions* tp_options, _In_ OrtCustomCreateThreadFn ort_custom_create_thread_fn);

  /** \brief Set custom thread creation options for global thread pools
   *
   * \param[inout] tp_options
   * \param[in] ort_custom_thread_creation_options Custom thread creation options (can be nullptr)
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SetGlobalCustomThreadCreationOptions, _Inout_ OrtThreadingOptions* tp_options, _In_ void* ort_custom_thread_creation_options);

  /** \brief Set custom thread join function for global thread pools
   *
   * \param[inout] tp_options
   * \param[in] ort_custom_join_thread_fn Custom thread join function, must not be nullptr when global ort_custom_create_thread_fn is set
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SetGlobalCustomJoinThreadFn, _Inout_ OrtThreadingOptions* tp_options, _In_ OrtCustomJoinThreadFn ort_custom_join_thread_fn);
  /// @}

  /** \brief Synchronize bound inputs. The call may be necessary for some providers, such as cuda,
   *   in case the system that allocated bound memory operated on a different stream. However, the
   *   operation is provider specific and could be a no-op.
   *
   * \param[inout] binding_ptr
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SynchronizeBoundInputs, _Inout_ OrtIoBinding* binding_ptr);

  /** \brief Synchronize bound outputs. The call may be necessary for some providers, such as cuda,
   *   in case the system that allocated bound memory operated on a different stream. However, the
   *   operation is provider specific and could be a no-op.
   *
   * \param[inout] binding_ptr
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(SynchronizeBoundOutputs, _Inout_ OrtIoBinding* binding_ptr);

  /// \name OrtSessionOptions
  /// @{

  /** \brief Append CUDA execution provider to the session options
   *
   * If CUDA is not available (due to a non CUDA enabled build), this function will return failure.
   *
   * This is slightly different from OrtApi::SessionOptionsAppendExecutionProvider_CUDA, it takes an
   * ::OrtCUDAProviderOptions which is publicly defined. This takes an opaque ::OrtCUDAProviderOptionsV2
   * which must be created with OrtApi::CreateCUDAProviderOptions.
   *
   * For OrtApi::SessionOptionsAppendExecutionProvider_CUDA, the user needs to instantiate ::OrtCUDAProviderOptions
   * as well as allocate/release buffers for some members of ::OrtCUDAProviderOptions.
   * Here, OrtApi::CreateCUDAProviderOptions and Ortapi::ReleaseCUDAProviderOptions will do the memory management for you.
   *
   * \param[in] options
   * \param[in] cuda_options
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.11.
   */
  ORT_API2_STATUS(SessionOptionsAppendExecutionProvider_CUDA_V2,
                  _In_ OrtSessionOptions* options, _In_ const OrtCUDAProviderOptionsV2* cuda_options);

  /// @}
  /// \name OrtCUDAProviderOptionsV2
  /// @{

  /** \brief Create an OrtCUDAProviderOptionsV2
   *
   * \param[out] out Newly created ::OrtCUDAProviderOptionsV2. Must be released with OrtApi::ReleaseCudaProviderOptions
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.11.
   */
  ORT_API2_STATUS(CreateCUDAProviderOptions, _Outptr_ OrtCUDAProviderOptionsV2** out);

  /** \brief Set options in a CUDA Execution Provider.
   *
   * Please refer to https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html#configuration-options
   * to know the available keys and values. Key should be in null terminated string format of the member of ::OrtCUDAProviderOptionsV2
   * and value should be its related range. Recreates the options and only sets the supplied values.
   *
   * For example, key="device_id" and value="0"
   *
   * \param[in] cuda_options
   * \param[in] provider_options_keys Array of UTF-8 null-terminated string for provider options keys
   * \param[in] provider_options_values Array of UTF-8 null-terminated string for provider options values
   * \param[in] num_keys Number of elements in the `provider_option_keys` and `provider_options_values` arrays
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.11.
   */
  ORT_API2_STATUS(UpdateCUDAProviderOptions, _Inout_ OrtCUDAProviderOptionsV2* cuda_options,
                  _In_reads_(num_keys) const char* const* provider_options_keys,
                  _In_reads_(num_keys) const char* const* provider_options_values,
                  _In_ size_t num_keys);

  /**
   * Get serialized CUDA provider options string.
   *
   * For example, "device_id=0;arena_extend_strategy=0;......"
   *
   * \param cuda_options - OrtCUDAProviderOptionsV2 instance
   * \param allocator - a ptr to an instance of OrtAllocator obtained with CreateAllocator() or GetAllocatorWithDefaultOptions()
   *                      the specified allocator will be used to allocate continuous buffers for output strings and lengths.
   * \param ptr - is a UTF-8 null terminated string allocated using 'allocator'. The caller is responsible for using the same allocator to free it.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.11.
   */
  ORT_API2_STATUS(GetCUDAProviderOptionsAsString, _In_ const OrtCUDAProviderOptionsV2* cuda_options, _Inout_ OrtAllocator* allocator, _Outptr_ char** ptr);

  /** \brief Release an ::OrtCUDAProviderOptionsV2
   *
   * \note This is an exception in the naming convention of other Release* functions, as the name of the method does not have the V2 suffix, but the type does
   *
   * \since Version 1.11.
   */
  void(ORT_API_CALL* ReleaseCUDAProviderOptions)(_Frees_ptr_opt_ OrtCUDAProviderOptionsV2* input);

  /// @}

  /** \brief Append MIGraphX provider to session options
   *
   * If MIGraphX is not available (due to a non MIGraphX enabled build, or if MIGraphX is not installed on the system), this function will return failure.
   *
   * \param[in] options
   * \param[in] migraphx_options
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.11.
   */
  ORT_API2_STATUS(SessionOptionsAppendExecutionProvider_MIGraphX,
                  _In_ OrtSessionOptions* options, _In_ const OrtMIGraphXProviderOptions* migraphx_options);

  /** \brief Replace initialized Tensors with external data with the data provided in initializers.
   *
   * The function will find the initialized TensorProtos with external data in the graph with the provided names and
   * replace them with the provided tensors. The API verifies that the TensorProto being replaced
   * has an external data reference and has the same name, dimensions and data type as its replacement. The replacement
   * will occur before any of the optimizations take place. The data will be copied into the graph
   * since TensorProto can't refer to the user provided buffers.
   *
   * Once the model has been loaded, the OrtValue(s) added to SessionOptions instance will be removed
   * from the internal SessionOptions copy to save memory, the user provided buffers can then be deallocated
   * and the SessionOptions instance that refers to them can be destroyed.
   *
   * \param[in] options
   * \param[in] initializer_names Array of null terminated UTF-8 encoded strings of the initializers names.
   * \param[in] initializers Array of ::OrtValue type
   * \param[in] num_initializers Number of elements in the initializer_names and initializers
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.12.
   */
  ORT_API2_STATUS(AddExternalInitializers, _In_ OrtSessionOptions* options,
                  _In_reads_(num_initializers) const char* const* initializer_names,
                  _In_reads_(num_initializers) const OrtValue* const* initializers, size_t num_initializers);

  /** \brief: Create attribute of onnxruntime operator
   *
   * \param[in] name Name of the attribute
   * \param[in] data Data content of the attribute
   * \param[in] len Number of bytes stored in data for ORT_OP_ATTR_STRING.
                    Number of elements if data represents an array (e.g., ORT_OP_ATTR_INTS). Otherwise, set to 1.
   * \param[in] type Data type
   * \param[out] op_attr Attribute that has been created, which must be released by OrtApi::ReleaseOpAttr
   *
   * \since Version 1.12.
   */
  ORT_API2_STATUS(CreateOpAttr,
                  _In_ const char* name,
                  _In_ const void* data,
                  _In_ int len,
                  _In_ OrtOpAttrType type,
                  _Outptr_ OrtOpAttr** op_attr);

  /* \brief: Release op attribute
   *
   * \param[in] opAttr Attribute created by OrtApi::CreateOpAttr
   *
   * \since Version 1.12.
   */
  ORT_CLASS_RELEASE(OpAttr);

  /** \brief: Create onnxruntime native operator
   *
   * \param[in] info Kernel info
   * \param[in] op_name Operator name
   * \param[in] domain Operator domain
   * \param[in] version Operator opset version
   * \param[in] type_constraint_names Name of the type constraints, such as "T" or "T1"
   * \param[in] type_constraint_values Type of each constraints
   * \param[in] type_constraint_count Number of constraints
   * \param[in] attr_values Attributes used to initialize the operator
   * \param[in] attr_count Number of the attributes
   * \param[in] input_count Number of inputs
   * \param[in] output_count Number of outputs
   * \param[out] ort_op Operator that has been created
   *
   * \since Version 1.12.
   */
  ORT_API2_STATUS(CreateOp,
                  _In_ const OrtKernelInfo* info,
                  _In_z_ const char* op_name,
                  _In_z_ const char* domain,
                  int version,
                  _In_reads_(type_constraint_count) const char** type_constraint_names,
                  _In_reads_(type_constraint_count) const ONNXTensorElementDataType* type_constraint_values,
                  int type_constraint_count,
                  _In_reads_(attr_count) const OrtOpAttr* const* attr_values,
                  int attr_count,
                  int input_count,
                  int output_count,
                  _Outptr_ OrtOp** ort_op);

  /** \brief: Invoke the operator created by OrtApi::CreateOp
   * The inputs must follow the order as specified in onnx specification
   *
   * \param[in] context Kernel context
   * \param[in] ort_op Operator that has been created
   * \param[in] input_values Array of inputs
   * \param[in] input_count Number of inputs
   * \param[in] output_values Array of outputs
   * \param[in] output_count Number of outputs
   *
   * \since Version 1.12.
   */
  ORT_API2_STATUS(InvokeOp,
                  _In_ const OrtKernelContext* context,
                  _In_ const OrtOp* ort_op,
                  _In_ const OrtValue* const* input_values,
                  _In_ int input_count,
                  _Inout_ OrtValue* const* output_values,
                  _In_ int output_count);

  /* \brief: Release an onnxruntime operator
   *
   * \param[in] Op Operator created by OrtApi::CreateOp
   *
   * \since Version 1.12.
   */
  ORT_CLASS_RELEASE(Op);

  /** \brief: Append execution provider to the session options.
   * \param[in] options
   * \param[in] provider_name - provider to add.
   * \param[in] provider_options_keys - keys to configure the provider options
   * \param[in] provider_options_values - values to configure the provider options
   * \param[in] num_keys - number of keys passed in
   *
   * Currently supported provider names:
   *   QNNExecutionProvider (or QNN)
   *   OpenVINOExecutionProvider (or OpenVINO)
   *   XnnpackExecutionProvider (or XNNPACK)
   *   WebNNExecutionProvider (or WEBNN)
   *   WebGpuExecutionProvider (or WebGPU)
   *   AzureExecutionProvider (or AZURE)
   *   JsExecutionProvider (or JS)
   *   VitisAIExecutionProvider (or VitisAI)
   *   CoreMLExecutionProvider (or CoreML)
   *
   * Note: If an execution provider has a dedicated SessionOptionsAppendExecutionProvider_<provider name> function
   *       that should be used to add it.
   *
   * QNN supported keys:
   *   "backend_type": Type of QNN backend. Specifies a backend path that is the associated QNN backend library file
   *      name. E.g., given backend type "htp", on Windows, the backend path would be "QnnHtp.dll", and on other
   *      platforms, it would be "libQnnHtp.so". Mutually exclusive with "backend_path".
   *      Available options:
   *      -# "cpu"
   *      -# "gpu"
   *      -# "htp": Default.
   *      -# "saver"
   *      -# "ir"
   *   "backend_path": File path to QNN backend library. Mutually exclusive with "backend_type".
   *   "profiling_level": QNN profiling level.
   *      Available options:
   *      -# "off": Default.
   *      -# "basic"
   *      -# "detailed"
   *   "profiling_file_path": QNN profiling file path if ETW not enabled.
   *   "rpc_control_latency": QNN RPC control latency.
   *   "vtcm_mb": QNN VTCM size in MB. default to 0(not set).
   *   "htp_performance_mode": QNN performance mode.
   *      Available options:
   *      -# "burst"
   *      -# "balanced"
   *      -# "default": Default.
   *      -# "high_performance"
   *      -# "high_power_saver"
   *      -# "low_balanced"
   *      -# "extreme_power_saver"
   *      -# "low_power_saver"
   *      -# "power_saver"
   *      -# "sustained_high_performance"
   *   "dump_qnn_ir_dlc": Use the QnnIr backend library to write .dlc files for each subgraph dispatched to QNN. When
   *       enabled, inference results will be incorrect. Use only for debugging.
   *      -# "0": Default: disabled
   *      -# "1": enabled
   *   "dump_qnn_ir_dlc_dir": Set the directory into which QnnIr will be configured to write QNN graphs as .dlc files.
   *      Default is current working directory.
   *   "qnn_ir_backend_path": File path to the QnnIr backend library. If "dump_qnn_ir_dlc" is enabled, use this path
   *      instead of looking for the Ir backend in the standard location.
   *   "qnn_saver_path": File path to the QNN Saver backend library. If specified, QNN Saver will be enabled and will
   *      dump QNN API calls to disk for replay/debugging. QNN Saver produces incorrect model inference results and
   *      may alter model/EP partitioning. Use only for debugging.
   *   "qnn_context_priority": QNN context priority.
   *      Available options:
   *      -# "low"
   *      -# "normal": Default.
   *      -# "normal_high"
   *      -# "high"
   *   "htp_graph_finalization_optimization_mode": Set the optimization mode for graph finalization on the HTP backend.
   *      Available options:
   *      -# "0": Default.
   *      -# "1": Faster preparation time, less optimal graph.
   *      -# "2": Longer preparation time, more optimal graph.
   *      -# "3": Longest preparation time, most likely even more optimal graph. See QNN SDK documentation for specific
   *        details.
   *   "soc_model": The SoC model number. Refer to the QNN SDK documentation for valid values.
   *      Defaults to "0" (unknown).
   *   "htp_arch": The minimum HTP architecture the driver will use to select compatible QNN operators.
   *      Available options:
   *      -# "0": Default (none).
   *      -# "68"
   *      -# "69"
   *      -# "73"
   *      -# "75"
   *      -# "81"
   *   "device_id": The ID of the device to use when setting 'htp_arch'. Defaults to "0" (for single device).
   *   "enable_htp_fp16_precision": Used for float32 model for HTP backend.
   *      Enable the float32 model to be inferenced with fp16 precision. Otherwise, it will be fp32 precision.
   *      -# "0": With fp32 precision.
   *      -# "1": Default. With fp16 precision.
   *   "offload_graph_io_quantization": Offload graph input quantization and graph output dequantization to another
   *      execution provider (typically CPU EP).
   *      -# "0": Disabled. QNN EP will handle quantization and dequantization of graph I/O.
   *      -# "1": Enabled. This is the default value.
   *   "enable_htp_spill_fill_buffer": Enable HTP spill fill buffer setting. The flag is used while generating context
   *      binary.
   *      -# "0": Default. Disabled.
   *      -# "1": Enabled.
   *   "enable_htp_shared_memory_allocator": Enable the QNN HTP shared memory allocator. Requires libcdsprpc.so/dll to
   *      be available.
   *      -# "0": Default. Disabled.
   *      -# "1": Enabled.
   *   "dump_json_qnn_graph": Set to "1" to dump QNN graphs generated by QNN EP as JSON files. Each graph partition
   *      assigned to QNN EP is dumped to a separate file.
   *   "json_qnn_graph_dir": Directory in which to dump QNN JSON graphs. If not specified, QNN graphs are dumped in the
   *      program's current working directory. Ignored if "dump_json_qnn_graph" is not set.
   *   "op_packages": QNN UDO op_package for QNN EP, allowed format:
   *     "<op_type>:<op_package_path>:<interface>[:<target>],<op_type2>:<op_package_path2>:<interface2>[:<target>]",
   *     where op_type is the name of the operation, op_package_path is the path to the op package shared library,
   *     interface is the symbol name to register the op life cycle functions, and target is the backend type. For more
   *     details, refer to: https://docs.qualcomm.com/bundle/publicresource/topics/80-63442-50/op_packages.html
   *     [Advanced] "skip_qnn_version_check": Set to "1" to allow a different version of QNN to be used than what was compiled
   *     into ONNX Runtime. Differences in operator support, accuracy, performance, and QNN's ABI may lead to crashes, inaccurate
   *     results, and poor performance. Use with caution and test thoroughly.
   *
   * XNNPACK supported keys:
   *   "intra_op_num_threads": number of thread-pool size to use for XNNPACK execution provider.
   *      default value is 0, which means to use the session thread-pool size.
   *
   * \since Version 1.12.
   */
  ORT_API2_STATUS(SessionOptionsAppendExecutionProvider, _In_ OrtSessionOptions* options,
                  _In_ const char* provider_name,
                  _In_reads_(num_keys) const char* const* provider_options_keys,
                  _In_reads_(num_keys) const char* const* provider_options_values,
                  _In_ size_t num_keys);

  /* \brief: Get a copy of kernel info
   *
   * \param[in] info Kernel info
   * \param[out] info_copy Copy of kernel info
   *
   * \since Version 1.12.
   */
  ORT_API2_STATUS(CopyKernelInfo,
                  _In_ const OrtKernelInfo* info,
                  _Outptr_ OrtKernelInfo** info_copy);

  /* \brief: Release kernel info
   *
   * \param[in] KernelInfo A copy of kernel info returned by CopyKernelInfo
   *
   * \since Version 1.12.
   */
  ORT_CLASS_RELEASE(KernelInfo);

  /// \name Ort Training
  /// @{
  /** \brief Gets the Training C Api struct
   *
   * Call this function to access the ::OrtTrainingApi structure that holds pointers to functions that enable
   * training with onnxruntime.
   * \note A NULL pointer will be returned and no error message will be printed if the training api
   * is not supported with this build. A NULL pointer will be returned and an error message will be
   * printed if the provided version is unsupported, for example when using a runtime older than the
   * version created with this header file.
   *
   * \param[in] version Must be ::ORT_API_VERSION
   * \return The ::OrtTrainingApi struct for the version requested.
   *
   * \since Version 1.13
   */
  const OrtTrainingApi*(ORT_API_CALL* GetTrainingApi)(uint32_t version)NO_EXCEPTION;

  /// @}

  /** \brief Append CANN provider to session options
   *
   * If CANN is not available (due to a non CANN enabled build, or if CANN is not installed on the system), this function will return failure.
   *
   * \param[in] options
   * \param[in] cann_options
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.13.
   */
  ORT_API2_STATUS(SessionOptionsAppendExecutionProvider_CANN,
                  _In_ OrtSessionOptions* options, _In_ const OrtCANNProviderOptions* cann_options);

  /** \brief Create an OrtCANNProviderOptions
   *
   * \param[out] out created ::OrtCANNProviderOptions. Must be released with OrtApi::ReleaseCANNProviderOptions
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.13.
   */
  ORT_API2_STATUS(CreateCANNProviderOptions, _Outptr_ OrtCANNProviderOptions** out);

  /** \brief Set options in a CANN Execution Provider.
   *
   * \param[in] cann_options
   * \param[in] provider_options_keys Array of UTF-8 null-terminated string for provider options keys
   * \param[in] provider_options_values Array of UTF-8 null-terminated string for provider options values
   * \param[in] num_keys Number of elements in the `provider_option_keys` and `provider_options_values` arrays
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.13.
   */
  ORT_API2_STATUS(UpdateCANNProviderOptions, _Inout_ OrtCANNProviderOptions* cann_options,
                  _In_reads_(num_keys) const char* const* provider_options_keys,
                  _In_reads_(num_keys) const char* const* provider_options_values,
                  _In_ size_t num_keys);

  /** \brief Get serialized CANN provider options string.
   *
   * \param[in] cann_options OrtCANNProviderOptions instance
   * \param[in] allocator a ptr to an instance of OrtAllocator obtained with CreateAllocator()
   *                      or GetAllocatorWithDefaultOptions(), the specified allocator will be used to allocate
   *                      continuous buffers for output strings and lengths.
   * \param[out] ptr is a UTF-8 null terminated string allocated using 'allocator'.
   *                 The caller is responsible for using the same allocator to free it.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.13.
   */
  ORT_API2_STATUS(GetCANNProviderOptionsAsString, _In_ const OrtCANNProviderOptions* cann_options,
                  _Inout_ OrtAllocator* allocator, _Outptr_ char** ptr);

  /** \brief Release an OrtCANNProviderOptions
   *
   * \param[in] input The pointer of OrtCANNProviderOptions which will been deleted
   *
   * \since Version 1.13.
   */
  void(ORT_API_CALL* ReleaseCANNProviderOptions)(_Frees_ptr_opt_ OrtCANNProviderOptions* input);

  /*  \brief Get OrtDevice type from MemoryInfo
   *
   *  \since Version 1.14
   */
  void(ORT_API_CALL* MemoryInfoGetDeviceType)(_In_ const OrtMemoryInfo* ptr, _Out_ OrtMemoryInfoDeviceType* out);

  /* \brief Update the OrtEnv instance with custom log severity level
   *
   * \param[in] ort_env The OrtEnv instance being used
   * \param[in] log_severity_level The log severity level.
   *
   * \since Version 1.14.
   */
  ORT_API2_STATUS(UpdateEnvWithCustomLogLevel, _In_ OrtEnv* ort_env, OrtLoggingLevel log_severity_level);

  /*  \brief Set affinities for intra op threads
   *
   * Affinity string follows format:
   * logical_processor_id,logical_processor_id;logical_processor_id,logical_processor_id
   * Semicolon isolates configurations among threads, while comma split processors where ith thread expected to attach to.
   * e.g. 1,2,3;4,5
   * specifies affinities for two threads, with the 1st thread attach to the 1st, 2nd, and 3rd processor, and 2nd thread to the 4th and 5th.
   * To ease the configuration, an "interval" is also allowed:
   * e.g. 1-8;8-16;17-24
   * orders that the 1st thread runs on first eight processors, 2nd thread runs on next eight processors, and so forth.
   * Note:
   * 1. Once set, the number of thread affinities must equal to intra_op_num_threads - 1,
   *    ort does not set affinity on the main thread which is started and managed by the calling app;
   * 2. For windows, ort will infer the group id from a logical processor id, for example, assuming there are two groups with each has 64 logical processors,
   *    an id of 64 will be inferred as the last processor of the 1st group, while 65 will be interpreted as the 1st processor of the second group.
   *    Hence 64-65 is an invalid configuration, because a windows thread cannot be attached to processors across group boundary.
   *
   *  \since Version 1.14
   */
  ORT_API2_STATUS(SetGlobalIntraOpThreadAffinity, _Inout_ OrtThreadingOptions* tp_options, const char* affinity_string);

  /** \brief Register custom ops from a shared library.
   *
   * Loads a shared library (.dll on windows, .so on linux, etc) named 'library_name' and looks for this entry point:
   *		OrtStatus* RegisterCustomOps(OrtSessionOptions * options, const OrtApiBase* api);
   * It then passes in the provided session options to this function along with the api base.
   *
   * The handle to the loaded library is automatically released by ORT when the last OrtSession that references the
   * library handle is released. If no OrtSession is created, then the library handle is released when the provided
   * OrtSessionOptions is released.
   *
   * \param[in] options The session options.
   * \param[in] library_name The name of the shared library to load and register. Refer to OS-specific dynamic library
   *                         loading utilities (e.g., LoadLibraryEx on Windows or dlopen on Linux/MacOS) for information
   *                         on the format of library names and search paths.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.14
   */
  ORT_API2_STATUS(RegisterCustomOpsLibrary_V2, _Inout_ OrtSessionOptions* options, _In_ const ORTCHAR_T* library_name);

  /** \brief Register custom ops by calling a RegisterCustomOpsFn function.
   *
   * Searches for registration_func_name and if found calls it.
   *
   * The library containing the function must either be linked against or previously loaded by the executable.
   *
   * If you want ONNX Runtime to load the library and manage its lifetime, use RegisterCustomOpsLibrary_V2.
   *
   * RegisterCustomOpsUsingFunction can be used in scenarios where it may not be possible for ONNX Runtime to load
   * the library from a path. e.g. mobile platforms where the library must be linked into the app.
   *
   * The registration function must have the signature of RegisterCustomOpsFn:
   *    OrtStatus* (*fn)(OrtSessionOptions* options, const OrtApiBase* api);
   *
   * See https://onnxruntime.ai/docs/reference/operators/add-custom-op.html for details on how the registration
   * function should be implemented.
   *
   * \param[in] options OrtSessionOptions that is passed through as the first argument in the call to the
   *                    registration function.
   * \param[in] registration_func_name Name of registration function to use.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.14
   */
  ORT_API2_STATUS(RegisterCustomOpsUsingFunction, _Inout_ OrtSessionOptions* options,
                  _In_ const char* registration_func_name);

  /// \name OrtKernelInfo
  /// Custom operator APIs.
  /// @{

  /** \brief Get the number of inputs from ::OrtKernelInfo.
   *
   * Used in the CreateKernel callback of an OrtCustomOp to query the number of inputs
   * during kernel/session creation.
   *
   * \param[in] info Instance of ::OrtKernelInfo.
   * \param[out] out Pointer to variable assigned with the result on success.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.14
   */
  ORT_API2_STATUS(KernelInfo_GetInputCount, _In_ const OrtKernelInfo* info, _Out_ size_t* out);

  /** \brief Get the number of outputs from ::OrtKernelInfo.
   *
   * Used in the CreateKernel callback of an OrtCustomOp to query the number of outputs
   * during kernel/session creation.
   *
   * \param[in] info Instance of ::OrtKernelInfo.
   * \param[out] out Pointer to variable assigned with the result on success.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.14
   */
  ORT_API2_STATUS(KernelInfo_GetOutputCount, _In_ const OrtKernelInfo* info, _Out_ size_t* out);

  /** \brief Get the name of a ::OrtKernelInfo's input.
   *
   * Used in the CreateKernel callback of an OrtCustomOp to query an input's name
   * during kernel/session creation.
   *
   * If `out` is nullptr, the value of `size` is set to the size of the name
   * string (including null-terminator), and a success status is returned.
   *
   * If the `size` parameter is greater than or equal to the name string's size and `out` is not nullptr,
   * the value of `size` is set to the true size of the string (including null-terminator),
   * the provided memory is filled with the string's contents, and a success status is returned.
   *
   * If the `size` parameter is less than the actual string's size and `out`
   * is not nullptr, the value of `size` is set to the true size of the string
   * and a failure status is returned.
   *
   * \param[in] info An instance of ::OrtKernelInfo.
   * \param[in] index The index of the input name to get. Returns a failure status if out-of-bounds.
   * \param[out] out Memory location into which to write the UTF-8 null-terminated string representing the input's name.
   * \param[in,out] size Pointer to the size of the `out` buffer. See above comments for details.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.14
   */
  ORT_API2_STATUS(KernelInfo_GetInputName, _In_ const OrtKernelInfo* info, size_t index, _Out_opt_ char* out,
                  _Inout_ size_t* size);

  /** \brief Get the name of a ::OrtKernelInfo's output.
   *
   * Used in the CreateKernel callback of an OrtCustomOp to query an output's name
   * during kernel/session creation.
   *
   * If `out` is nullptr, the value of `size` is set to the size of the name
   * string (including null-terminator), and a success status is returned.
   *
   * If the `size` parameter is greater than or equal to the name string's size and `out` is not nullptr,
   * the value of `size` is set to the true size of the string (including null-terminator),
   * the provided memory is filled with the string's contents, and a success status is returned.
   *
   * If the `size` parameter is less than the actual string's size and `out`
   * is not nullptr, the value of `size` is set to the true size of the string
   * and a failure status is returned.
   *
   * \param[in] info An instance of ::OrtKernelInfo.
   * \param[in] index The index of the output name to get. Returns a failure status if out-of-bounds.
   * \param[out] out Memory location into which to write the UTF-8 null-terminated string representing the output's
   *                 name.
   * \param[in,out] size Pointer to the size of the `out` buffer. See above comments for details.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.14
   */
  ORT_API2_STATUS(KernelInfo_GetOutputName, _In_ const OrtKernelInfo* info, size_t index, _Out_opt_ char* out,
                  _Inout_ size_t* size);

  /** \brief Get the type information for a ::OrtKernelInfo's input.
   *
   * Used in the CreateKernel callback of an OrtCustomOp to query the shape and type information
   * of an input during kernel/session creation.
   *
   * \param[in] info An instance of ::OrtKernelInfo.
   * \param[in] index Which input to get the type information for
   * \param[out] type_info Pointer set to the resulting ::OrtTypeInfo. Must be freed with OrtApi::ReleaseTypeInfo.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.14
   */
  ORT_API2_STATUS(KernelInfo_GetInputTypeInfo, _In_ const OrtKernelInfo* info, size_t index,
                  _Outptr_ OrtTypeInfo** type_info);

  /** \brief Get the type information for a ::OrtKernelInfo's output.
   *
   * Used in the CreateKernel callback of an OrtCustomOp to query the shape and type information
   * of an output during kernel/session creation.
   *
   * \param[in] info An instance of ::OrtKernelInfo.
   * \param[in] index Which input to get the type information for
   * \param[out] type_info Pointer set to the resulting ::OrtTypeInfo. Must be freed with OrtApi::ReleaseTypeInfo.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.14
   */
  ORT_API2_STATUS(KernelInfo_GetOutputTypeInfo, _In_ const OrtKernelInfo* info, size_t index,
                  _Outptr_ OrtTypeInfo** type_info);

  /** \brief Get a ::OrtValue tensor stored as an attribute in the graph node.
   *
   * Used in the CreateKernel callback of an OrtCustomOp to get a tensor attribute.
   *
   * \param[in] info ::OrtKernelInfo instance.
   * \param[in] name UTF-8 null-terminated string representing the attribute's name.
   * \param[in] allocator Allocator used to allocate the internal tensor state.
   * \param[out] out Returns newly created ::OrtValue. Must be freed with OrtApi::ReleaseValue,
   *                 which will also free internal tensor state allocated with the provided allocator.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(KernelInfoGetAttribute_tensor, _In_ const OrtKernelInfo* info, _In_z_ const char* name,
                  _Inout_ OrtAllocator* allocator, _Outptr_ OrtValue** out);

  /// @}
  /// \name OrtSessionOptions
  /// Custom operator APIs
  /// @{

  /** \brief Checks if the given session configuration entry exists.
   *
   * The config_key formats are defined in onnxruntime_session_options_config_keys.h
   *
   * Can be used in a custom operator library to check for session configuration entries
   * that target one or more custom operators in the library. Example: The config entry
   * custom_op.myop.some_key targets a custom op named "myop".
   *
   * \param[in] options The ::OrtSessionOptions instance.
   * \param[in] config_key A null-terminated UTF-8 string representation of the configuration key.
   * \param[out] out Pointer set to 1 if the entry exists and 0 otherwise.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.14
   */
  ORT_API2_STATUS(HasSessionConfigEntry, _In_ const OrtSessionOptions* options,
                  _In_z_ const char* config_key, _Out_ int* out);

  /** \brief Get a session configuration value.
   *
   * Returns a failure status if the configuration key does not exist.
   * The config_key and the format of config_value are defined in onnxruntime_session_options_config_keys.h
   *
   * If `config_value` is nullptr, the value of `size` is set to the true size of the string
   * value (including null-terminator), and a success status is returned.
   *
   * If the `size` parameter is greater than or equal to the actual string value's size,
   * the value of `size` is set to the true size of the string value, the provided memory
   * is filled with the value's contents, and a success status is returned.
   *
   * If the `size` parameter is less than the actual string value's size and `config_value`
   * is not nullptr, the value of `size` is set to the true size of the string value
   * and a failure status is returned.
   *
   * Can be used in a custom operator library to get session configuration entries
   * that target one or more custom operators in the library. Example: The config entry
   * custom_op.myop.some_key targets a custom op named "myop".
   *
   * \param[in] options The session options.
   * \param[in] config_key A null-terminated UTF-8 string representation of the config key.
   * \param[in] config_value Pointer to memory where the null-terminated UTF-8 string value will be stored.
   * \param[in,out] size Pointer to the size of the `config_value` buffer. See above comments for details.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.14
   */
  ORT_API2_STATUS(GetSessionConfigEntry, _In_ const OrtSessionOptions* options,
                  _In_z_ const char* config_key, _Out_ char* config_value, _Inout_ size_t* size);

  /// @}

  /** \brief Append dnnl provider to session options
   *
   * If oneDNN is not available, this function will return failure.
   *
   * \param[in] options
   * \param[in] dnnl_options
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.15.
   */
  ORT_API2_STATUS(SessionOptionsAppendExecutionProvider_Dnnl,
                  _In_ OrtSessionOptions* options, _In_ const OrtDnnlProviderOptions* dnnl_options);

  /** \brief Create an OrtDnnlProviderOptions
   *
   * \param[out] out Newly created ::OrtDnnlProviderOptions. Must be released with OrtApi::ReleaseDnnlProviderOptions
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.15.
   */
  ORT_API2_STATUS(CreateDnnlProviderOptions, _Outptr_ OrtDnnlProviderOptions** out);

  /** \brief Set options in a oneDNN Execution Provider.
   *
   * Key should be in null terminated string format of the member of ::OrtDnnlProviderOptions
   * and value should be its related range.
   *
   * For example, key="use_arena" and value="1"
   *
   * \param[in] dnnl_options
   * \param[in] provider_options_keys Array of UTF-8 null-terminated string for provider options keys
   * \param[in] provider_options_values Array of UTF-8 null-terminated string for provider options values
   * \param[in] num_keys Number of elements in the `provider_option_keys` and `provider_options_values` arrays
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.15.
   */
  ORT_API2_STATUS(UpdateDnnlProviderOptions, _Inout_ OrtDnnlProviderOptions* dnnl_options,
                  _In_reads_(num_keys) const char* const* provider_options_keys,
                  _In_reads_(num_keys) const char* const* provider_options_values,
                  _In_ size_t num_keys);

  /**
   * Get serialized oneDNN provider options string.
   *
   * For example, "use_arena=1;......"
   *
   * \param dnnl_options - OrtDnnlProviderOptions instance
   * \param allocator - a ptr to an instance of OrtAllocator obtained with CreateAllocator() or GetAllocatorWithDefaultOptions()
   *                      the specified allocator will be used to allocate continuous buffers for output strings and lengths.
   * \param ptr - is a UTF-8 null terminated string allocated using 'allocator'. The caller is responsible for using the same allocator to free it.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.15.
   */
  ORT_API2_STATUS(GetDnnlProviderOptionsAsString, _In_ const OrtDnnlProviderOptions* dnnl_options, _Inout_ OrtAllocator* allocator, _Outptr_ char** ptr);

  /** \brief Release an ::OrtDnnlProviderOptions
   *
   * \since Version 1.15.
   */
  void(ORT_API_CALL* ReleaseDnnlProviderOptions)(_Frees_ptr_opt_ OrtDnnlProviderOptions* input);

  /// \name OrtKernelInfo
  /// Custom operator APIs.
  /// @{

  /** \brief Get the graph node name from ::OrtKernelInfo.
   *
   * If `out` is nullptr, the value of `size` is set to the size of the name
   * string (including null-terminator), and a success status is returned.
   *
   * If the `size` parameter is greater than or equal to the name string's size and `out` is not nullptr,
   * the value of `size` is set to the true size of the string (including null-terminator),
   * the provided memory is filled with the string's contents, and a success status is returned.
   *
   * If the `size` parameter is less than the actual string's size and `out`
   * is not nullptr, the value of `size` is set to the true size of the string
   * and a failure status is returned.
   *
   * Can be used in a custom operator's CreateKernel callback to get the name of the operator's node name in the graph.
   *
   * \param[in] info An instance of ::OrtKernelInfo.
   * \param[out] out Memory location into which to write the UTF-8 null-terminated string representing the name.
   * \param[in,out] size Pointer to the size of the `out` buffer. See above comments for details.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.15
   */
  ORT_API2_STATUS(KernelInfo_GetNodeName, _In_ const OrtKernelInfo* info, _Out_opt_ char* out, _Inout_ size_t* size);

  /** \brief Get the session logger from ::OrtKernelInfo.
   *
   * Used in the CreateKernel callback of an OrtCustomOp to get a logger that can be used to log
   * messages.
   *
   * \param[in] info An instance of ::OrtKernelInfo.
   * \param[out] logger Pointer set to the session's ::OrtLogger. Owned by ONNX Runtime, so do not free.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.15
   */
  ORT_API2_STATUS(KernelInfo_GetLogger, _In_ const OrtKernelInfo* info, _Outptr_ const OrtLogger** logger);

  /// @}
  /// \name OrtKernelContext
  /// Custom operator APIs.
  /// @{

  /** \brief Get the runtime logger from ::OrtKernelContext.
   *
   * Used in the KernelCompute callback of an OrtCustomOp to get a logger that can be used to log
   * messages during inference.
   *
   * \param[in] context An instance of ::OrtKernelContext.
   * \param[out] logger Pointer set to the kernel context's ::OrtLogger. Owned by ONNX Runtime, so do not free.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.15
   */
  ORT_API2_STATUS(KernelContext_GetLogger, _In_ const OrtKernelContext* context, _Outptr_ const OrtLogger** logger);

  /// @}
  /// \name OrtLogger
  /// Custom operator APIs.
  /// @{

  /** \brief Logs a message at the given severity level using the provided ::OrtLogger.
   *
   * Only messages with a severity level equal or greater than the ::OrtLogger's logging severity level
   * are logged. Use OrtApi::Logger_GetLoggingSeverityLevel to get the ::OrtLogger's logging severity
   * level.
   *
   * Can be used in custom operators to log messages with the logger retrieved via OrtApi::KernelInfo_GetLogger.
   *
   * \param[in] logger The ::OrtLogger instance.
   * \param[in] log_severity_level The message's severity level.
   * \param[in] message The message to log.
   * \param[in] file_path The filepath of the file in which the message is logged. Usually the value of ORT_FILE.
   * \param[in] line_number The file line number in which the message is logged. Usually the value of __LINE__.
   * \param[in] func_name The name of the function in which the message is logged. Usually the value of __FUNCTION__.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.15
   */
  ORT_API2_STATUS(Logger_LogMessage, _In_ const OrtLogger* logger, OrtLoggingLevel log_severity_level,
                  _In_z_ const char* message, _In_z_ const ORTCHAR_T* file_path, int line_number,
                  _In_z_ const char* func_name);

  /** \brief Get the logging severity level of the ::OrtLogger.
   *
   * Can be used in a custom operator to get the logging severity level of the ::OrtLogger associated with
   * the ::OrtKernelInfo.
   *
   * \param[in] logger The ::OrtLogger instance.
   * \param[out] out Pointer to variable assigned with the logging severity level on success.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.15
   */
  ORT_API2_STATUS(Logger_GetLoggingSeverityLevel, _In_ const OrtLogger* logger, _Out_ OrtLoggingLevel* out);

  /// @}

  /** \brief Get a ::OrtValue tensor stored as a constant initializer in the graph node.
   *
   * Used in the CreateKernel callback of an OrtCustomOp to get a tensor value.
   *
   * \param[in] info ::OrtKernelInfo instance.
   * \param[in] index The node index.
   * \param[out] is_constant Is it a constant node input or not.
   * \param[out] out The OrtValue tensor value.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.15.
   */
  ORT_API2_STATUS(KernelInfoGetConstantInput_tensor, _In_ const OrtKernelInfo* info, size_t index, _Out_ int* is_constant, _Outptr_ const OrtValue** out);

  /** \brief Get Optional Type information from an ::OrtTypeInfo
   *
   * This augments ::OrtTypeInfo to return an ::OrtOptionalTypeInfo when the type is optional.
   * The OrtOptionalTypeInfo also has a nested ::OrtTypeInfo that describes the type of the optional value.
   * ::OrtOptionalTypeInfo type can only appear within model metadata to describe inputs/outputs.
   * The actual OrtValues that are supplied in place of optional type inputs should contain
   * specific type that is described by ::OrtOptionalTypeInfo.
   *
   * So the picture: ::OrtTypeInfo -> ::OrtOptionalTypeInfo -> ::OrtTypeInfo (describes the type that can be supplied
   * in place of the optional type when creating the actual ::OrtValue).
   *
   * \param[in] type_info
   * \param[out] out A pointer to the ::OrtOptionalTypeInfo. Do not free this value,
   *                 it is owned by OrtTypeInfo instance. When the type_info does not represent
   *                 optional type, nullptr is returned in out.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.15.
   */
  ORT_API2_STATUS(CastTypeInfoToOptionalTypeInfo, _In_ const OrtTypeInfo* type_info,
                  _Outptr_result_maybenull_ const OrtOptionalTypeInfo** out);

  /** \brief Get OrtTypeInfo for the allowed contained type from an ::OrtOptionalTypeInfo.
   *
   * This augments ::OrtOptionalTypeInfo to return an ::OrtTypeInfo for the contained type.
   * The OrtOptionalTypeInfo has a nested ::OrtTypeInfo that describes the type of the optional value.
   * ::OrtOptionalTypeInfo type can only appear within model metadata to describe inputs/outputs.
   * The actual OrtValues that are supplied in place of optional type inputs should contain
   * specific type that is described by the returned ::OrtTypeInfo.
   *
   * \param[in] optional_type_info
   * \param[out] out A copy of ::OrtTypeInfo for what the optional value could be.
   *                 The user must free this value with ReleaseTypeInfo.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.15.
   */
  ORT_API2_STATUS(GetOptionalContainedTypeInfo, _In_ const OrtOptionalTypeInfo* optional_type_info,
                  _Outptr_ OrtTypeInfo** out);

  /** \brief Set a single string in a string tensor
   *  Do not zero terminate the string data.
   *
   * \param[in] value A string tensor
   * \param[in] index - flat index of the element
   * \param[in] length_in_bytes length of the buffer in utf-8 bytes (without the null terminator)
   * \param[inout] buffer - address of return value
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   */
  ORT_API2_STATUS(GetResizedStringTensorElementBuffer, _Inout_ OrtValue* value, _In_ size_t index, _In_ size_t length_in_bytes, _Inout_ char** buffer);

  /** \brief Get Allocator from KernelContext for a specific memoryInfo. Please use C API ReleaseAllocator to release out object
   *
   * \param[in] context OrtKernelContext instance
   * \param[in] mem_info OrtMemoryInfo instance
   * \param[out] out A pointer to OrtAllocator. Must be released with OrtApi::ReleaseAllocator.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.15.
   */
  ORT_API2_STATUS(KernelContext_GetAllocator, _In_ const OrtKernelContext* context, _In_ const OrtMemoryInfo* mem_info, _Outptr_ OrtAllocator** out);

  /** \brief Returns a null terminated string of the build info including git info and cxx flags
   *
   * \return UTF-8 encoded version string. Do not deallocate the returned buffer.
   *
   * \since Version 1.15.
   */
  const char*(ORT_API_CALL* GetBuildInfoString)(void);

  /// \name OrtROCMProviderOptions
  /// @{

  /** \brief Create an OrtROCMProviderOptions
   *
   * \param[out] out Newly created ::OrtROCMProviderOptions. Must be released with OrtApi::ReleaseROCMProviderOptions
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.16.
   */
  ORT_API2_STATUS(CreateROCMProviderOptions, _Outptr_ OrtROCMProviderOptions** out);

  /** \brief Set options in a ROCm Execution Provider.
   *
   * Please refer to https://onnxruntime.ai/docs/execution-providers/ROCm-ExecutionProvider.html
   * to know the available keys and values. Key should be in null terminated string format of the member of
   * ::OrtROCMProviderOptions and value should be its related range.
   *
   * For example, key="device_id" and value="0"
   *
   * \param[in] rocm_options
   * \param[in] provider_options_keys Array of UTF-8 null-terminated string for provider options keys
   * \param[in] provider_options_values Array of UTF-8 null-terminated string for provider options values
   * \param[in] num_keys Number of elements in the `provider_option_keys` and `provider_options_values` arrays
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.16.
   */
  ORT_API2_STATUS(UpdateROCMProviderOptions, _Inout_ OrtROCMProviderOptions* rocm_options,
                  _In_reads_(num_keys) const char* const* provider_options_keys,
                  _In_reads_(num_keys) const char* const* provider_options_values,
                  _In_ size_t num_keys);

  /**
   * Get serialized ROCm provider options string.
   *
   * For example, "device_id=0;arena_extend_strategy=0;......"
   *
   * \param rocm_options - OrtROCMProviderOptions instance
   * \param allocator - a ptr to an instance of OrtAllocator obtained with CreateAllocator() or GetAllocatorWithDefaultOptions()
   *                      the specified allocator will be used to allocate continuous buffers for output strings and lengths.
   * \param ptr - is a UTF-8 null terminated string allocated using 'allocator'. The caller is responsible for using the same allocator to free it.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.16.
   */
  ORT_API2_STATUS(GetROCMProviderOptionsAsString, _In_ const OrtROCMProviderOptions* rocm_options, _Inout_ OrtAllocator* allocator, _Outptr_ char** ptr);

  /** \brief Release an ::OrtROCMProviderOptions
   *
   * \note This is an exception in the naming convention of other Release* functions, as the name of the method does not have the V2 suffix, but the type does
   *
   * \since Version 1.16.
   */
  void(ORT_API_CALL* ReleaseROCMProviderOptions)(_Frees_ptr_opt_ OrtROCMProviderOptions* input);

  /** \brief Create an allocator with specific type and register it with the ::OrtEnv
   *  This API enhance CreateAndRegisterAllocator that it can create an allocator with specific type, not just CPU allocator
   *  Enables sharing the allocator between multiple sessions that use the same env instance.
   *  Lifetime of the created allocator will be valid for the duration of the environment.
   *  Returns an error if an allocator with the same ::OrtMemoryInfo is already registered.
   *  \param[in] env OrtEnv instance
   *  \param[in] provider_type ExecutionProvider type
   *  \param[in] mem_info OrtMemoryInfo instance
   *  \param[in] arena_cfg Arena configuration
   *  \param[in] provider_options_keys key of the provider options map
   *  \param[in] provider_options_values value of the provider options map
   *  \param[in] num_keys Length of the provider options map
   */
  ORT_API2_STATUS(CreateAndRegisterAllocatorV2, _Inout_ OrtEnv* env, _In_ const char* provider_type,
                  _In_ const OrtMemoryInfo* mem_info, _In_ const OrtArenaCfg* arena_cfg,
                  _In_reads_(num_keys) const char* const* provider_options_keys, _In_reads_(num_keys) const char* const* provider_options_values, _In_ size_t num_keys);

  /** \brief Run the model asynchronously in a thread owned by intra op thread pool
   *
   * \param[in] session
   * \param[in] run_options If nullptr, will use a default ::OrtRunOptions
   * \param[in] input_names Array of null terminated UTF8 encoded strings of the input names
   * \param[in] input Array of ::OrtValue%s of the input values
   * \param[in] input_len Number of elements in the input_names and inputs arrays
   * \param[in] output_names Array of null terminated UTF8 encoded strings of the output names
   * \param[in] output_names_len Number of elements in the output_names and outputs array
   * \param[out] output OrtValue* array of size output_names_len.
   *             On calling RunAsync, output[i] could either be a null or a pointer to a preallocated OrtValue.
   *             Later, the output array will be passed to run_async_callback with all null(s) filled with valid
   *             OrtValue pointer(s) allocated by onnxruntime.
   *             NOTE: it is customer's duty to finally release the output array and each of its member,
   *             regardless of whether the member (OrtValue*) is allocated by onnxruntime or preallocated by the customer.
   * \param[in] run_async_callback Callback function on model run completion
   * \param[in] user_data User data that pass back to run_async_callback
   */
  ORT_API2_STATUS(RunAsync, _Inout_ OrtSession* session, _In_opt_ const OrtRunOptions* run_options,
                  _In_reads_(input_len) const char* const* input_names,
                  _In_reads_(input_len) const OrtValue* const* input, size_t input_len,
                  _In_reads_(output_names_len) const char* const* output_names, size_t output_names_len,
                  _Inout_updates_all_(output_names_len) OrtValue** output,
                  _In_ RunAsyncCallbackFn run_async_callback, _In_opt_ void* user_data);

  /**
   * Update TensorRT EP provider option where its data type is pointer, for example 'user_compute_stream'.
   * If the data type of the provider option can be represented by string please use UpdateTensorRTProviderOptions.
   *
   * Note: It's caller's responsibility to properly manage the lifetime of the instance pointed by this pointer.
   *
   * \param tensorrt_options - OrtTensorRTProviderOptionsV2 instance
   * \param key - Name of the provider option
   * \param value - A pointer to the instance that will be assigned to this provider option
   *
   * \since Version 1.16.
   */
  ORT_API2_STATUS(UpdateTensorRTProviderOptionsWithValue, _Inout_ OrtTensorRTProviderOptionsV2* tensorrt_options, _In_ const char* key, _In_ void* value);

  /**
   * Get TensorRT EP provider option where its data type is pointer.
   * If the data type of the provider option can be represented by string please use GetTensorRTProviderOptionsAsString.
   *
   * \param tensorrt_options - OrtTensorRTProviderOptionsV2 instance
   * \param key - Name of the provider option
   * \param ptr - A pointer to the instance that is kept by the provider option
   *
   * \since Version 1.16.
   */
  ORT_API2_STATUS(GetTensorRTProviderOptionsByName, _In_ const OrtTensorRTProviderOptionsV2* tensorrt_options, _In_ const char* key, _Outptr_ void** ptr);

  /**
   * Update CUDA EP provider option where its data type is pointer, for example 'user_compute_stream'.
   * If the data type of the provider option can be represented by string please use UpdateCUDAProviderOptions.
   *
   * Note: It's caller's responsibility to properly manage the lifetime of the instance pointed by this pointer.
   *
   * \param cuda_options - OrtCUDAProviderOptionsV2 instance
   * \param key - Name of the provider option
   * \param value - A pointer to the instance that will be assigned to this provider option
   *
   * \since Version 1.16.
   */
  ORT_API2_STATUS(UpdateCUDAProviderOptionsWithValue, _Inout_ OrtCUDAProviderOptionsV2* cuda_options, _In_ const char* key, _In_ void* value);

  /**
   * Get CUDA EP provider option where its data type is pointer.
   * If the data type of the provider option can be represented by string please use GetCUDAProviderOptionsAsString.
   *
   * \param cuda_options - OrtCUDAProviderOptionsV2 instance
   * \param key - Name of the provider option
   * \param ptr - A pointer to the instance that is kept by the provider option
   *
   * \since Version 1.16.
   */
  ORT_API2_STATUS(GetCUDAProviderOptionsByName, _In_ const OrtCUDAProviderOptionsV2* cuda_options, _In_ const char* key, _Outptr_ void** ptr);

  /**
   * Get a EP resource.
   * E.g. a cuda stream or a cublas handle
   *
   * \param context - Kernel context
   * \param resource_version - Version of the resource
   * \param resource_id - Type of resource
   * \param resource - A pointer to returned resource
   *
   * \since Version 1.16.
   */
  ORT_API2_STATUS(KernelContext_GetResource, _In_ const OrtKernelContext* context, _In_ int resource_version,
                  _In_ int resource_id, _Outptr_ void** resource);

  /** \brief Set user logging function
   *
   *  By default the logger created by the CreateEnv* functions is used to create the session logger as well.
   *  This function allows a user to override this default session logger with a logger of their own choosing. This way
   *  the user doesn't have to create a separate environment with a custom logger. This addresses the problem when
   *  the user already created an env but now wants to use a different logger for a specific session (for debugging or
   *  other reasons).
   *
   * \param[in] options
   * \param[in] user_logging_function A pointer to a logging function.
   * \param[in] user_logging_param A pointer to arbitrary data passed as the ::OrtLoggingFunction `param` parameter to
   *                         `user_logging_function`. This parameter is optional.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.17.
   */
  ORT_API2_STATUS(SetUserLoggingFunction, _Inout_ OrtSessionOptions* options,
                  _In_ OrtLoggingFunction user_logging_function, _In_opt_ void* user_logging_param);

  /**
   * Get number of input from OrtShapeInferContext
   *
   * \param[in] context
   * \param[out] out The number of inputs
   *
   * \since Version 1.17.
   */
  ORT_API2_STATUS(ShapeInferContext_GetInputCount, _In_ const OrtShapeInferContext* context, _Out_ size_t* out);

  /**
   * Get type and shape info of an input
   *
   * \param[in] context
   * \param[in] index The index of the input
   * \param[out] info Type shape info of the input
   *
   * \since Version 1.17.
   */
  ORT_API2_STATUS(ShapeInferContext_GetInputTypeShape, _In_ const OrtShapeInferContext* context, _In_ size_t index, _Outptr_ OrtTensorTypeAndShapeInfo** info);

  /**
   * Get attribute from OrtShapeInferContext. Note that OrtShapeInferContext is a per-node context, one could only read attribute from current node.
   *
   * \param[in] context
   * \param[in] attr_name Name of the attribute
   * \param[out] attr Handle of the attribute fetched
   *
   * \since Version 1.17.
   */
  ORT_API2_STATUS(ShapeInferContext_GetAttribute, _In_ const OrtShapeInferContext* context, _In_ const char* attr_name, _Outptr_ const OrtOpAttr** attr);

  /**
   * Set type and shape info of an output
   *
   * \param[in] context
   * \param[in] index The index of the output
   * \param[out] info Type shape info of the output
   *
   * \since Version 1.17.
   */
  ORT_API2_STATUS(ShapeInferContext_SetOutputTypeShape, _In_ const OrtShapeInferContext* context, _In_ size_t index, _In_ const OrtTensorTypeAndShapeInfo* info);

  /**
   * Set symbolic shape to type shape info
   *
   * \param[in] info Type shape info
   * \param[in] dim_params Symbolic strings
   * \param[in] dim_params_length Number of strings
   *
   * \since Version 1.17.
   */
  ORT_API2_STATUS(SetSymbolicDimensions, _In_ OrtTensorTypeAndShapeInfo* info, _In_ const char* dim_params[], _In_ size_t dim_params_length);

  /**
   * Read contents of an attribute to data
   *
   * \param[in] op_attr
   * \param[in] type Attribute type
   * \param[out] data Memory address to save raw content of the attribute
   * \param[in] len Number of bytes allowed to store in data
   * \param[out] out Number of bytes required to save the data when the call failed, or the real number of bytes saved to data on success
   *
   * \note Does not support reading graph attributes. Refer to Node_GetSubgraphs.
   *
   * \since Version 1.17.
   */
  ORT_API2_STATUS(ReadOpAttr, _In_ const OrtOpAttr* op_attr, _In_ OrtOpAttrType type, _Inout_ void* data, _In_ size_t len, _Out_ size_t* out);

  /** \brief Set whether to use deterministic compute.
   *
   * Default is false. If set to true, this will enable deterministic compute for GPU kernels where possible.
   * Note that this most likely will have a performance cost.
   *
   * \param[in] options
   * \param[in] value
   *
   * \since Version 1.17.
   */
  ORT_API2_STATUS(SetDeterministicCompute, _Inout_ OrtSessionOptions* options, bool value);

  /**
   * Run fn in parallel
   *
   * \param[in] context
   * \param[in] fn Function accepting usr_data and an integer as iterator
   * \param[in] total The number of times fn is to be invoked
   * \param[in] num_batch Number of batches by which the "total" is to be divided in maximum. When zero, there is no limit
   * \param[in] usr_data User data to be passed back to fn
   *
   * \since Version 1.17.
   */
  ORT_API2_STATUS(KernelContext_ParallelFor, _In_ const OrtKernelContext* context, _In_ void (*fn)(void*, size_t), _In_ size_t total, _In_ size_t num_batch, _In_ void* usr_data);

  /** \brief Append OpenVINO execution provider to the session options
   *
   * If OpenVINO is not available (due to a non OpenVINO enabled build, or if OpenVINO is not installed on the system), this function will fail.
   *
   * \param[in] options
   * \param[in] provider_options_keys
   * \param[in] provider_options_values
   * \param[in] num_keys
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.17.
   */
  ORT_API2_STATUS(SessionOptionsAppendExecutionProvider_OpenVINO_V2,
                  _In_ OrtSessionOptions* options,
                  _In_reads_(num_keys) const char* const* provider_options_keys,
                  _In_reads_(num_keys) const char* const* provider_options_values,
                  _In_ size_t num_keys);

  /** \brief Append VitisAI provider to session options
   *
   * If VitisAI is not available (due to a non VitisAI enabled build, or if VitisAI is not installed on the system), this function will return failure.
   *
   * \param[in] options
   * \param[in] provider_options_keys
   * \param[in] provider_options_values
   * \param[in] num_keys
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.18.
   */
  ORT_API2_STATUS(SessionOptionsAppendExecutionProvider_VitisAI,
                  _In_ OrtSessionOptions* options,
                  _In_reads_(num_keys) const char* const* provider_options_keys,
                  _In_reads_(num_keys) const char* const* provider_options_values,
                  _In_ size_t num_keys);

  /** \brief Get scratch buffer from the corresponding allocator under the specific OrtMemoryInfo object.
   *         NOTE: callers are responsible to release this scratch buffer from the corresponding allocator
   *  \param[in] context OrtKernelContext instance
   *  \param[in] mem_info OrtMemoryInfo instance
   *  \param[in] count_or_bytes How many bytes is this scratch buffer
   *  \param[out] out A pointer to the scratch buffer
   *
   *  \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.18.
   */
  ORT_API2_STATUS(KernelContext_GetScratchBuffer, _In_ const OrtKernelContext* context, _In_ const OrtMemoryInfo* mem_info, _In_ size_t count_or_bytes, _Outptr_ void** out);

  /** \brief Get allocator from KernelInfo for a specific memory type. Please use C API ReleaseAllocator to release out object
   *
   * \param[in] info OrtKernelInfo instance
   * \param[in] mem_type OrtMemType object
   * \param[out] out A pointer to OrtAllocator
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.18.
   */
  ORT_API2_STATUS(KernelInfoGetAllocator, _In_ const OrtKernelInfo* info, _In_ OrtMemType mem_type, _Outptr_ OrtAllocator** out);

  /** \brief Replace initialized Tensors with external data with the provided files in memory
   *
   * The function will find the initialized TensorProtos with external data in the graph with the provided
   * external file names and the file content in memory. The API gets the external file name, offset, data length
   * from TensorProto, and locate the tensor data from the file in memory buffer.
   * It creates a Tensor to replace the existing Tensor in graph. The replacement
   * will occur before any of the optimizations take place. The data will be copied into the graph
   * since TensorProto can't refer to the user provided buffers.
   *
   * \param[in] options
   * \param[in] external_initializer_file_names Array of null terminated UTF-8 encoded strings of the file names
   *            which holds the external initializers.
   * \param[in] external_initializer_file_buffer_array Array of pointers to the buffer of the file content.
   *            The buffer can be freed after session creation.
   * \param[in] external_initializer_file_lengths Array of size_t to indicate the length of file content
   * \param[in] num_external_initializer_files Number of external files
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.18.
   */
  ORT_API2_STATUS(AddExternalInitializersFromFilesInMemory, _In_ OrtSessionOptions* options,
                  _In_reads_(num_external_initializer_files) const ORTCHAR_T* const* external_initializer_file_names,
                  _In_reads_(num_external_initializer_files) char* const* external_initializer_file_buffer_array,
                  _In_reads_(num_external_initializer_files) const size_t* external_initializer_file_lengths,
                  size_t num_external_initializer_files);

  /** \brief Create an OrtLoraAdapter
   *
   * The function attempts to locate file specified by adapter_file_path, read it and create an OrtLoraAdapter
   * instance. The adapter_file_path should be a valid path to a file that contains a valid Lora Adapter
   * format. The function attempts to validate the format at load time. The file will always be memory mapped, unless
   * the platform does not support memory mapping, in which case the file will be read into memory.
   *
   * \param[in] adapter_file_path adapter file path.
   * \param[in] allocator optional pointer to a device allocator. If specified
   *            data is copied to the device at some point before Run() is invoked. If nullptr, data stays on CPU.
   *            The data would still be copied to device if required by the model at inference time.
   * \param[out] out A pointer to a newly created OrtLoraAdapter instance. Must be released with
   *                  OrtApi::ReleaseLoraAdapter.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.20.
   */
  ORT_API2_STATUS(CreateLoraAdapter, const ORTCHAR_T* adapter_file_path, _In_ OrtAllocator* allocator,
                  _Outptr_ OrtLoraAdapter** out);

  /** \brief Create an OrtLoraAdapter
   *
   * The function copies the bytes from the array and creates an OrtLoraAdapter instance.
   *
   *
   * \param[in] bytes pointer to a valid Lora Adapter format buffer.
   * \param[in] num_bytes length of bytes buffer.
   * \param[in] allocator optional pointer to a device allocator. If specified
   *            data is copied to the device at some point before Run() is invoked. If nullptr, data stays on CPU.
   *            The data would still be copied to device if required by the model at inference time.
   * \param[out] out A pointer to a newly created OrtLoraAdapter instance. Must be released with
   *                  OrtApi::ReleaseLoraAdapter.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.20.
   */
  ORT_API2_STATUS(CreateLoraAdapterFromArray, _In_ const void* bytes, size_t num_bytes, _In_ OrtAllocator* allocator,
                  _Outptr_ OrtLoraAdapter** out);

  /** \brief Release an ::OrtLoraAdapter obtained from OrtApi::CreateLoraAdapter
   */
  ORT_CLASS_RELEASE(LoraAdapter);

  /** \brief Add the Lora Adapter to the list of active adapters.
   *
   * The function adds the Lora Adapter to the list of active adapters. The Lora Adapter must be created with
   * OrtApi::CreateLoraAdapter or FromArray. The Lora Adapter will be used by the session to run the model.
   * The instance of the OrtRunOptions can then be used to customize the Run() calls.
   * More than one OrtLoraAdapter can be active at the same time. Lora Parameters that belong to different
   * Lora adapters that will be active at the same time must not overlap.
   * This setting does not affect RunWithBinding.
   *
   * \param[in] options OrtRunOptions instance
   * \param[in] adapter OrtLoraAdapter instance
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.20.
   */
  ORT_API2_STATUS(RunOptionsAddActiveLoraAdapter, _Inout_ OrtRunOptions* options, _In_ const OrtLoraAdapter* adapter);

  /// @}
  /// \name OrtEpDynamicOptions
  /// @{

  /** \brief Set DynamicOptions for EPs (Execution Providers)
   *
   * Valid options can be found in `include\onnxruntime\core\session\onnxruntime_session_options_config_keys.h`
   * Look for `kOrtEpDynamicOptions`
   *
   * \param[in] sess OrtSession
   * \param[in] keys Array of null terminated UTF8 encoded strings of EP dynamic option keys
   * \param[in] values Array of null terminated UTF8 encoded string of EP dynamic option values
   * \param[in] kv_len Number of elements in the keys and values arrays
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.20.
   */
  ORT_API2_STATUS(SetEpDynamicOptions, _Inout_ OrtSession* sess, _In_reads_(kv_len) const char* const* keys,
                  _In_reads_(kv_len) const char* const* values, _In_ size_t kv_len);

  /// @}

  /** \brief Release an OrtValueInfo instance if it was not added to an OrtGraph.
   * \since Version 1.22.
   */
  ORT_CLASS_RELEASE(ValueInfo);

  /** \brief Release an OrtNode if it was not added to an OrtGraph.
   * \since Version 1.22.
   */
  ORT_CLASS_RELEASE(Node);

  /** \brief Release an OrtGraph.
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.22.
   */
  ORT_CLASS_RELEASE(Graph);

  /** \brief Release an OrtModel.
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.22.
   */
  ORT_CLASS_RELEASE(Model);

  /** \brief Get the value name from an OrtValueInfo instance.
   * \param[in] value_info The OrtValueInfo instance.
   * \param[out] name The name of the OrtValueInfo
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.22.
   */
  ORT_API2_STATUS(GetValueInfoName, _In_ const OrtValueInfo* value_info, _Out_ const char** name);

  /** \brief Get the type information from an OrtValueInfo instance.
   * \param[in] value_info The OrtValueInfo instance.
   * \param[out] type_info The type info of the OrtValueInfo
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.22.
   */
  ORT_API2_STATUS(GetValueInfoTypeInfo, _In_ const OrtValueInfo* value_info, _Outptr_ const OrtTypeInfo** type_info);

  /** \brief Get the Model Editor API instance
   *
   * Get the Model Editor API instance to create a new model or augment an existing model.
   *
   * \return Model Editor API struct
   *
   * \since Version 1.22.
   */
  const OrtModelEditorApi*(ORT_API_CALL* GetModelEditorApi)(void);

  /** \brief Create an OrtValue for a Tensor that uses pre-existing memory.
   *
   * ORT will take ownership of the memory and free it using the provided deleter when no longer in use.
   *
   * \param[in] deleter OrtAllocator instance that will be used to free the memory.
   *                    Only the OrtAllocator:Info and OrtAllocator::Release functions are required.
   *                    The OrtMemoryInfo returned by OrtAllocator::Info must match the location of p_data.
   * \param[in] p_data Pointer to the memory that will be used by the Tensor. ORT will take ownership of the memory.
   * \param[in] p_data_len Length of the memory in bytes.
   * \param[in] shape Dimensions of the Tensor. All values should be > 0.
   * \param[in] shape_len Number of dimensions in the shape array.
   * \param[in] type Data type of the Tensor.
   * \param[out] out Newly created ::OrtValue. Must be freed with OrtApi::ReleaseValue
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(CreateTensorWithDataAndDeleterAsOrtValue, _In_ OrtAllocator* deleter,
                  _In_ void* p_data, size_t p_data_len,
                  _In_ const int64_t* shape, size_t shape_len,
                  ONNXTensorElementDataType type,
                  _Outptr_ OrtValue** out);

  /** \brief sets load cancellation flag to abort session loading process.
   *
   * \param[in] options instance that was passed to the session at creation time.
   * \param[in] cancel setting this to true after model loading process was initiated will
   *            attempt to cancel the loading process. If cancellation is successful, CreateSession()
   *            CreateSessionFromArray() or any other session creation API that take session options as an
   *            argument will return an OrtStatus indicating that session loading was canceled at user request,
   *            error code ORT_MODEL_LOAD_CANCELED.
   *            The APIs above would not return any valid Session instance. This is the best case effort and the result
   *            is not guaranteed. The session may have already been created and initialized
   *            before the cancellation request was issued.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(SessionOptionsSetLoadCancellationFlag, _Inout_ OrtSessionOptions* options,
                  _In_ bool cancel);

  /** \brief Get the Compile API instance.
   *
   * Get the Compile API instance to compile ONNX models. Execution providers that support compilation fuse a subgraph
   * into an EPContext node that wraps a provider-specific binary representation of the subgraph.
   * For more details about the EPContext design, refer to:
   *  \htmlonly
   *  <a href="https://onnxruntime.ai/docs/execution-providers/EP-Context-Design.html">EPContext design document.</a>
   *  \endhtmlonly
   *
   * \return Compile API struct instance.
   *
   * \since Version 1.22.
   */
  const OrtCompileApi*(ORT_API_CALL* GetCompileApi)(void);

  //
  // OrtKeyValuePairs
  //

  /** \brief Create an OrtKeyValuePairs instance.
   *
   * \param[out] out A pointer to a newly created OrtKeyValuePairs instance.
   *
   * \note Must be released by calling ReleaseKeyValuePairs.
   *
   * \since Version 1.22.
   */
  void(ORT_API_CALL* CreateKeyValuePairs)(_Outptr_ OrtKeyValuePairs** out);

  /** \brief Add a key-value pair to the OrtKeyValuePairs instance.
   *
   * If a pair with the same key already exists, it is overwritten.
   *
   * \param[in] kvps OrtKeyValuePairs instance.
   * \param[in] key Key to be added.
   * \param[in] value Value to be added.
   *
   * \note The `key` and `value` are copied internally.
   *
   * \since Version 1.22.
   */

  void(ORT_API_CALL* AddKeyValuePair)(_In_ OrtKeyValuePairs* kvps, _In_ const char* key, _In_ const char* value);

  /** \brief Get the value associated with a key in the OrtKeyValuePairs instance.
   *
   * \param[in] kvps OrtKeyValuePairs instance.
   * \param[in] key Key to be searched.
   *
   * \return The value associated with the key, or nullptr if the key does not exist.
   *
   * \since Version 1.22.
   */
  const char*(ORT_API_CALL* GetKeyValue)(_In_ const OrtKeyValuePairs* kvps, _In_ const char* key);

  /** \brief Get all the key-value pairs from the OrtKeyValuePairs instance.
   *
   * \param[in] kvps OrtKeyValuePairs instance.
   * \param[out] keys Array of keys from `kvps`.
   * \param[out] values Array of values from `kvps`.
   * \param[out] num_entries Number of entries in `keys` and `values`.
   *
   * \since Version 1.22.
   */
  void(ORT_API_CALL* GetKeyValuePairs)(_In_ const OrtKeyValuePairs* kvps,
                                       _Outptr_ const char* const** keys, _Outptr_ const char* const** values,
                                       _Out_ size_t* num_entries);

  /** \brief Remove a key-value pair from the OrtKeyValuePairs instance.
   *
   * \param[in] kvps OrtKeyValuePairs instance.
   * \param[in] key Key to be removed. No error if not found.
   *
   * \since Version 1.22.
   */
  void(ORT_API_CALL* RemoveKeyValuePair)(_In_ OrtKeyValuePairs* kvps, _In_ const char* key);

  /** \brief Release an OrtKeyValuePairs instance.
   *
   * \param[in] input OrtKeyValuePairs instance to be released.
   *
   * \since Version 1.22.
   */
  ORT_CLASS_RELEASE(KeyValuePairs);

  /** \brief Register an execution provider library with ORT.
   *
   * The library must export 'CreateEpFactories' and 'ReleaseEpFactory' functions.
   * See OrtEpApi for more details.
   *
   * \param[in] env The OrtEnv instance to register the library in.
   * \param[in] registration_name The name to register the execution provider library under.
   * \param[in] path The path to the execution provider library.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(RegisterExecutionProviderLibrary, _In_ OrtEnv* env, _In_ const char* registration_name,
                  _In_ const ORTCHAR_T* path);

  /** \brief Unregister an execution provider library with ORT.
   *
   * ORT will call ReleaseEpFactory for all factories created by the library, and unload the library.
   *
   * You <b>MUST</b> ensure there are no Session instances using execution providers created by the library
   * before calling this function.
   *
   * \param[in] env The OrtEnv instance to unregister the library from.
   * \param[in] registration_name The name the execution provider library was registered under.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(UnregisterExecutionProviderLibrary, _In_ OrtEnv* env, _In_ const char* registration_name);

  /** \brief Get the list of available OrtEpDevice instances.
   *
   * Each OrtEpDevice instance contains details of the execution provider and the device it will use.
   *
   * \param[in] env The OrtEnv instance to query.
   * \param[out] ep_devices The OrtEpDevice instances that the execution provider will use.
   * \param[out] num_ep_devices The number of OrtEpDevice instances returned.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(GetEpDevices, _In_ const OrtEnv* env,
                  _Outptr_ const OrtEpDevice* const** ep_devices, _Out_ size_t* num_ep_devices);

  /** \brief Append the execution provider that is responsible for the selected OrtEpDevice instances
   *         to the session options.
   *
   * \param[in] session_options Session options to add execution provider to.
   * \param[in] env Environment that execution providers were registered with.
   * \param[in] ep_devices One or more OrtEpDevice instances to create an execution provider for.
   *                       Obtain from GetEpDevices. All OrtEpDevice instances must be from the same execution
   *                       provider. It is only necessary to provide multiple OrtEpDevices if you want to use the
   *                       same execution provider for multiple devices.
   *                       e.g. the EP is capable of running on GPU and NPU.
   * \param[in] num_ep_devices Number of OrtEpDevice instances.
   * \param[in] ep_option_keys Optional keys to configure the execution provider.
   * \param[in] ep_option_vals Optional values to configure the execution provider.
   * \param[in] num_ep_options Number of execution provide options to add.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(SessionOptionsAppendExecutionProvider_V2, _In_ OrtSessionOptions* session_options,
                  _In_ OrtEnv* env,
                  _In_reads_(num_ep_devices) const OrtEpDevice* const* ep_devices, _In_ size_t num_ep_devices,
                  _In_reads_(num_op_options) const char* const* ep_option_keys,
                  _In_reads_(num_op_options) const char* const* ep_option_vals,
                  size_t num_ep_options);

  /** \brief Set the execution provider selection policy for the session.
   *
   * Allows users to specify a device selection policy for automatic execution provider (EP) selection.
   * If custom selection is required please use SessionOptionsSetEpSelectionPolicyDelegate instead.
   *
   * \param[in] session_options The OrtSessionOptions instance.
   * \param[in] policy The device selection policy to use (see OrtExecutionProviderDevicePolicy).
   *
   * \since Version 1.22
   */
  ORT_API2_STATUS(SessionOptionsSetEpSelectionPolicy, _In_ OrtSessionOptions* session_options,
                  _In_ OrtExecutionProviderDevicePolicy policy);

  /** \brief Set the execution provider selection policy delegate for the session.
   *
   * Allows users to provide a custom device selection policy for automatic execution provider (EP) selection.
   *
   * \param[in] session_options The OrtSessionOptions instance.
   * \param[in] delegate Delegate callback for custom selection.
   * \param[in] delegate_state Optional state that will be passed to the delegate callback. nullptr if not required.
   *
   * \since Version 1.22
   */
  ORT_API2_STATUS(SessionOptionsSetEpSelectionPolicyDelegate, _In_ OrtSessionOptions* session_options,
                  _In_ EpSelectionDelegate delegate,
                  _In_opt_ void* delegate_state);

  /** \brief Get the hardware device type.
   *
   * \param[in] device The OrtHardwareDevice instance to query.
   * \return The hardware device type.
   *
   * \since Version 1.22.
   */
  OrtHardwareDeviceType(ORT_API_CALL* HardwareDevice_Type)(_In_ const OrtHardwareDevice* device);

  /** \brief Get the hardware device's vendor identifier.
   *
   * \param[in] device The OrtHardwareDevice instance to query.
   * \return The hardware device vendor identifier.
   *
   * \since Version 1.22.
   */
  uint32_t(ORT_API_CALL* HardwareDevice_VendorId)(_In_ const OrtHardwareDevice* device);

  /** \brief Get the hardware device's vendor name.
   *
   * \param[in] device The OrtHardwareDevice instance to query.
   * \return The hardware device's vendor name.
   *
   * \since Version 1.22.
   */
  const char*(ORT_API_CALL* HardwareDevice_Vendor)(_In_ const OrtHardwareDevice* device);

  /** \brief Get the hardware device's unique identifier.
   *
   * \param[in] device The OrtHardwareDevice instance to query.
   * \return The device id.
   *
   * \note This is not a unique identifier. It identifies the hardware type when combined with vendor id.
   * \since Version 1.22.
   */
  uint32_t(ORT_API_CALL* HardwareDevice_DeviceId)(_In_ const OrtHardwareDevice* device);

  /** \brief Get hardware device metadata.
   *
   * \param[in] device The OrtHardwareDevice instance to query.
   * \return An OrtKeyValuePairs instance containing the metadata for the device.
   *         Note: ORT owns the instance so the user must not call ReleaseKeyValuePairs with it.
   *
   * \since Version 1.22.
   */
  const OrtKeyValuePairs*(ORT_API_CALL* HardwareDevice_Metadata)(_In_ const OrtHardwareDevice* device);

  /** \brief Get the execution provider name.
   *
   * \param[in] ep_device The OrtEpDevice instance to query.
   * \return The execution provider name.
   *
   * \since Version 1.22.
   */
  const char*(ORT_API_CALL* EpDevice_EpName)(_In_ const OrtEpDevice* ep_device);

  /** \brief Get the execution provider's vendor name.
   *
   * \param[in] ep_device The OrtEpDevice instance to query.
   * \return The execution provider's vendor name.
   *
   * \since Version 1.22.
   */
  const char*(ORT_API_CALL* EpDevice_EpVendor)(_In_ const OrtEpDevice* ep_device);

  /** \brief Get the metadata for the OrtEpDevice.
   *
   * \param[in] ep_device The OrtEpDevice instance to query.
   * \return An OrtKeyValuePairs instance containing the metadata for the device.
   *
   * \since Version 1.22.
   */
  const OrtKeyValuePairs*(ORT_API_CALL* EpDevice_EpMetadata)(_In_ const OrtEpDevice* ep_device);

  /** \brief Get the execution provider options for the OrtEpDevice.
   *
   * \param[in] ep_device The OrtEpDevice instance to query.
   * \return An OrtKeyValuePairs instance containing the execution provider options for the device.
   *
   * \since Version 1.22.
   */
  const OrtKeyValuePairs*(ORT_API_CALL* EpDevice_EpOptions)(_In_ const OrtEpDevice* ep_device);

  /** \brief Get the OrtHardwareDevice instance for the OrtEpDevice.
   *
   * \param[in] ep_device The OrtEpDevice instance to query.
   * \return The OrtHardwareDevice instance for the device.
   *
   * \since Version 1.22.
   */
  const OrtHardwareDevice*(ORT_API_CALL* EpDevice_Device)(_In_ const OrtEpDevice* ep_device);

  /** \brief Get the OrtEpApi instance for implementing an execution provider.
   *
   * \since Version 1.22.
   */
  const OrtEpApi*(ORT_API_CALL* GetEpApi)(void);

  /** \brief Compute total size in bytes of the tensor data contained in an OrtValue.
   *
   * Returns the total number of bytes used to store the tensor data. For numeric tensors,
   * this is sizeof(element_type) * total_element_count. OrtValues that are not tensors or
   * that are tensors that contain strings will cause an error to be returned.
   *
   * \param[in] ort_value OrtValue instance containing a tensor
   * \param[out] size The total size of the tensor data in bytes
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23
   */
  ORT_API2_STATUS(GetTensorSizeInBytes, _In_ const OrtValue* ort_value, _Out_ size_t* size);

  /** \brief Calls OrtAllocator::GetStats function
   *
   * Return a pointer to the OrtKeyValuePairs structure that contains the statistics of the allocator
   * and the user should call OrtApi::ReleaseKeyValuePairs.
   *
   * NOTE: If the allocator does not implement this function, the OrtKeyValuePairs instance will be empty.
   *
   * \param[in] ort_allocator The allocator to get stats from
   * \param[out] out A pointer to the OrtKeyValuePairs instance that contains the stats
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(AllocatorGetStats, _In_ const OrtAllocator* ort_allocator, _Outptr_ OrtKeyValuePairs** out);

  /** \brief Create an ::OrtMemoryInfo
   *
   * \param[in] name Arbitrary name.
   * \param[in] device_type Device type.
   * \param[in] vendor_id PCI Vendor ID. Use 0 for a generic allocator (e.g. WebGPU).
   * \param[in] device_id Device ID if there are multiple devices of the same type. e.g. 2 GPU devices.
   * \param[in] mem_type Memory type. Use OrtDeviceMemoryType_DEFAULT for device memory, and
   *                     OrtDeviceMemoryType_HOST_ACCESSIBLE (if applicable) for memory used to transfer between the
   *                     device and the CPU. Use the device_type and device_id of the GPU/NPU that the memory is also
   *                     accessible to.
   * \param[in] alignment Alignment of the memory if required. Pass 0 for default alignment.
   * \param[in] allocator_type Allocator type. If OrtAllocatorType::OrtArenaAllocator, the ORT arena will be used.
   *                           Caveat: Support for OrtArenaAllocator is currently limited to usage of internal ORT
   *                           allocators via CreateAllocator/CreateAndRegisterAllocator/CreateAndRegisterAllocatorV2.
   * \param[out] out Newly created ::OrtMemoryInfo. Must be freed with OrtApi::ReleaseMemoryInfo
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23
   */
  ORT_API2_STATUS(CreateMemoryInfo_V2, _In_ const char* name, _In_ enum OrtMemoryInfoDeviceType device_type,
                  _In_ uint32_t vendor_id, _In_ int32_t device_id, _In_ enum OrtDeviceMemoryType mem_type,
                  _In_ size_t alignment, enum OrtAllocatorType allocator_type,
                  _Outptr_ OrtMemoryInfo** out);

  /** \brief Get the device memory type from ::OrtMemoryInfo
   *
   * \param[in] ptr The OrtMemoryInfo instance to query.
   * \return The device memory type.
   *
   * \since Version 1.23
   */
  ORT_API_T(OrtDeviceMemoryType, MemoryInfoGetDeviceMemType, _In_ const OrtMemoryInfo* ptr);

  /** \brief Get the vendor id from ::OrtMemoryInfo
   *
   * \param[in] ptr The OrtMemoryInfo instance to query.
   * \return The vendor id.
   *
   * \since Version 1.23
   */
  ORT_API_T(uint32_t, MemoryInfoGetVendorId, _In_ const OrtMemoryInfo* ptr);

  /// \name OrtValueInfo
  /// @{

  /** \brief Get the OrtNode that produces the value represented by the given OrtValueInfo.
   * Optionally returns the associated output index.
   *
   * \param[in] value_info The OrtValueInfo instance.
   * \param[out] producer_node Output parameter set to the OrtNode that produces the OrtValueInfo.
   * \param[out] producer_output_index Optional output parameter set to the OrtNode instance's output index
   *                                   that produces the value. Ignored if set to NULL.
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.23.
   */
  ORT_API2_STATUS(ValueInfo_GetValueProducer, _In_ const OrtValueInfo* value_info,
                  _Outptr_ const OrtNode** producer_node, _Out_opt_ size_t* producer_output_index);

  /** \brief Get the number of consumers of a value as a node input.
   *
   * Only nodes are considered "consumers" by this function. To check if an OrtValueInfo is a graph output,
   * call ValueInfo_IsGraphOutput().
   *
   * A single OrtNode may use a single value for more than one input (e.g., Mul(x, x)), so the returned
   * `num_consumers` may be larger than the number of unique OrtNode instances that consume the value.
   *
   * \param[in] value_info The OrtValueInfo instance.
   * \param[out] num_consumers Output parameter set to the number of consumers of the value.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(ValueInfo_GetValueNumConsumers, _In_ const OrtValueInfo* value_info, _Out_ size_t* num_consumers);

  /** \brief Returns information (OrtNode and input index) for all consumer nodes that use the value as an input.
   *
   * Only nodes are considered "consumers" by this function.
   *
   * Caller provides 2 pre-allocated arrays that will be filled with the OrtNode and input index values.
   * Use ValueInfo_GetValueNumConsumers() to get the number of consumers of the value.
   *
   * An OrtNode instance may appear multiple times if it uses the given value more than once.
   * Example: For a node MulNode(x, x) that consumes the value 'x' twice, the following is returned:
   *   - nodes: [MulNode, MulNode]
   *   - input_indices: [0, 1]
   *
   * \param[in] value_info The OrtValueInfo instance.
   * \param[out] nodes Pre-allocated array of size `num_consumers` that is filled with OrtNode instances.
   * \param[out] input_indices Pre-allocated array of `num_consumers` elements that is filled
   *                           with input indices. Index is set to -1 for an "implicit" input to a consumer node
   *                           that contains a subgraph (e.g., If, Loop) with nodes that use the value internally.
   * \param[in] num_consumers The size of the `consumer_nodes` and `consumer_input_indices` arrays.
   *                          Typical usage sets this to the value of ValueInfo_GetValueNumConsumers().
   *                          An error status is returned if `num_consumers` is less than the number of actual
   *                          consumers.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(ValueInfo_GetValueConsumers, _In_ const OrtValueInfo* value_info,
                  _Out_writes_all_(num_consumers) const OrtNode** nodes,
                  _Out_writes_all_(num_consumers) int64_t* input_indices,
                  _In_ size_t num_consumers);

  /** \brief Get the underlying initializer value, as an OrtValue, from the given OrtValueInfo.
   *
   * Sets the output parameter to NULL if the given OrtValueInfo does not represent an initializer.
   * Does not return an error status in this case.
   *
   * Supports initializers defined in an outer scope (i.e., a parent graph).
   *
   * Supports initializers stored in an external file. For external initializers, ORT memory maps
   * the initializer data on the first call to this function. If caller needs custom memory mapping,
   * use ValueInfo_GetExternalInitializerInfo to get the location of the initializer data.
   *
   * \param[in] value_info The OrtValueInfo instance.
   * \param[out] initializer_value Output parameter set to the initializer value or NULL. Do not cache the OrtValue
   *                               as it is released when the owning OrtGraph is released.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(ValueInfo_GetInitializerValue, _In_ const OrtValueInfo* value_info,
                  _Outptr_ const OrtValue** initializer_value);

  /** \brief Get information about an external initializer (e.g., filepath, file offset, byte size).
   *
   * Sets the output parameter `info` to NULL if the given OrtValueInfo does not represent an initializer
   * with external data. In this case, a NULL status (non-error) is returned.
   *
   * \param[in] value_info The OrtValueInfo instance.
   * \param[out] info Output parameter set to an OrtExternalInitializerInfo instance that can be used to query
   *                  file path, file offset, etc. ORT sets this to NULL if the OrtValueInfo does not represent
   *                  an external initializer.
   *                  Must release with ReleaseExternalInitializerInfo.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(ValueInfo_GetExternalInitializerInfo, _In_ const OrtValueInfo* value_info,
                  _Outptr_result_maybenull_ OrtExternalInitializerInfo** info);

  /** \brief Returns a boolean indicating if the given value is a required graph input.
   *
   * For ONNX IR version < 4, all graph inputs without a matching initializer are required.
   *
   * For ONNX IR version >=4, a graph input with a matching initializer is an optional graph input
   * with the initializer serving as the default value.
   *
   * \param[in] value_info The OrtValueInfo instance representing the graph value.
   * \param[out] is_required_graph_input Output parameter set to true if the graph value is a required graph input.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(ValueInfo_IsRequiredGraphInput, _In_ const OrtValueInfo* value_info,
                  _Out_ bool* is_required_graph_input);

  /** \brief Returns a boolean indicating if the given value is an optional graph input.
   *
   * Optional graph inputs were introduced in ONNX IR version 4. For ONNX IR version >=4, a graph input with a
   * matching initializer is an optional graph input with the initializer serving as the default value.
   * The matching initializer is also known as a non-constant initializer.
   *
   * \param[in] value_info The OrtValueInfo instance representing the graph value.
   * \param[out] is_optional_graph_input Output parameter set to true if the graph value is an optional graph input.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(ValueInfo_IsOptionalGraphInput, _In_ const OrtValueInfo* value_info,
                  _Out_ bool* is_optional_graph_input);

  /** \brief Returns a boolean indicating if the given value is a graph output.
   *
   * \param[in] value_info The OrtValueInfo instance representing the graph value.
   * \param[out] is_graph_output Output parameter set to true if the graph value is a graph output.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(ValueInfo_IsGraphOutput, _In_ const OrtValueInfo* value_info, _Out_ bool* is_graph_output);

  /** \brief Returns a boolean indicating if the given value is a constant initializer.
   *
   * For ONNX IR version < 4, all initializers are constant.
   *
   * For ONNX IR version >=4, an initializer that serves as the default value for a matching graph input is not a
   * constant initializer.
   *
   * \param[in] value_info The OrtValueInfo instance representing the graph value.
   * \param[out] is_constant_initializer Output parameter set to true if the graph value is a constant initializer.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(ValueInfo_IsConstantInitializer, _In_ const OrtValueInfo* value_info,
                  _Out_ bool* is_constant_initializer);

  /** \brief Returns a boolean indicating if the given value is defined in an outer scope.
   *
   * Certain operator types (e.g., If and Loop) contain nested subgraphs. This function enables
   * determining whether a value is defined in a parent node's graph.
   *
   * \param[in] value_info The OrtValueInfo instance representing the graph value.
   * \param[out] is_from_outer_scope Output parameter set to true if the value is defined in an outer
   *                                 scope (i.e., a parent graph).
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(ValueInfo_IsFromOuterScope, _In_ const OrtValueInfo* value_info,
                  _Out_ bool* is_from_outer_scope);

  /// @}

  /// \name OrtGraph
  /// @{

  /** \brief Returns a graph's name.
   *
   * \param[in] graph The OrtGraph instance.
   * \param[out] graph_name Output parameter set to the graph's name.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Graph_GetName, _In_ const OrtGraph* graph, _Outptr_ const char** graph_name);

  /** \brief Get the filepath to the model from which an OrtGraph is constructed.
   *
   * \note The model's filepath is empty if the filepath is unknown, such as when the model is loaded from bytes
   * via CreateSessionFromArray.
   *
   * \param[in] graph The OrtGraph instance.
   * \param[out] model_path Output parameter set to the model's null-terminated filepath.
   *                        Set to an empty path string if unknown.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Graph_GetModelPath, _In_ const OrtGraph* graph, _Outptr_ const ORTCHAR_T** model_path);

  /** \brief Returns the ONNX IR version.
   *
   * \param[in] graph The OrtGraph instance.
   * \param[out] onnx_ir_version Output parameter set to the ONNX IR version.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Graph_GetOnnxIRVersion, _In_ const OrtGraph* graph, _Out_ int64_t* onnx_ir_version);

  /** \brief Returns the number of operator sets that the graph's model uses.
   *
   * \note An operator set is uniquely identified by the (domain, opset_version) pair. All models must have at
   * least one entry that specifies which entry of the ONNX operator set is used. The ONNX domain is represented by
   * an empty string.
   *
   * \param[in] graph The OrtGraph instance.
   * \param[out] num_operator_sets Output parameter set to the number of operator sets that the graph's model uses.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Graph_GetNumOperatorSets, _In_ const OrtGraph* graph, _Out_ size_t* num_operator_sets);

  /** \brief Returns the operator sets that the graph's model uses.
   *
   * \note An operator set is uniquely identified by the (domain, opset_version) pair. All models must have at
   * least one entry that specifies which entry of the ONNX operator set is used. The ONNX domain is represented by
   * an empty string.
   *
   * \param[in] graph The OrtGraph instance.
   * \param[out] domains Pre-allocated array of `num_operator_sets` elements that is filled with
   *                     null-terminated domain names.
   * \param[out] opset_versions Pre-allocated array of `num_operator_sets` elements that is filled with
   *                            the opset version of the corresponding domain in the `domains` array.
   * \param[in] num_operator_sets The size of the `domains` and `opset_versions` arrays.
   *                              Typical usage sets this to the result of Graph_GetNumOperatorSets().
   *                              An error status is returned if `num_operator_sets` is less than the actual number
   *                              of operator sets.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Graph_GetOperatorSets, _In_ const OrtGraph* graph,
                  _Out_writes_(num_operator_sets) const char** domains,
                  _Out_writes_(num_operator_sets) int64_t* opset_versions, _In_ size_t num_operator_sets);

  /** \brief Returns the number of graph inputs.
   *
   * \note The count includes initializers that are included in the list of graph inputs.
   *
   * \param[in] graph The OrtGraph instance.
   * \param[out] num_inputs Output parameter set to the number of graph inputs.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Graph_GetNumInputs, _In_ const OrtGraph* graph, _Out_ size_t* num_inputs);

  /** \brief Returns the graph's inputs as OrtValueInfo instances.
   *
   * \note The result includes initializers that are included in the list of graph inputs.
   *
   * \param[in] graph The OrtGraph instance.
   * \param[out] inputs Pre-allocated array of `num_inputs` elements that is filled with the graph's inputs.
   * \param[in] num_inputs The size of the `inputs` array.
   *                       Typical usage sets this to the result of Graph_GetNumInputs(). An error status is
   *                       returned if `num_inputs` is less than the number of graph inputs.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Graph_GetInputs, _In_ const OrtGraph* graph,
                  _Out_writes_(num_inputs) const OrtValueInfo** inputs, _In_ size_t num_inputs);

  /** \brief Returns the number of graph outputs.
   *
   * \param[in] graph The OrtGraph instance.
   * \param[out] num_outputs Output parameter set to the number of graph outputs.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Graph_GetNumOutputs, _In_ const OrtGraph* graph, _Out_ size_t* num_outputs);

  /** \brief Returns the graph's outputs as OrtValueInfo instances.
   *
   * \param[in] graph The OrtGraph instance.
   * \param[out] outputs Pre-allocated array of `num_outputs` elements that is filled with the graph's outputs.
   * \param[in] num_outputs The size of the `outputs` array.
   *                        Typical usage sets this to the result of Graph_GetNumOutputs(). An error status is
   *                        returned if `num_outputs` is less than the number of graph outputs.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Graph_GetOutputs, _In_ const OrtGraph* graph,
                  _Out_writes_(num_outputs) const OrtValueInfo** outputs, _In_ size_t num_outputs);

  /** \brief Returns the number of graph initializers.
   *
   * Counts constant and non-constant initializers.
   *
   * \param[in] graph The OrtGraph instance.
   * \param[out] num_initializers Output parameter set to the number of graph initializers.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Graph_GetNumInitializers, _In_ const OrtGraph* graph, _Out_ size_t* num_initializers);

  /** \brief Returns the graph's initializers as OrtValueInfo instances.
   *
   * Includes constant and non-constant initializers.
   *
   * For ONNX IR version < 4, all initializers are constant.
   *
   * For ONNX IR version >= 4, an initializer with a name that matches a graph input is considered a
   * non-constant initializer.
   *
   * Call ValueInfo_GetInitializerValue to get the initializer's data.
   *
   * \param[in] graph The OrtGraph instance.
   * \param[out] initializers Pre-allocated array of `num_outputs` elements that is filled with the initializers.
   * \param[in] num_initializers The size of the `initializers` array. Typical usage sets this to the
   *                             result of Graph_GetNumInitializers(). An error status is returned if
   *                            `num_initializers` is less than the number of graph initializers.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Graph_GetInitializers, _In_ const OrtGraph* graph,
                  _Out_writes_(num_initializers) const OrtValueInfo** initializers,
                  _In_ size_t num_initializers);

  /** \brief Returns the number of graph nodes.
   *
   * \param[in] graph The OrtGraph instance.
   * \param[out] num_nodes Output parameter set to the number of graph nodes.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Graph_GetNumNodes, _In_ const OrtGraph* graph, _Out_ size_t* num_nodes);

  /** \brief Returns the graph's nodes as OrtNode instances.
   *
   * The nodes are sorted using a stable topological ordering. Callers are responsible for maintaining their
   * own node ordering if a different order is required.
   *
   * \param[in] graph The OrtGraph instance.
   * \param[out] nodes Pre-allocated array of `num_nodes` elements that is filled with the graph's nodes.
   * \param[in] num_nodes The size of the `nodes` array. Typical usage sets this to the
   *                      result of Graph_GetNumNodes(). An error status is returned if
   *                      `num_nodes` is less than the number of graph nodes.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Graph_GetNodes, _In_ const OrtGraph* graph,
                  _Out_writes_(num_nodes) const OrtNode** nodes, _In_ size_t num_nodes);

  /** \brief Get the parent node for the given graph, if any exists.
   *
   * Certain operator types (e.g., If and Loop) contain nested subgraphs. This function enables
   * access to the parent node (e.g., the If and Loop node) from a nested subgraph.
   *
   * \param[in] graph The OrtGraph instance.
   * \param[out] node Output parameter that is set to the graph's parent node.
   *                  Set to NULL if a parent node does not exist (e.g., for a top-level graph).
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Graph_GetParentNode, _In_ const OrtGraph* graph, _Outptr_result_maybenull_ const OrtNode** node);

  /** \brief Returns an OrtGraph that contains a subset of nodes in the source OrtGraph.
   *
   * \note The lifetime of "dst_graph" is tied to that of "src_graph", as they both internally reference
   * the same underlying graph. "dst_graph" preserves the input order of "src_graph", and
   * its output order corresponds to the outputs produced by the nodes in "nodes" with the given order.
   *
   * \param[in] src_graph The source OrtGraph instance.
   * \param[in] nodes A subset of the nodes/OrtNodes in 'graph'.
   * \param[in] num_nodes Number of nodes.
   * \param[out] dst_graph An OrtGraph created from a given set of nodes. Must be released by calling ReleaseGraph.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Graph_GetGraphView, _In_ const OrtGraph* src_graph, _In_ const OrtNode** nodes,
                  _In_ size_t num_nodes, _Outptr_ OrtGraph** dst_graph);

  /// @}

  /// \name OrtNode
  /// @{

  /** \brief Returns a node's identifier.
   *
   * The node's identifier is only unique in the node's parent graph. Different nested subgraphs
   * (e.g., subgraphs contained by If and Loop nodes) may reuse identifiers.
   *
   * \param[in] node The OrtNode instance.
   * \param[out] node_id Output parameter set to the node's identifier.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Node_GetId, _In_ const OrtNode* node, _Out_ size_t* node_id);

  /** \brief Returns a node's name. Can be an empty string.
   *
   * \param[in] node The OrtNode instance.
   * \param[out] node_name Output parameter set to the node's name.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Node_GetName, _In_ const OrtNode* node, _Outptr_ const char** node_name);

  /** \brief Returns a node's operator type (e.g., "Conv").
   *
   * \param[in] node The OrtNode instance.
   * \param[out] operator_type Output parameter set to the name of the node's operator type.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Node_GetOperatorType, _In_ const OrtNode* node, _Outptr_ const char** operator_type);

  /** \brief Returns a node's domain name.
   *
   * \param[in] node The OrtNode instance.
   * \param[out] domain_name Output parameter set to the node's domain name.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Node_GetDomain, _In_ const OrtNode* node, _Outptr_ const char** domain_name);

  /** \brief Get the opset version in which the given node's operator type was first defined.
   *
   * \param[in] node The OrtNode instance.
   * \param[out] since_version The opset version in which the node's operator type was first defined.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Node_GetSinceVersion, _In_ const OrtNode* node, _Out_ int* since_version);

  /** \brief Returns the number of node inputs.
   *
   * \param[in] node The OrtNode instance.
   * \param[out] num_inputs Output parameter set to the number of node inputs.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Node_GetNumInputs, _In_ const OrtNode* node, _Out_ size_t* num_inputs);

  /** \brief Returns the node's inputs as OrtValueInfo instances.
   *
   * \param[in] node The OrtNode instance.
   * \param[out] inputs Pre-allocated array of `num_inputs` elements that is filled with the node's inputs.
   * \param[in] num_inputs The size of the `inputs` array.
   *                       Typical usage sets this to the result of Node_GetNumInputs(). An error status is
   *                       returned if `num_inputs` is less than the number of node inputs.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Node_GetInputs, _In_ const OrtNode* node,
                  _Out_writes_(num_inputs) const OrtValueInfo** inputs, _In_ size_t num_inputs);

  /** \brief Returns the number of node outputs.
   *
   * \param[in] node The OrtNode instance.
   * \param[out] num_outputs Output parameter set to the number of node outputs.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Node_GetNumOutputs, _In_ const OrtNode* node, _Out_ size_t* num_outputs);

  /** \brief Returns the node's outputs as OrtValueInfo instances.
   *
   * \param[in] node The OrtNode instance.
   * \param[out] outputs Pre-allocated array of `num_outputs` elements that is filled with the node's outputs.
   * \param[in] num_outputs The size of the `outputs` array.
   *                        Typical usage sets this to the result of Node_GetNumOutputs(). An error status is
   *                        returned if `num_outputs` is less than the number of node outputs.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Node_GetOutputs, _In_ const OrtNode* node,
                  _Out_writes_(num_outputs) const OrtValueInfo** outputs, _In_ size_t num_outputs);

  /** \brief Returns the number of node implicit inputs.
   *
   * Certain operator types (e.g., If and Loop) contain nested subgraphs. The internal nodes within the nested subgraphs
   * may use values from the outer scope. Those "outer scope" values are considered implicit inputs to the node that
   * contains the subgraphs (e.g., the If or Loop node).
   *
   * \param[in] node The OrtNode instance.
   * \param[out] num_implicit_inputs Output parameter set to the number of node implicit inputs.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Node_GetNumImplicitInputs, _In_ const OrtNode* node, _Out_ size_t* num_implicit_inputs);

  /** \brief Get the implicit inputs, as OrtValueInfo instances, that are used within the given node's subgraphs.
   *
   * \note Only certain operator types (e.g., If and Loop) contain nested subgraphs.
   * The internal nodes within the nested subgraphs may use values from the outer scope. Those "outer scope" values
   * are considered implicit inputs to the node that contains the subgraphs (e.g., the If or Loop node).
   *
   * \param[in] node The OrtNode instance.
   * \param[out] implicit_inputs Pre-allocated array of `num_implicit_inputs` elements that is filled the node's
   *                             implicit inputs.
   * \param[in] num_implicit_inputs The size of the `implicit_inputs` array. Typical usage sets this to the result
   *                                of Node_GetNumImplicitInputs(). An error status is returned if
   *                                `num_implicit_inputs` is less than the number of node implicit inputs.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Node_GetImplicitInputs, _In_ const OrtNode* node,
                  _Out_writes_(num_implicit_inputs) const OrtValueInfo** implicit_inputs,
                  _In_ size_t num_implicit_inputs);

  /** \brief Returns the number of node attributes.
   *
   * \param[in] node The OrtNode instance.
   * \param[out] num_attributes Output parameter set to the number of node attributes.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Node_GetNumAttributes, _In_ const OrtNode* node, _Out_ size_t* num_attributes);

  /** \brief Returns a node's attributes as OrtOpAttr instances.
   *
   * \param[in] node The OrtNode instance.
   * \param[out] attributes Pre-allocated array of `num_attributes` elements that is filled with the node's attributes.
   * \param[in] num_attributes The size of the `num_attributes` array.
   *                           Typical usage sets this to the result of Node_GetNumAttributes(). An error status is
   *                           returned if `num_attributes` is less than the number of node attributes.
   *
   * \note ONNX Runtime automatically sets optional (unset) attributes to their default values if the default value
   * is a constant expression that does not depend on other tensor/model characteristics. Conv's 'kernel_shape'
   * attribute is an example of an optional attribute that does not have a constant default value. This function
   * does not provide any unset optional attributes without a constant default value.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Node_GetAttributes, _In_ const OrtNode* node,
                  _Out_writes_(num_attributes) const OrtOpAttr** attributes, _In_ size_t num_attributes);

  /** \brief Gets the OrtNode's attribute as OrtOpAttr by name.
   *
   * \param[in] node The OrtNode instance.
   * \param[in] attribute_name The name of the attribute
   * \param[out] attribute Output parameter set to the OrtOpAttr instance if an attribute by the given name exists.
   *                       For an unset optional attribute, `attribute` is set to NULL and a non-error status is
   *                       returned. For an invalid attribute name, `attribute` is set to NULL and an error status with
   *                       code ORT_NOT_FOUND is returned.
   *
   * \note ONNX Runtime automatically sets optional (unset) attributes to their default values if the default value
   * is a constant expression that does not depend on other tensor/model characteristics. Conv's 'kernel_shape'
   * attribute is an example of an optional attribute that does not have a constant default value. This function
   * does not provide any unset optional attributes without a constant default value.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Node_GetAttributeByName, _In_ const OrtNode* node, _In_ const char* attribute_name,
                  _Outptr_result_maybenull_ const OrtOpAttr** attribute);

  /** \brief Get the OrtNode's 'TENSOR' attribute as an OrtValue.
   *
   * \param[in] attribute The OrtOpAttr instance.
   * \param[out] attr_tensor If successful, contains the 'TENSOR' attribute as a newly created OrtValue.
                             Must be freed with OrtApi::ReleaseValue.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(OpAttr_GetTensorAttributeAsOrtValue, _In_ const OrtOpAttr* attribute,
                  _Outptr_result_maybenull_ OrtValue** attr_tensor);

  /** \brief Get the attribute type as OrtOpAttrType from an OrtOpAttr.
   *
   * \param[in] attribute The OrtOpAttr instance.
   * \param[out] type Output the attribute type as OrtOpAttrType.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(OpAttr_GetType, _In_ const OrtOpAttr* attribute, _Out_ OrtOpAttrType* type);

  /** \brief Get the attribute name from an OrtOpAttr.
   *
   * \param[in] attribute The OrtOpAttr instance.
   * \param[out] name Output parameter set to the attribute's name. The name is a null-terminated string.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(OpAttr_GetName, _In_ const OrtOpAttr* attribute, _Outptr_ const char** name);

  /** \brief Returns the number of subgraphs contained by the given node.
   *
   * \note Only certain operator types (e.g., If and Loop) contain nested subgraphs.
   *
   * \param[in] node The OrtNode instance.
   * \param[out] num_subgraphs Output parameter set to the number of node subgraphs.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Node_GetNumSubgraphs, _In_ const OrtNode* node, _Out_ size_t* num_subgraphs);

  /** \brief Get the subgraphs, as OrtGraph instances, contained by the given node.
   *
   * \note Only certain operator types (e.g., If and Loop) contain nested subgraphs. ONNX nodes store subgraphs in
   * their attributes, however, this function must be used to obtain subgraphs from an OrtNode.
   *
   * \param[in] node The OrtNode instance.
   * \param[out] subgraphs Pre-allocated array of `num_subgraphs` elements that is filled with the node's subgraphs.
   * \param[in] num_subgraphs The size of the `num_subgraphs` array.
   *                          Typical usage sets this to the result of Node_GetNumSubgraphs(). An error status is
   *                          returned if `num_subgraphs` is less than the number of node subgraphs.
   * \param[out] attribute_names Optional pre-allocated array of `num_subgraphs` elements that is filled with the
   *                             attribute names that correspond to the subgraphs. Ignored if set to NULL.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Node_GetSubgraphs, _In_ const OrtNode* node,
                  _Out_writes_(num_subgraphs) const OrtGraph** subgraphs, _In_ size_t num_subgraphs,
                  _Out_writes_opt_(num_subgraphs) const char** attribute_names);

  /** \brief Get the node's parent OrtGraph instance.
   *
   * Can return NULL if the OrtNode was created without an owning graph.
   * In another case, this API may also return NULL if `node` is obtained by calling Graph_GetParentNode()
   * on an OrtGraph that is a subgraph of a control-flow op, and the parent graph has not been created yet,
   * for example during ORT's GetCapability() when processing the innermost subgraph.
   *
   * \param[in] node The OrtNode instance.
   * \param[out] graph Output parameter set to the node's OrtGraph. Can be set to NULL
   *                   if the node is not currently contained by a graph.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Node_GetGraph, _In_ const OrtNode* node, _Outptr_result_maybenull_ const OrtGraph** graph);

  /** \brief Returns the execution provider name that this node is assigned to run on.
   *         Returns NULL if the node has not been assigned to any execution provider yet.
   *         For plugin execution providers, the name is the one returned by OrtEp::GetName.
   *
   * \param[in] node The OrtNode instance.
   * \param[out] out Output execution provider type and can be NULL if node has not been assigned.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Node_GetEpName, _In_ const OrtNode* node, _Outptr_result_maybenull_ const char** out);

  /// @}

  /// \name OrtExternalInitializerInfo
  /// @{

  /** \brief Release an OrtExternalInitializerInfo instance.
   *
   * \param[in] input OrtExternalInitializerInfo instance to be released.
   *
   * \since Version 1.23.
   */
  ORT_CLASS_RELEASE(ExternalInitializerInfo);

  /** \brief Get the relative path to the file that stores the initializer's data.
   *
   * \note The path is relative to the filesystem directory where the ONNX model was stored.
   * Caller can use Graph_GetModelPath to get the model's full path and construct the absolute path to the
   * external initializer file if necessary.
   *
   * \param[in] info The OrtExternalInitializerInfo instance.
   * \return The relative path to the file that stores the initializer's data. Do NOT free this pointer.
   *
   * \since Version 1.23.
   */
  ORT_API_T(const ORTCHAR_T*, ExternalInitializerInfo_GetFilePath, _In_ const OrtExternalInitializerInfo* info);

  /** \brief Get the byte offset within the file where the initializer's data is stored.
   *
   * \param[in] info The OrtExternalInitializerInfo instance.
   * \return The byte offset where the initializer's data is stored within the file.
   *
   * \since Version 1.23.
   */
  ORT_API_T(int64_t, ExternalInitializerInfo_GetFileOffset, _In_ const OrtExternalInitializerInfo* info);

  /** \brief Get the size in bytes of the initializer's data within the file.
   *
   * \param[in] info The OrtExternalInitializerInfo instance.
   * \return The size in bytes of the initializer's data within the file.
   *
   * \since Version 1.23.
   */
  ORT_API_T(size_t, ExternalInitializerInfo_GetByteSize, _In_ const OrtExternalInitializerInfo* info);

  /// @}

  /// \name OrtRunOptions
  /// @{

  /** \brief Get a run configuration entry.
   *
   * If a run configuration entry with key `config_key` doesn't exist, `config_value` will be set to NULL.
   *
   * `config_key`s are defined in onnxruntime_run_options_config_keys.h.
   *
   * \param[in] options The OrtRunOptions instance.
   * \param[in] config_key The configuration entry key. A null-terminated string.
   * \return The configuration entry value. Either a null-terminated string if the entry was found. nullptr otherwise.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23
   */
  ORT_API_T(const char*, GetRunConfigEntry, _In_ const OrtRunOptions* options,
            _In_z_ const char* config_key);

  /// @}

  /** \brief Get the OrtMemoryInfo for the device.
   *
   * \param[in] ep_device The OrtEpDevice instance to query.
   * \param[in] memory_type The memory type to return.
   * \return A pointer to the OrtMemoryInfo for the device. This may be nullptr if not set.
   *         If memory_type is OrtDeviceMemoryType_DEFAULT and nullptr is returned the EP uses CPU memory.
   *
   * \since Version 1.23
   */
  ORT_API_T(const OrtMemoryInfo*, EpDevice_MemoryInfo, _In_ const OrtEpDevice* ep_device,
            _In_ OrtDeviceMemoryType memory_type);

  /** \brief Create/replace a shared allocator for the OrtEpDevice in the OrtEnv.
   *
   * OrtEpDevice maps to the EP factory, and the factory provides the allocator implementation.
   *
   * Both OrtDeviceMemoryType_DEFAULT and OrtDeviceMemoryType_HOST_ACCESSIBLE are optional for an EP to provide.
   * It is EP implementation dependent as to what is available.
   *
   * If a shared allocator already exists for the OrtEpDevice and OrtDeviceMemoryType, it is replaced. This allows
   * changing the shared allocator configuration from the default. e.g. adding an arena.
   *
   * \param[in] env The OrtEnv instance to create the shared allocator in.
   * \param[in] ep_device The OrtEpDevice instance to create the shared allocator for.
   * \param[in] mem_type The memory type to use for the shared allocator.
   * \param[in] allocator_type The type of allocator to create. Only OrtDeviceAllocator is valid currently.
   * \param[in] allocator_options Optional key-value pairs to configure the allocator. If arena based, see
   *                              include/onnxruntime/core/framework/allocator.h for the keys and values that can be
   *                              used.
   * \param[out] allocator A pointer to the created shared allocator. Owned by the OrtEnv instance.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23
   */
  ORT_API2_STATUS(CreateSharedAllocator, _In_ OrtEnv* env, _In_ const OrtEpDevice* ep_device,
                  _In_ OrtDeviceMemoryType mem_type, _In_ OrtAllocatorType allocator_type,
                  _In_opt_ const OrtKeyValuePairs* allocator_options,
                  _Outptr_opt_ OrtAllocator** allocator);

  /** \brief Get a shared allocator from the OrtEnv.
   *
   * By default there is a shared allocator created for all OrtEpDevice instances, so if you get the OrtMemoryInfo
   * from the OrtEpDevice using EpDevice_MemoryInfo a shared allocator is guaranteed to exist.
   *
   * This will also match and return custom allocators added with RegisterAllocator.
   *
   * It is not an error to not find a matching allocator.
   *
   * \param[in] env The OrtEnv instance to get the shared allocator from.
   * \param[in] mem_info The OrtMemoryInfo instance to get the shared allocator for.
   * \param[out] allocator A pointer to the shared allocator, or nullptr if no shared allocator exists for
   *                       the given memory info.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23
   */
  ORT_API2_STATUS(GetSharedAllocator, _In_ OrtEnv* env, _In_ const OrtMemoryInfo* mem_info,
                  _Outptr_result_maybenull_ OrtAllocator** allocator);

  /** \brief Release a shared allocator from the OrtEnv for the OrtEpDevice and memory type.
   *
   * This will release the shared allocator for the given OrtEpDevice and memory type.
   * If no shared allocator exists, this is a no-op.
   *
   * \param[in] env The OrtEnv instance to release the shared allocator from.
   * \param[in] ep_device The OrtEpDevice instance to release the shared allocator for.
   * \param[in] mem_type The memory type of the shared allocator to release.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23
   */
  ORT_API2_STATUS(ReleaseSharedAllocator, _In_ OrtEnv* env, _In_ const OrtEpDevice* ep_device,
                  _In_ OrtDeviceMemoryType mem_type);

  /** \brief Get a const pointer to the raw data inside a tensor
   *
   * Used to read the internal tensor data directly.
   * \note The returned pointer is valid until the OrtValue is destroyed.
   *
   * \param[in] value A tensor type (string tensors are not supported)
   * \param[out] out Filled in with a pointer to the internal storage
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23
   */
  ORT_API2_STATUS(GetTensorData, _In_ const OrtValue* value, _Outptr_ const void** out);

  /** \brief Get Session configuration entries.
   *
   * \param[in] options The session options.
   * \param[out] out A pointer to a newly created OrtKeyValuePairs instance.
   *
   *  An OrtKeyValuePairs instance containing all session configuration entries.
   *  Note: the user should call OrtApi::ReleaseKeyValuePairs.
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(GetSessionOptionsConfigEntries, _In_ const OrtSessionOptions* options, _Outptr_ OrtKeyValuePairs** out);

  /** \brief Get the OrtMemoryInfo for each input of the session.
   *
   * The memory info can be used to determine where the input tensors are required.
   *
   * The session must be fully initialized before calling this function as the input locations are not known until
   * this has occurred.
   *
   * \param[in] session The OrtSession instance.
   * \param[out] inputs_memory_info Pre-allocated array of size `num_inputs` that will be filled with the
   *                                OrtMemoryInfo* value for each input.
   *                                The order is the same as returned by SessionGetInputName.
   * \param[in] num_inputs The number of inputs in the session. Must match SessionGetInputCount.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23
   */
  ORT_API2_STATUS(SessionGetMemoryInfoForInputs, _In_ const OrtSession* session,
                  _Out_writes_(num_inputs) const OrtMemoryInfo** inputs_memory_info,
                  _In_ size_t num_inputs);

  /** \brief Get the OrtMemoryInfo for each output of the session.
   *
   * The memory info can be used to determine the device the output tensors are produced on.
   * The user can pre-allocate an OrtValue using this information or use IOBinding to keep the data on the device.
   * ORT will copy the output to CPU otherwise.
   *
   * The session must be fully initialized before calling this function as the output locations are not known until
   * this has occurred.
   *
   * \param[in] session The OrtSession instance.
   * \param[out] outputs_memory_info Pre-allocated array of size `num_outputs` that will be filled with
   *                                 OrtMemoryInfo* values for each output.
   *                                 The order is the same as returned by SessionGetOutputName.
   * \param[in] num_outputs The number of outputs in the session. Must match SessionGetOutputCount.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23
   */
  ORT_API2_STATUS(SessionGetMemoryInfoForOutputs, _In_ const OrtSession* session,
                  _Out_writes_(num_outputs) const OrtMemoryInfo** outputs_memory_info,
                  _In_ size_t num_outputs);

  /** \brief Get the OrtEpDevice (if available) for each input of the session.
   *
   * An OrtEpDevice will be available if auto EP selection is enabled by calling
   * SessionOptionsSetEpSelectionPolicy or SessionOptionsSetEpSelectionPolicyDelegate,
   * or if the OrtEpDevice was manually added to the session using SessionOptionsAppendExecutionProvider_V2.
   *
   * If an OrtEpDevice is not available for the input a nullptr is returned.
   *
   * The returned OrtEpDevice can be used to create an OrtSyncStream via CreateSyncStreamForEpDevice to asynchronously
   * provide input to the inference session Run.
   *
   * The session must be fully initialized before calling this function as the assigned EPs are not known until
   * this has occurred.
   *
   * \param[in] session The OrtSession instance.
   * \param[out] inputs_ep_devices Pre-allocated array of size `num_inputs` that will be filled with
   *                               OrtEpDevice* values for each input.
   *                               The order is the same as returned by SessionGetInputName.
   * \param[in] num_inputs The number of inputs in the session. Must match SessionGetInputCount.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23
   */
  ORT_API2_STATUS(SessionGetEpDeviceForInputs, _In_ const OrtSession* session,
                  _Out_writes_(num_inputs) const OrtEpDevice** inputs_ep_devices,
                  _In_ size_t num_inputs);

  /** \brief Create an OrtSyncStream for the given OrtEpDevice.
   *
   * The OrtSyncStream can be used to enable asynchronous operations.
   * e.g. async usage of CopyTensors to provide input to an OrtSession Run call.
   *
   * An error code of ORT_NOT_IMPLEMENTED will be returned if the EP does not support OrtSyncStream.
   *
   * \param[in] ep_device The OrtEpDevice instance to create the sync stream for.
   * \param[in] stream_options Options for OrtSyncStream creation. May be nullptr.
   * \param[out] stream Output parameter set to the created OrtSyncStream instance.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23
   */
  ORT_API2_STATUS(CreateSyncStreamForEpDevice, _In_ const OrtEpDevice* ep_device,
                  _In_opt_ const OrtKeyValuePairs* stream_options,
                  _Outptr_ OrtSyncStream** stream);

  /** \brief Get the native handle of the sync stream.
   *
   * This returns the native handle for the stream. e.g. cudaStream_t for CUDA streams.
   *
   * \param[in] stream The OrtSyncStream instance to get the handle from.
   *
   * \returns The native handle of the stream.
   *
   * \since Version 1.23
   */
  ORT_API_T(void*, SyncStream_GetHandle, _In_ OrtSyncStream* stream);

  ORT_CLASS_RELEASE(SyncStream);

  /** \brief Copy OrtValue instances containing Tensors between devices.
   *
   * The overall copy must be between a single source device and a single destination device. i.e.
   *   - all src_tensors must have matching OrtMemoryInfo,
   *   - all dst_tensors must have matching OrtMemoryInfo.
   *
   * OrtValue instances can be created by:
   *   - Use GetSharedAllocator to get the shared allocator for the OrtMemoryInfo if you need to allocate memory
   *     on the device.
   *   - Use CreateTensorAsOrtValue, CreateTensorWithDataAsOrtValue or CreateTensorWithDataAndDeleterAsOrtValue
   *     to create an OrtValue containing a tensor depending on whether you have existing data or not, and whether
   *     you want ORT to free the existing data once it is done with the OrtValue.
   *
   * \param[in] env The OrtEnv instance to use. The data transfer implementation is provided by an execution provider
   *                that is registered in this OrtEnv.
   * \param[in] src_tensors Array of OrtValue instances containing the source tensors to copy.
   * \param[in] dst_tensors Array of OrtValue instances to copy the source tensors to.
   * \param[in] stream Optional OrtSyncStream that can be used to perform the copy asynchronously. May be nullptr.
   * \param[in] num_tensors The number of tensors to copy. The size of `src_tensors` and `dst_tensors` must match.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23
   */
  ORT_API2_STATUS(CopyTensors, _In_ const OrtEnv* env,
                  _In_reads_(num_tensors) const OrtValue* const* src_tensors,
                  _In_reads_(num_tensors) OrtValue* const* dst_tensors,
                  _In_opt_ OrtSyncStream* stream,
                  _In_ size_t num_tensors);

  /** \brief Get ::OrtModelMetadata from an ::OrtGraph
   *
   * \param[in] graph The OrtGraph instance.
   * \param[out] out Newly created ::OrtModelMetadata. Must be freed using OrtApi::ReleaseModelMetadata.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(Graph_GetModelMetadata, _In_ const OrtGraph* graph, _Outptr_ OrtModelMetadata** out);

  /** \brief Validate a compiled model's compatibility information for one or more EP devices.
   *
   * \param[in] ep_devices The EP devices to validate against (e.g., from GetEpDevices).
   *                        All devices must belong to the same execution provider.
   * \param[in] num_ep_devices The number of EP devices provided.
   * \param[in] compatibility_info The compatibility info string produced when the model was compiled.
   * \param[out] out_status The resulting compatibility status for the EP devices.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(GetModelCompatibilityForEpDevices,
                  _In_reads_(num_ep_devices) const OrtEpDevice* const* ep_devices,
                  _In_ size_t num_ep_devices,
                  _In_ const char* compatibility_info,
                  _Out_ OrtCompiledModelCompatibility* out_status);

  /// \name OrtExternalInitializerInfo
  /// @{

  /** \brief Creates an OrtExternalInitializerInfo instance.
   *
   * \param[in] filepath The relative path to the file that stores the initializer's data. ORT copies this path string.
   * \param[in] file_offset The byte offset where the initializer's data is stored within the file.
   * \param[in] byte_size The size in bytes of the initializer's data within the file.
   * \param[out] out Output parameter set to the new OrtExternalInitializerInfo instance.
   *                 Must be released by calling ReleaseExternalInitializerInfo().
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(CreateExternalInitializerInfo, _In_ const ORTCHAR_T* filepath, _In_ int64_t file_offset,
                  _In_ size_t byte_size, _Outptr_ OrtExternalInitializerInfo** out);

  /// @}
  /** \brief Fetch whether the tensor has shape information.
   * \param[in] info The OrtTensorTypeAndShapeInfo instance.
   * \return true if the tensor has shape information, false otherwise.
   *
   * \since Version 1.24
   */
  ORT_API_T(bool, TensorTypeAndShape_HasShape, _In_ const OrtTensorTypeAndShapeInfo* info);

  /** \brief Get all config entries from ::OrtKernelInfo.
   *
   * Gets all configuration entries from the ::OrtKernelInfo object as key-value pairs.
   * Config entries are set on the ::OrtSessionOptions and are accessible in custom operator kernels.
   *
   * Used in the CreateKernel callback of an OrtCustomOp to access all session configuration entries
   * during kernel construction.
   *
   * \param[in] info An instance of ::OrtKernelInfo.
   * \param[out] out A pointer to a newly created OrtKeyValuePairs instance containing all config entries.
   *                 Note: the user should call OrtApi::ReleaseKeyValuePairs.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.24
   */
  ORT_API2_STATUS(KernelInfo_GetConfigEntries, _In_ const OrtKernelInfo* info, _Outptr_ OrtKeyValuePairs** out);

  /** \brief Get the graph node's operator domain from ::OrtKernelInfo.
   *
   * If `out` is nullptr, the value of `size` is set to the size of the operator domain
   * string (including null-terminator), and a success status is returned.
   *
   * If the `size` parameter is greater than or equal to the string's size and `out` is not nullptr,
   * the value of `size` is set to the true size of the string (including null-terminator),
   * the provided memory is filled with the string's contents, and a success status is returned.
   *
   * If the `size` parameter is less than the actual string's size and `out`
   * is not nullptr, the value of `size` is set to the true size of the string
   * and a failure status with error code ORT_INVALID_ARGUMENT is returned.
   *
   * \param[in] info An instance of ::OrtKernelInfo.
   * \param[out] out Memory location into which to write the UTF-8 null-terminated string representing the
   *                 operator domain.
   * \param[in,out] size Pointer to the size of the `out` buffer. See above comments for details.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.24
   */
  ORT_API2_STATUS(KernelInfo_GetOperatorDomain, _In_ const OrtKernelInfo* info, _Out_opt_ char* out,
                  _Inout_ size_t* size);

  /** \brief Get the graph node's operator type from ::OrtKernelInfo.
   *
   * If `out` is nullptr, the value of `size` is set to the size of the operator type
   * string (including null-terminator), and a success status is returned.
   *
   * If the `size` parameter is greater than or equal to the string's size and `out` is not nullptr,
   * the value of `size` is set to the true size of the string (including null-terminator),
   * the provided memory is filled with the string's contents, and a success status is returned.
   *
   * If the `size` parameter is less than the actual string's size and `out`
   * is not nullptr, the value of `size` is set to the true size of the string
   * and a failure status with error code ORT_INVALID_ARGUMENT is returned.
   *
   * \param[in] info An instance of ::OrtKernelInfo.
   * \param[out] out Memory location into which to write the UTF-8 null-terminated string representing the
   *                 operator type.
   * \param[in,out] size Pointer to the size of the `out` buffer. See above comments for details.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.24
   */
  ORT_API2_STATUS(KernelInfo_GetOperatorType, _In_ const OrtKernelInfo* info, _Out_opt_ char* out,
                  _Inout_ size_t* size);

  /** \brief Get the opset version in which the given node's operator type was first defined from ::OrtKernelInfo.
   *
   * \param[in] info An instance of ::OrtKernelInfo.
   * \param[out] since_version The opset version in which the node's operator type was first defined.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.24
   */
  ORT_API2_STATUS(KernelInfo_GetOperatorSinceVersion, _In_ const OrtKernelInfo* info,
                  _Out_ int* since_version);

  /** \brief Get the EP Interop API instance.
   *
   * Get the Interop API instance to work with external resources. This API provides functions
   * for importing external GPU memory and semaphores for zero-copy sharing between ORT inference
   * and other GPU workloads.
   *
   * \return Interop API struct instance.
   *
   * \since Version 1.24.
   */
  const OrtInteropApi*(ORT_API_CALL* GetInteropApi)(void);

  /** \brief Get the EP device assigned to each session output.
   *
   * Returns the OrtEpDevice assigned to each output of the session after graph partitioning.
   * This allows validation that outputs are placed on the expected device for external resource sharing.
   *
   * The EP device for each output is determined by which execution provider will produce that output
   * during inferencing. This information is useful for:
   * - Validating that outputs will be placed on the expected device for external resource sharing
   * - Deciding whether to use external memory handles for outputs
   *
   * \param[in] session The OrtSession instance to query.
   * \param[out] outputs_ep_devices An array to be filled with the EP device for each output.
   *                                The array must be allocated by the caller with space for
   *                                OrtEpDevice* values for each output.
   *                                The order is the same as returned by SessionGetOutputName.
   * \param[in] num_outputs The number of outputs in the session. Must match SessionGetOutputCount.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24
   */
  ORT_API2_STATUS(SessionGetEpDeviceForOutputs, _In_ const OrtSession* session,
                  _Out_writes_(num_outputs) const OrtEpDevice** outputs_ep_devices,
                  _In_ size_t num_outputs);
  /** \brief Get the number of available hardware devices.
   *
   * Returns the count of hardware devices discovered on the system.
   * Use this to allocate an array before calling GetHardwareDevices().
   *
   * \param[in] env The OrtEnv instance where device discovery results are stored.
   * \param[out] num_devices The number of OrtHardwareDevice instances available.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24.
   */
  ORT_API2_STATUS(GetNumHardwareDevices, _In_ const OrtEnv* env, _Out_ size_t* num_devices);

  /** \brief Get the list of available hardware devices.
   *
   * Enumerates hardware devices available on the system.
   * Populates a user-provided array with pointers to OrtHardwareDevice instances. The caller is responsible
   * for allocating the array with sufficient space (use GetNumHardwareDevices() to get the count).
   *
   * The returned pointers reference internal ORT data structures that are discovered once at process
   * startup and remain valid for the lifetime of the OrtEnv. The caller does not need to release these
   * pointers, but should not use them after calling ReleaseEnv().
   *
   * \param[in] env The OrtEnv instance where device discovery results are stored.
   * \param[out] devices User-allocated array to receive pointers to OrtHardwareDevice instances.
   *                     The array must have space for at least num_devices elements.
   * \param[in] num_devices The size of the user-allocated devices array.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24.
   */
  ORT_API2_STATUS(GetHardwareDevices, _In_ const OrtEnv* env,
                  _Out_writes_(num_devices) const OrtHardwareDevice** devices,
                  _In_ size_t num_devices);

  /** \brief Check for known incompatibility issues between hardware device and a specific execution provider.
   *
   * This function checks for known incompatibility issues between the specified hardware device
   * and a specific execution provider.
   * If returned incompatibility details have non-zero reasons, it indicates the device is not compatible.
   * However, if returned detail have reason == 0, it doesn't guarantee 100% compatibility for all models,
   * as models may have specific requirements.
   *
   * Note: This method should only be called when the OrtEnv has been initialized with execution
   * providers (after RegisterExecutionProviderLibrary is called).
   *
   * \param[in] env The OrtEnv instance with registered execution providers.
   * \param[in] ep_name The name of the execution provider to check. Required and cannot be null or empty.
   * \param[in] hw The hardware device to check for incompatibility.
   * \param[out] details Compatibility details including reasons for incompatibility if any.
   *                     Must be freed with OrtApi::ReleaseDeviceEpIncompatibilityDetails.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24.
   */
  ORT_API2_STATUS(GetHardwareDeviceEpIncompatibilityDetails, _In_ const OrtEnv* env,
                  _In_ const char* ep_name,
                  _In_ const OrtHardwareDevice* hw,
                  _Outptr_ OrtDeviceEpIncompatibilityDetails** details);

  /// \name OrtDeviceEpIncompatibilityDetails
  /// Accessor functions for device incompatibility details
  /// @{

  /** \brief Get the incompatibility reasons bitmask from OrtDeviceEpIncompatibilityDetails.
   *
   * \param[in] details The OrtDeviceEpIncompatibilityDetails instance to query.
   * \param[out] reasons_bitmask Pointer to store the bitmask of incompatibility reasons.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24.
   */
  ORT_API2_STATUS(DeviceEpIncompatibilityDetails_GetReasonsBitmask,
                  _In_ const OrtDeviceEpIncompatibilityDetails* details,
                  _Out_ uint32_t* reasons_bitmask);

  /** \brief Get the notes from OrtDeviceEpIncompatibilityDetails.
   *
   * \param[in] details The OrtDeviceEpIncompatibilityDetails instance to query.
   * \param[out] notes Pointer to the notes string. May be nullptr if no notes are available.
   *                   The returned string is owned by the details object and should not be freed.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24.
   */
  ORT_API2_STATUS(DeviceEpIncompatibilityDetails_GetNotes,
                  _In_ const OrtDeviceEpIncompatibilityDetails* details,
                  _Outptr_result_maybenull_ const char** notes);

  /** \brief Get the execution provider error code from OrtDeviceEpIncompatibilityDetails.
   *
   * This allows Independent Hardware Vendors (IHVs) to define their own error codes
   * to provide additional details about device incompatibility.
   *
   * \param[in] details The OrtDeviceEpIncompatibilityDetails instance to query.
   * \param[out] error_code Pointer to store the EP-specific error code. A value of 0 indicates no error code was set.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24.
   */
  ORT_API2_STATUS(DeviceEpIncompatibilityDetails_GetErrorCode,
                  _In_ const OrtDeviceEpIncompatibilityDetails* details,
                  _Out_ int32_t* error_code);

  /** \brief Release an OrtDeviceEpIncompatibilityDetails instance.
   *
   * \since Version 1.24.
   */
  ORT_CLASS_RELEASE(DeviceEpIncompatibilityDetails);

  /// @}

  /// \name Model Compatibility APIs
  /// @{

  /** \brief Extract EP compatibility info from a precompiled model file.
   *
   * Parses the model file to extract the compatibility info string for a specific execution provider
   * from the model's metadata properties. This is only applicable to models that have been precompiled
   * for an EP (e.g., via OrtCompileApi). Standard ONNX models do not contain this information.
   *
   * The compatibility info string must be valid UTF-8 without embedded NUL characters.
   *
   * \note This API performs standalone model parsing, separate from session creation. This means
   * the protobuf parsing cost is incurred here and again during session creation. It is intended
   * for scenarios where applications need to check compatibility before deciding whether to proceed
   * with session creation, such as providing early user feedback.
   *
   * \note This operation parses the full ONNX ModelProto from disk. For very large models, consider
   * using GetCompatibilityInfoFromModelBytes with a pre-loaded buffer if the model is already in memory.
   *
   * The compatibility info can then be passed to GetModelCompatibilityForEpDevices to check if a
   * precompiled model is compatible with the current system.
   *
   * \param[in] model_path Path to the ONNX model file.
   * \param[in] ep_type The execution provider type string. Must be non-empty.
   *                    Use OrtApi::EpDevice_EpName to get this value from an OrtEpDevice.
   * \param[in] allocator Allocator to use for the output string. Use OrtApi::GetAllocatorWithDefaultOptions.
   * \param[out] compatibility_info Output pointer to the compatibility info string.
   *                                Returns nullptr if no compatibility info exists for the specified EP.
   *                                Caller must free with OrtApi::AllocatorFree when non-null.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24.
   */
  ORT_API2_STATUS(GetCompatibilityInfoFromModel,
                  _In_ const ORTCHAR_T* model_path,
                  _In_ const char* ep_type,
                  _Inout_ OrtAllocator* allocator,
                  _Outptr_result_maybenull_ char** compatibility_info);

  /** \brief Extract EP compatibility info from precompiled model bytes in memory.
   *
   * Same as GetCompatibilityInfoFromModel but reads from a memory buffer instead of a file.
   * Useful when precompiled models are loaded from encrypted storage, network, or other non-file sources.
   *
   * \note This API performs standalone model parsing, separate from session creation. This means
   * the protobuf parsing cost is incurred here and again during session creation. It is intended
   * for scenarios where applications need to check compatibility before deciding whether to proceed
   * with session creation, such as providing early user feedback.
   *
   * \param[in] model_data Pointer to the model data in memory.
   * \param[in] model_data_length Size of the model data in bytes.
   * \param[in] ep_type The execution provider type string. Must be non-empty.
   * \param[in] allocator Allocator to use for the output string. Use OrtApi::GetAllocatorWithDefaultOptions.
   * \param[out] compatibility_info Output pointer to the compatibility info string.
   *                                Returns nullptr if no compatibility info exists for the specified EP.
   *                                Caller must free with OrtApi::AllocatorFree when non-null.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24.
   */
  ORT_API2_STATUS(GetCompatibilityInfoFromModelBytes,
                  _In_reads_(model_data_length) const void* model_data,
                  _In_ size_t model_data_length,
                  _In_ const char* ep_type,
                  _Inout_ OrtAllocator* allocator,
                  _Outptr_result_maybenull_ char** compatibility_info);

  /// @}

  /** \brief Create an OrtEnv instance with the given options.
   *
   * \note Invoking this function will return the same instance of the environment as that returned by a previous call
   *       to another env creation function; all arguments to this function will be ignored.
   *
   * \param[in] options The OrtEnvCreationOptions instance that contains creation options.
   * \param[out] out Output parameter set to the new OrtEnv instance. Must be freed with OrtApi::ReleaseEnv.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24
   */
  ORT_API2_STATUS(CreateEnvWithOptions, _In_ const OrtEnvCreationOptions* options, _Outptr_ OrtEnv** out);

  /** \brief Get information about the subgraphs assigned to each execution provider (EP) and the nodes within.
   *
   * Each returned OrtEpAssignedSubgraph instance contains details of the subgraph/nodes assigned to an execution
   * provider, including the execution provider's name, and the name, domain, and operator type for every node.
   *
   * For compiling execution providers, a single OrtEpAssignedSubgraph instance contains information about the
   * nodes that are fused and compiled within a single subgraph assigned to the execution provider.
   *
   * For execution providers that use kernel registration (e.g., CPU EP), each node with a registered kernel is
   * contained in its own OrtEpAssignedSubgraph instance.
   *
   * \note The caller must enable the collection of this information by enabling the session
   *       configuration entry "session.record_ep_graph_assignment_info" during session creation.
   *       Refer to onnxruntime_session_options_config_keys.h. Otherwise, if not enabled, this function returns a
   *       status with error code ORT_FAIL.
   *
   * \note The information reported by this function is obtained immediately after running basic optimizations on the
   *       original graph if the session optimization level is set to ORT_ENABLE_BASIC or higher. If the session
   *       optimization level is set to ORT_DISABLE_ALL, only minimal/required optimizations are run before
   *       the information is collected.
   *
   * \param[in] session The OrtSession instance.
   * \param[out] ep_subgraphs Output parameter set to the array of OrtEpAssignedSubgraph instances.
   * \param[out] num_ep_subgraphs Output parameter set to the number of elements in the `ep_subgraphs` array.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24.
   */
  ORT_API2_STATUS(Session_GetEpGraphAssignmentInfo, _In_ const OrtSession* session,
                  _Outptr_ const OrtEpAssignedSubgraph* const** ep_subgraphs,
                  _Out_ size_t* num_ep_subgraphs);

  /** \brief Get the name of the execution provider to which the subgraph was assigned.
   *
   * \param[in] ep_subgraph The OrtEpAssignedSubgraph instance.
   * \param[out] out Output parameter set to the execution provider's name as a UTF-8 null-terminated string.
   *                 Owned by the OrtEpAssignedSubgraph instance (do not free).
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24.
   */
  ORT_API2_STATUS(EpAssignedSubgraph_GetEpName, _In_ const OrtEpAssignedSubgraph* ep_subgraph,
                  _Outptr_ const char** out);

  /** \brief Get the nodes in a subgraph assigned to a specific execution provider.
   *
   * \param[in] ep_subgraph The OrtEpAssignedSubgraph instance.
   * \param[out] ep_nodes Output parameter set to the array of OrtEpAssignedNode instances.
   * \param[out] num_ep_nodes Output parameter set to the number of OrtEpAssignedNode instance returned.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24.
   */
  ORT_API2_STATUS(EpAssignedSubgraph_GetNodes, _In_ const OrtEpAssignedSubgraph* ep_subgraph,
                  _Outptr_ const OrtEpAssignedNode* const** ep_nodes, _Out_ size_t* num_ep_nodes);

  /** \brief Get the name of the node assigned to an execution provider.
   *
   * \param[in] ep_node The OrtEpAssignedNode instance.
   * \param[out] out Output parameter set to the node's name as a UTF-8 null-terminated string.
   *                 Owned by the OrtEpAssignedNode instance (do not free).
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24.
   */
  ORT_API2_STATUS(EpAssignedNode_GetName, _In_ const OrtEpAssignedNode* ep_node, _Outptr_ const char** out);

  /** \brief Get the domain of the node assigned to an execution provider.
   *
   * \param[in] ep_node The OrtEpAssignedNode instance.
   * \param[out] out Output parameter set to the node's domain as a UTF-8 null-terminated string.
   *                 Owned by the OrtEpAssignedNode instance (do not free).
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24.
   */
  ORT_API2_STATUS(EpAssignedNode_GetDomain, _In_ const OrtEpAssignedNode* ep_node, _Outptr_ const char** out);

  /** \brief Get the operator type of the node assigned to an execution provider.
   *
   * \param[in] ep_node The OrtEpAssignedNode instance.
   * \param[out] out Output parameter set to the node's operator type as a UTF-8 null-terminated string.
   *                 Owned by the OrtEpAssignedNode instance (do not free).
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24.
   */
  ORT_API2_STATUS(EpAssignedNode_GetOperatorType, _In_ const OrtEpAssignedNode* ep_node, _Outptr_ const char** out);

  /** \brief Sets OrtSyncStream for the run options
   *
   * OrtSyncStream is used to synchronize the execution of the model run for the device
   * of the stream. It overrides the existing stream for the duration of the Run().
   * The stream instance must be alive for the duration of the Run() call.
   *
   * \param[in] options
   * \param[in] sync_stream The synchronization stream. Pass nullptr to clear previous setting.
   *
   * \since 1.24
   */
  ORT_API_T(void, RunOptionsSetSyncStream, _Inout_ OrtRunOptions* options, _In_ OrtSyncStream* sync_stream);

  /** \brief Get the element data type and shape for an OrtValue that represents a Tensor (scalar, dense, or sparse).
   *
   * \note This function is an alternative to ::GetTensorTypeAndShape() that does not allocate a new array for
   *       the shape data. The OrtValue instance's internal shape data is returned directly.
   *
   * \note Returns an error if the underlying OrtValue is not a Tensor.
   *
   * \param[in] value The OrtValue instance.
   * \param[out] elem_type Output parameter set to the tensor element data type.
   * \param[out] shape_data Output parameter set to the OrtValue instance's internal shape data array.
   *                        For a scalar, `shape_data` is NULL and `shape_data_count` is 0.
   *                        Must not be released as it is owned by the OrtValue instance. This pointer becomes invalid
   *                        when the OrtValue is released or if the underlying shape data is updated or reallocated.
   * \param[out] shape_data_count Output parameter set to the number of elements in `shape_data`.
   *                              `shape_data_count` is 0 for a scalar.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24.
   */
  ORT_API2_STATUS(GetTensorElementTypeAndShapeDataReference, _In_ const OrtValue* value,
                  _Out_ ONNXTensorElementDataType* elem_type,
                  _Outptr_result_maybenull_ const int64_t** shape_data,
                  _Out_ size_t* shape_data_count);
};

/*
 * Steps to use a custom op:
 *   1 Create an OrtCustomOpDomain with the domain name used by the custom ops
 *   2 Create an OrtCustomOp structure for each op and add them to the domain
 *   3 Call OrtAddCustomOpDomain to add the custom domain of ops to the session options
 */

// Specifies some characteristics of inputs/outputs of custom ops:
// Specify if the inputs/outputs are one of:
// 1) Non-optional (input/output must be present in the node)
// 2) Optional (input/output may be absent in the node)
// 3) Variadic: A variadic input or output specifies N (i.e., the minimum arity) or more operands.
//              Only the last input or output of a custom op may be marked as variadic.
//              The homogeneity of the variadic input or output determines whether all operands must be of the same
//              tensor element type.
typedef enum OrtCustomOpInputOutputCharacteristic {
  INPUT_OUTPUT_REQUIRED = 0,
  INPUT_OUTPUT_OPTIONAL,
  INPUT_OUTPUT_VARIADIC,
} OrtCustomOpInputOutputCharacteristic;

/*
 * The OrtCustomOp structure defines a custom op's schema and its kernel callbacks. The callbacks are filled in by
 * the implementor of the custom op.
 */
struct OrtCustomOp {
  uint32_t version;  // Must be initialized to ORT_API_VERSION

  // This callback creates the kernel, which is a user defined
  // parameter that is passed to the Kernel* callbacks below. It is
  // recommended to use CreateKernelV2 which allows for a safe error
  // propagation by returning an OrtStatusPtr.
  void*(ORT_API_CALL* CreateKernel)(_In_ const struct OrtCustomOp* op, _In_ const OrtApi* api,
                                    _In_ const OrtKernelInfo* info);

  // Returns the name of the op
  const char*(ORT_API_CALL* GetName)(_In_ const struct OrtCustomOp* op);

  // Returns the type of the execution provider, return nullptr to use CPU execution provider
  const char*(ORT_API_CALL* GetExecutionProviderType)(_In_ const struct OrtCustomOp* op);

  // Returns the count and types of the input & output tensors
  ONNXTensorElementDataType(ORT_API_CALL* GetInputType)(_In_ const struct OrtCustomOp* op, _In_ size_t index);
  size_t(ORT_API_CALL* GetInputTypeCount)(_In_ const struct OrtCustomOp* op);
  ONNXTensorElementDataType(ORT_API_CALL* GetOutputType)(_In_ const struct OrtCustomOp* op, _In_ size_t index);
  size_t(ORT_API_CALL* GetOutputTypeCount)(_In_ const struct OrtCustomOp* op);

  // Perform a computation step.  It is recommended to use
  // KernelComputeV2 which allows for a safe error propagation by
  // returning an OrtStatusPtr.
  void(ORT_API_CALL* KernelCompute)(_In_ void* op_kernel, _In_ OrtKernelContext* context);
  void(ORT_API_CALL* KernelDestroy)(_In_ void* op_kernel);

  // Returns the characteristics of the input & output tensors
  OrtCustomOpInputOutputCharacteristic(ORT_API_CALL* GetInputCharacteristic)(_In_ const struct OrtCustomOp* op, _In_ size_t index);
  OrtCustomOpInputOutputCharacteristic(ORT_API_CALL* GetOutputCharacteristic)(_In_ const struct OrtCustomOp* op, _In_ size_t index);

  // Returns the memory type of the input tensors. This API allows the custom op
  // to place the inputs on specific devices. By default, it returns
  // OrtMemTypeDefault, which means the input is placed on the default device for
  // the execution provider. If the inputs need to be with different memory types,
  // this function can be overridden to return the specific memory types.
  OrtMemType(ORT_API_CALL* GetInputMemoryType)(_In_ const struct OrtCustomOp* op, _In_ size_t index);

  // Returns the minimum number of input arguments expected for the variadic input.
  // Applicable only for custom ops that have a variadic input.
  int(ORT_API_CALL* GetVariadicInputMinArity)(_In_ const struct OrtCustomOp* op);

  // Returns true (non-zero) if all arguments of a variadic input have to be of the same type (homogeneous),
  // and false (zero) otherwise.
  // Applicable only for custom ops that have a variadic input.
  int(ORT_API_CALL* GetVariadicInputHomogeneity)(_In_ const struct OrtCustomOp* op);

  // Returns the minimum number of output values expected for the variadic output.
  // Applicable only for custom ops that have a variadic output.
  int(ORT_API_CALL* GetVariadicOutputMinArity)(_In_ const struct OrtCustomOp* op);

  // Returns true (non-zero) if all outputs values of a variadic output have to be of the same type (homogeneous),
  // and false (zero) otherwise.
  // Applicable only for custom ops that have a variadic output.
  int(ORT_API_CALL* GetVariadicOutputHomogeneity)(_In_ const struct OrtCustomOp* op);

  // Create the kernel state which is passed to each compute call.
  OrtStatusPtr(ORT_API_CALL* CreateKernelV2)(_In_ const struct OrtCustomOp* op, _In_ const OrtApi* api,
                                             _In_ const OrtKernelInfo* info,
                                             _Out_ void** kernel);

  // Perform the computation step.
  OrtStatusPtr(ORT_API_CALL* KernelComputeV2)(_In_ void* op_kernel, _In_ OrtKernelContext* context);

  OrtStatusPtr(ORT_API_CALL* InferOutputShapeFn)(_In_ const struct OrtCustomOp* op, _In_ OrtShapeInferContext*);

  // Get start range
  int(ORT_API_CALL* GetStartVersion)(_In_ const struct OrtCustomOp* op);
  int(ORT_API_CALL* GetEndVersion)(_In_ const struct OrtCustomOp* op);

  // Get the inplace_map that defines which output can reuse which input
  // Callers will provide 2 raw int* and pass in their address, this function will fill these 2 arrays
  // when return, output (*output_index)[i] may reuse the input (*input_index[i]).
  // The return value is the size of these 2 arrays.
  // Callers are responsible to delete these 2 arrays after use by calling OrtCustomOp::ReleaseMayInplace().
  size_t(ORT_API_CALL* GetMayInplace)(_Out_ int** input_index, _Out_ int** output_index);

  // Release the pointer input_index and output_index allocated from GetMayInplace() function.
  // If GetMayInplace() is defined, this function MUST be defined as well.
  void(ORT_API_CALL* ReleaseMayInplace)(_Frees_ptr_opt_ int* input_index, _Frees_ptr_opt_ int* output_index);

  // Same as GetMayInplace() and ReleaseMayInplace()
  size_t(ORT_API_CALL* GetAliasMap)(_Out_ int** input_index, _Out_ int** output_index);
  void(ORT_API_CALL* ReleaseAliasMap)(_Frees_ptr_opt_ int* input_index, _Frees_ptr_opt_ int* output_index);
};

/**
 * ORT Model Editor API
 */

/**
 * \brief The OrtModelEditorApi struct provides functions to create or edit an ONNX model.
 *
 * See onnxruntime/test/shared_lib/test_model_editor_api.cc for example usage.
 *
 * \since Version 1.22.
 */
struct OrtModelEditorApi {
  // Model building/editing requires a full build. We return nullptr from GetModelEditorApi if this is a minimal
  // build, so it doesn't matter if there are no function pointers in this struct as a user will never get an
  // OrtModelEditorApi instance. We do however need a dummy field to avoid empty struct warning.
#if defined(ORT_MINIMAL_BUILD)
  const bool not_defined_in_this_build;
#else
  /** \brief Create an OrtTypeInfo instance for a Tensor.
   *
   * Create an OrtTypeInfo instance for a Tensor to use as graph inputs/outputs with the Model Editor API.
   *
   * User can release `tensor_info` after creating the OrtTypeInfo.
   *
   * \param[in] tensor_info Tensor type and shape information.
   * \param[out] type_info TypeInfo instance for the tensor.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(CreateTensorTypeInfo, _In_ const OrtTensorTypeAndShapeInfo* tensor_info,
                  _Outptr_ OrtTypeInfo** type_info);

  /** \brief Create an OrtTypeInfo instance for a SparseTensor.
   *
   * Create an OrtTypeInfo instance for a SparseTensor to use as graph inputs/outputs with the Model Editor API.
   *
   * User can release `tensor_info` after creating the OrtTypeInfo.
   *
   * \param[in] tensor_info SparseTensor type and shape information.
   * \param[out] type_info TypeInfo instance for the tensor.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(CreateSparseTensorTypeInfo, _In_ const OrtTensorTypeAndShapeInfo* tensor_info,
                  _Outptr_ OrtTypeInfo** type_info);

  /** \brief Create an OrtTypeInfo instance for a Map.
   *
   * Create an OrtTypeInfo instance for a Map to use as graph inputs/outputs with the Model Editor API.
   *
   * User can release `map_value_type` after creating the OrtTypeInfo.
   *
   * \param[in] map_key_type Key type for the map.
   * \param[in] map_value_type Value type for the map.
   * \param[out] type_info TypeInfo instance for the map.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(CreateMapTypeInfo, ONNXTensorElementDataType map_key_type, _In_ const OrtTypeInfo* map_value_type,
                  _Outptr_ OrtTypeInfo** type_info);

  /** \brief Create an OrtTypeInfo instance for a Sequence.
   *
   * Create an OrtTypeInfo instance for a Sequence to use as graph inputs/outputs with the Model Editor API.
   *
   * User can release `sequence_type` after creating the OrtTypeInfo.
   *
   * \param[in] sequence_type Sequence type and shape information.
   * \param[out] type_info TypeInfo instance for the sequence.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(CreateSequenceTypeInfo, _In_ const OrtTypeInfo* sequence_type, _Outptr_ OrtTypeInfo** type_info);

  /** \brief Create an OrtTypeInfo instance for an Optional.
   *
   * Create an OrtTypeInfo instance for an Optional to use as graph inputs/outputs with the Model Editor API.
   *
   * User can release `contained_type` after creating the OrtTypeInfo.
   *
   * \param[in] contained_type Tensor type and shape information.
   * \param[out] type_info TypeInfo instance for the tensor.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(CreateOptionalTypeInfo, _In_ const OrtTypeInfo* contained_type, _Outptr_ OrtTypeInfo** type_info);

  /** \brief Create an OrtValueInfo for use as an OrtGraph input or output.
   *
   * \param[in] name The name of the input or output.
   * \param[in] type_info The type information for the input or output. The provided value is copied.
   * \param[out] value_info The OrtValueInfo instance.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(CreateValueInfo, _In_ const char* name, _In_ const OrtTypeInfo* type_info,
                  _Outptr_ OrtValueInfo** value_info);

  /** \brief Create an OrtNode to add to an OrtGraph.
   *
   * Create an OrtNode.
   *
   * Create attributes with CreateOpAttr. OrtOpAttr instances are copied.
   *
   * \param[in] operator_name The name of the operator.
   * \param[in] domain_name The domain of the operator. Use an empty string for ONNX operators.
   * \param[in] node_name The name of the node.
   * \param[in] input_names The names of the inputs.
   * \param[in] input_names_len The number of input names.
   * \param[in] output_names The names of the outputs.
   * \param[in] output_names_len The number of output names.
   * \param[in] attributes The optional attributes of the node.
   * \param[in] attribs_len The number of attributes. May be zero.
   * \param[out] node The OrtNode instance.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(CreateNode, _In_ const char* operator_name, _In_ const char* domain_name, _In_ const char* node_name,
                  _In_reads_(input_names_len) const char* const* input_names, size_t input_names_len,
                  _In_reads_(output_names_len) const char* const* output_names, size_t output_names_len,
                  _In_reads_(attribs_len) _In_opt_ OrtOpAttr** attributes, _In_ size_t attribs_len,
                  _Outptr_ OrtNode** node);

  /** \brief Create an OrtGraph
   * \snippet{doc} snippets.dox OrtStatus Return Value
   * \since Version 1.22.
   */
  ORT_API2_STATUS(CreateGraph, _Outptr_ OrtGraph** graph);

  /** \brief Set the inputs for the OrtGraph.
   *
   * Set the graph inputs. This will replace any existing inputs with the new values.
   * The OrtGraph takes ownership of the OrtValueInfo instances and you should NOT call ReleaseOrtValueInfo.
   *
   * \param[in] graph The OrtGraph instance to update.
   * \param[in] inputs The input OrtValueInfo instances.
   * \param[in] inputs_len The number of input OrtValueInfo instances.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(SetGraphInputs, _Inout_ OrtGraph* graph,
                  _In_reads_(inputs_len) _In_ OrtValueInfo** inputs, _In_ size_t inputs_len);

  /** \brief Set the outputs for the OrtGraph.
   *
   * Set the graph outputs. This will replace any existing outputs with the new values.
   * The OrtGraph takes ownership of the OrtValueInfo instances provided and you should NOT call ReleaseOrtValueInfo.
   *
   * \param[in] graph The OrtGraph instance to update.
   * \param[in] outputs The output OrtValueInfo instances.
   * \param[in] outputs_len The number of output OrtValueInfo instances.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(SetGraphOutputs, _Inout_ OrtGraph* graph,
                  _In_reads_(outputs_len) _In_ OrtValueInfo** outputs, _In_ size_t outputs_len);

  /** \brief Add an initializer to the OrtGraph
   *
   * ORT will take ownership of the OrtValue and you should NOT call ReleaseOrtValue.
   *
   * Two options:
   *
   * Allocated memory:
   *    Use CreateTensorAsOrtValue (allocates memory) and populate the tensor with the data.
   *    Set `data_is_external` to false.
   *
   * Pre-existing memory:
   *    Use CreateTensorWithDataAsOrtValue or CreateTensorWithDataAndDeleterAsOrtValue to create an OrtValue
   *    with a tensor that contains a pointer to the existing data.
   *    Set `data_is_external` to true.
   *
   *    The pointer must remain valid for the duration of the inference session.
   *    If using CreateTensorWithDataAsOrtValue you are responsible for freeing the memory after the inference session
   *    is released.
   *    If using CreateTensorWithDataAndDeleterAsOrtValue, ORT will free the memory using the provided deleter as
   *    soon as the OrtValue is no longer in use.
   *
   *    NOTE: A tensor containing pre-existing memory MUST have 128 bytes of data or more.
   *          For smaller tensors use CreateTensorAsOrtValue.
   *
   *          ONNX shape inferencing does not support external data. An initializer involved in shape inferencing is
   *          typically small (a single value or limited by the rank of a tensor) and uses less than 128 bytes of
   *          memory, so this limit acts as a simple catch-all rule to avoid issues.
   *          e.g. Reshape's `shape`, Clip's `min` and `max`, various ops `axes`.
   *
   * \param[in] graph The OrtGraph instance to update.
   * \param[in] name The value name for the initializer.
   * \param[in] tensor The OrtValue instance containing the tensor data.
   * \param[in] data_is_external Set to true if the data is external and should not be copied.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(AddInitializerToGraph, _Inout_ OrtGraph* graph, _In_ const char* name, _In_ OrtValue* tensor,
                  bool data_is_external);

  /** \brief Add an OrtNode to an OrtGraph
   *
   * Add the node to the graph. The OrtGraph will take ownership of OrtNode and you should NOT call ReleaseOrtNode.
   *
   * \param[in] graph The OrtGraph instance to update.
   * \param[in] node The OrtNode instance to add to the graph.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(AddNodeToGraph, _Inout_ OrtGraph* graph, _In_ OrtNode* node);

  /** \brief Create an OrtModel.
   *
   * Create an OrtModel.
   *
   * This can be used to build a new model, or to augment an existing model.
   *
   * \param[in] domain_names The domain names for the model.
   *                         If augmenting an existing model add additional domains if needed.
   * \param[in] opset_versions The opset versions for the model.
   *                           If augmenting an existing model add additional opset versions if needed.
   * \param[in] opset_entries_len The number of domain_names and opset_versions entries.
   *                              Domain and opset entries should be 1:1
   * \param[out] model The OrtModel instance.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(CreateModel,
                  _In_reads_(opset_entries_len) const char* const* domain_names,
                  _In_reads_(opset_entries_len) const int* opset_versions,
                  size_t opset_entries_len,
                  _Outptr_ OrtModel** model);

  /** \brief Add an OrtGraph to an OrtModel.
   *
   * Add the graph to a model. This should be called once when creating a new model.
   *
   * The OrtModel takes ownership of the OrtGraph and you should NOT call ReleaseOrtGraph.
   *
   * \param[in] model The OrtModel instance to update.
   * \param[in] graph The OrtGraph instance to add to the model.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(AddGraphToModel, _Inout_ OrtModel* model, _In_ OrtGraph* graph);

  /** \brief Create an OrtSession using the OrtModel.
   *
   * Create an inference session using the OrtModel instance.
   * The OrtModel should have been populated with an OrtGraph containing nodes and initializers, and SetGraphInputs
   * and SetGraphOutputs must have been called.
   * This will validate the model, run optimizers, and prepare the session for inferencing.
   *
   * ReleaseOrtModel must be called to free the OrtModel after session creation.
   *
   * \param[in] env The OrtEnv instance.
   * \param[in] model The OrtModel instance.
   * \param[in] options The OrtSessionOptions instance.
   * \param[out] out The OrtSession instance.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(CreateSessionFromModel, _In_ const OrtEnv* env, _In_ const OrtModel* model,
                  _In_ const OrtSessionOptions* options, _Outptr_ OrtSession** out);

  /** \brief Create an OrtSession to augment an existing model.
   *
   * Create an OrtSession with an existing model that will be augmented with additional nodes and initializers.
   * Nodes can be added before or after the existing nodes in the model. ONNX Runtime will connect the nodes when the
   * model is finalized.
   *
   * To add nodes and initializers to the existing model, first create an OrtModel using CreateModel.
   * Add nodes and initializers to the OrtModel using AddNodeToGraph and AddInitializerToGraph.
   * Graph inputs/outputs should be updated with SetGraphInputs and SetGraphOutputs as needed to reflect changes made
   * by the new nodes. The list of graph inputs/outputs should be for the overall model and not just the new nodes.
   *
   * Add the new information from the OrtModel to the original model using ApplyModelToSession, and prepare the
   * session for inferencing by calling FinalizeModelEditorSession.
   *
   * \param{in} env The OrtEnv instance.
   * \param{in} model_path The path to the existing ONNX model to augment.
   * \param{in} options The OrtSessionOptions instance.
   * \param{out} out The created OrtSession instance.
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(CreateModelEditorSession, _In_ const OrtEnv* env, _In_ const ORTCHAR_T* model_path,
                  _In_ const OrtSessionOptions* options,
                  _Outptr_ OrtSession** out);

  /** \brief Create an OrtSession to augment an existing model.
   *
   * Create an OrtSession with an existing model that will be augmented with additional nodes and initializers.
   * Nodes can be added before or after the existing nodes in the model. ONNX Runtime will connect the nodes when the
   * model is finalized.
   *
   * To add nodes and initializers to the existing model, first create an OrtModel using CreateModel.
   * Add nodes and initializers to the OrtModel using AddNodeToGraph and AddInitializerToGraph.
   * Graph inputs/outputs should be updated with SetGraphInputs and SetGraphOutputs as needed to reflect changes made
   * by the new nodes. The list of graph inputs/outputs should be for the overall model and not just the new nodes.
   *
   * Add the new information from the OrtModel to the original model using ApplyModelToSession, and prepare the
   * session for inferencing by calling FinalizeModelEditorSession.
   *
   * \param{in} env The OrtEnv instance.
   * \param{in} model_data The model data for the existing model to augment.
   * \param{in} model_data_length The length of the model data.
   * \param{in} options The OrtSessionOptions instance.
   * \param{out} out The created OrtSession instance.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(CreateModelEditorSessionFromArray, _In_ const OrtEnv* env,
                  _In_ const void* model_data, size_t model_data_length,
                  _In_ const OrtSessionOptions* options,
                  _Outptr_ OrtSession** out);

  /** \brief Query the session for the opset version of a domain.
   *
   * When using the Model Editor API to augment a model, any new nodes must conform to the opset version of the
   * original model. To do that the user must be able to discover that opset version.
   * Returns an error if the domain is not used in the model.
   *
   * \param[in] session OrtSession to query
   * \param[in] domain Domain to query. The ONNX domain is an empty string.
   * \param[out] opset The opset version of the domain.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(SessionGetOpsetForDomain, _In_ const OrtSession* session, _In_ const char* domain, _Out_ int* opset);

  /** \brief Apply changes to augment the ONNX model in a session created using CreateModelEditorSession[FromArray]
   *
   * Adds new nodes and updates graph inputs/outputs using `model` to augment the original ONNX model in the session.
   * All changes will be validated.
   * Call FinalizeModelEditorSession to prepare the session for inferencing.
   *
   * Existing input/outputs will only be updated if the OrtGraph inputs/outputs are set in the OrtModel.
   *   i.e. you don't need to call SetGraphInputs/SetGraphOutputs if they are unchanged.
   *
   * ReleaseOrtModel must be called to free the OrtModel after it is applied to the session.
   *
   * \param[in] session OrtSession to update. Session must have been created using CreateModelEditorSession[FromArray].
   * \param[in] model OrtModel containing new nodes, new initializers, and updated graph input and/or output info.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(ApplyModelToModelEditorSession, _Inout_ OrtSession* session, _In_ OrtModel* model);

  /** \brief Finalize the Model Editor session that was created using CreateModelEditorSession[FromArray].
   *
   * Finalize the Model Editor session that augmented an ONNX model by adding new nodes.
   * This will run optimizers and prepare the session for inferencing.
   *
   * \param[in] session OrtSession to finalize. Session must have been created using CreateModelEditorSession[FromArray].
   * \param[in] options OrtSessionOptions to use for the session.
   * \param[in] prepacked_weights_container Optional OrtPrepackedWeightsContainer to use for the session.
                Set to nullptr if not used.
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(FinalizeModelEditorSession, _Inout_ OrtSession* session, _In_ const OrtSessionOptions* options,
                  _In_opt_ OrtPrepackedWeightsContainer* prepacked_weights_container);
#endif  // !defined(ORT_MINIMAL_BUILD)
};

/**
 * ORT Compile API
 */

/** \brief Flags representing options to enable when compiling a model.
 */
typedef enum OrtCompileApiFlags {
  // Default. Do not enable any additional compilation options.
  OrtCompileApiFlags_NONE = 0,

  // Force compilation to return an error (ORT_FAIL) if no nodes were compiled.
  // Otherwise, a model with basic optimizations (ORT_ENABLE_BASIC) is still generated by default.
  OrtCompileApiFlags_ERROR_IF_NO_NODES_COMPILED = 1 << 0,

  // Force compilation to return an error (ORT_FAIL) if a file with the same filename as the output model exists.
  // Otherwise, compilation will automatically overwrite the output file if it exists.
  OrtCompileApiFlags_ERROR_IF_OUTPUT_FILE_EXISTS = 1 << 1,
} OrtCompileApiFlags;

/**
 * \brief The OrtCompileApi struct provides functions to compile ONNX models.
 *
 * Execution providers that support compilation fuse a subgraph into an EPContext node that wraps a provider-specific
 * binary representation of the subgraph.
 * For more details about the EPContext design, refer to:
 *  \htmlonly
 *  <a href="https://onnxruntime.ai/docs/execution-providers/EP-Context-Design.html">EPContext design document.</a>
 *  \endhtmlonly
 *
 * Example (error handling not shown):
 *   OrtStatus* status = NULL;
 *   OrtCompileApi* compile_api = ort_api->GetCompileApi();
 *   OrtModelCompilationOptions* compile_options = NULL;
 *
 *   status = compile_api->CreateModelCompilationOptionsFromSessionOptions(env, session_options, &compile_options);
 *   status = compile_api->ModelCompilationOptions_SetInputModelPath(compile_options, ORT_TSTR("model.onnx"));
 *   status = compile_api->ModelCompilationOptions_SetOutputModelPath(compile_options, ORT_TSTR("model.compiled.onnx"));
 *   status = compile_api->CompileModel(env, compile_options);
 *   compile_api->ReleaseModelCompilationOptions(compile_options);
 *
 * \since Version 1.22.
 */
struct OrtCompileApi {
  /// \name OrtModelCompilationOptions
  /// @{
  ORT_CLASS_RELEASE(ModelCompilationOptions);

  /** \brief Creates an OrtModelCompilationOptions object from an existing OrtSessionOptions object.
   *
   * An OrtModelCompilationOptions object contains the settings used to generate a compiled ONNX model.
   * The OrtSessionOptions object has the execution providers with which the model will be compiled.
   *
   * ReleaseOrtModelCompilationsOptions must be called to free the OrtModelCompilationOptions after calling
   * CompileModel.
   *
   * \note By default, the GraphOptimizationLevel is set to ORT_DISABLE_ALL. Use
   * ModelCompilationOptions_SetGraphOptimizationLevel to enable graph optimizations.
   *
   * \param[in] env OrtEnv object.
   * \param[in] session_options The OrtSessionOptions instance from which to create the OrtModelCompilationOptions.
   * \param[out] out The created OrtModelCompilationOptions instance.
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(CreateModelCompilationOptionsFromSessionOptions, _In_ const OrtEnv* env,
                  _In_ const OrtSessionOptions* session_options, _Outptr_ OrtModelCompilationOptions** out);

  /** \brief Sets the file path to the input ONNX model to compile.
   *
   * The input model's location (e.g., file path or memory buffer) must be set with either
   * ModelCompilationOptions_SetInputModelPath or ModelCompilationOptions_SetInputModelFromBuffer.
   *
   * \param[in] model_compile_options The OrtModelCompilationOptions instance.
   * \param[in] input_model_path Null terminated string of the path (wchar on Windows, char otherwise).
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(ModelCompilationOptions_SetInputModelPath, _In_ OrtModelCompilationOptions* model_compile_options,
                  _In_ const ORTCHAR_T* input_model_path);

  /** \brief Sets the buffer that stores the bytes of the loaded ONNX model to compile.
   *
   * The input model's location (e.g., file path or memory buffer) must be set with either
   * ModelCompilationOptions_SetInputModelPath or ModelCompilationOptions_SetInputModelFromBuffer.
   *
   * \param[in] model_compile_options The OrtModelCompilationOptions instance.
   * \param[in] input_model_data Buffer containing the loaded ONNX model bytes.
   * \param[in] input_model_data_size The number of bytes in the `input_model_data` buffer.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(ModelCompilationOptions_SetInputModelFromBuffer,
                  _In_ OrtModelCompilationOptions* model_compile_options,
                  _In_ const void* input_model_data,
                  size_t input_model_data_size);

  /** \brief Sets the file path for the output ONNX model generated by CompileModel.
   *
   * The output model's location (e.g., file path or memory buffer) can be set with either
   * ModelCompilationOptions_SetOutputModelPath or ModelCompilationOptions_SetOutputModelBuffer.
   *
   * If the output model's location is not set, ONNX Runtime will generate an output file with a path based on
   * the input model's file path. Examples:
   *   /Path/my_model.onnx -> /Path/my_model_ctx.onnx
   *   /Path/my_model -> /Path/my_model_ctx.onnx
   *
   * \param[in] model_compile_options The OrtModelCompilationOptions instance.
   * \param[in] output_model_path Null terminated string of the path (wchar on Windows, char otherwise).
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(ModelCompilationOptions_SetOutputModelPath, _In_ OrtModelCompilationOptions* model_compile_options,
                  _In_ const ORTCHAR_T* output_model_path);

  /** \brief Optionally sets the file that should store external initializers for the compiled ONNX model.
   * If not set, initializers are stored within the model.
   *
   * Only initializers for nodes that were not compiled are stored in the external initializers file.
   * Compiled nodes contain their initializer data within the `ep_cache_context` attribute of EPContext nodes.
   * Refer to ModelCompilationOptions_SetEpContextEmbedMode.
   *
   * \param[in] model_compile_options The OrtModelCompilationOptions instance.
   * \param[in] external_initializers_file_path Null terminated string of the path to the file.
   * \param[in] external_initializers_size_threshold Initializers larger than this threshold are stored in the file.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(ModelCompilationOptions_SetOutputModelExternalInitializersFile,
                  _In_ OrtModelCompilationOptions* model_compile_options,
                  _In_ const ORTCHAR_T* external_initializers_file_path,
                  size_t external_initializers_size_threshold);

  /** \brief Configures model compilation to store the output compiled ONNX model in a buffer.
   *
   * The caller passes an OrtAllocator that ONNX Runtime uses to allocate memory for the buffer.
   *
   * The output model's location (e.g., file path or memory buffer) can be set with either
   * ModelCompilationOptions_SetOutputModelPath or ModelCompilationOptions_SetOutputModelBuffer.
   *
   * If the output model's location is not set, ONNX Runtime will generate an output file with a path based on
   * the input model's file path. Examples:
   *   /Path/my_model.onnx -> /Path/my_model_ctx.onnx
   *   /Path/my_model -> /Path/my_model_ctx.onnx
   *
   * \param[in] model_compile_options The OrtModelCompilationOptions instance.
   * \param[in] allocator The allocator used to allocate the buffer for the compiled model.
   * \param[out] output_model_buffer_ptr Pointer to the buffer that stores the compiled model.
   * \param[out] output_model_buffer_size_ptr Pointer set to the size of output model in bytes.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(ModelCompilationOptions_SetOutputModelBuffer,
                  _In_ OrtModelCompilationOptions* model_compile_options,
                  _Inout_ OrtAllocator* allocator,
                  _Outptr_ void** output_model_buffer_ptr,
                  _Out_ size_t* output_model_buffer_size_ptr);

  /** \brief Enables or disables the embedding of EPContext binary data into the `ep_cache_context` attribute
   * of EPContext nodes. Defaults to false.
   *
   * If enabled, the `ep_cache_context` attribute of EPContext nodes will store the context binary data, which may
   * include weights for compiled subgraphs.
   *
   * If disabled, the `ep_cache_context` attribute of EPContext nodes will contain the path to the file containing the
   * context binary data. The path is set by the execution provider creating the EPContext node.
   *
   * More details relate to EPContext design refers to:
   *  \htmlonly
   *  <a href="https://onnxruntime.ai/docs/execution-providers/EP-Context-Design.html">EPContext design document.</a>
   *  \endhtmlonly
   *
   * \param[in] model_compile_options The OrtModelCompilationOptions instance.
   * \param[in] embed_ep_context_in_model True to embed EPContext binary data into the EPContext node
   *                                      `ep_cache_context` attributes.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(ModelCompilationOptions_SetEpContextEmbedMode, _In_ OrtModelCompilationOptions* model_compile_options,
                  bool embed_ep_context_in_model);

  /** \brief Compiles an input ONNX model with the given compilation options.
   *
   * \param[in] env OrtEnv object.
   * \param[in] model_options The compilation options that defines compilation options for a model.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.22.
   */
  ORT_API2_STATUS(CompileModel, _In_ const OrtEnv* env, _In_ const OrtModelCompilationOptions* model_options);

  /** \brief Sets flags from OrtCompileApiFlags that represent one or more boolean options to enable.
   *
   * \param[in] model_compile_options The OrtModelCompilationOptions instance.
   * \param[in] flags bitwise OR of flags in OrtCompileApiFlags to enable.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(ModelCompilationOptions_SetFlags, _In_ OrtModelCompilationOptions* model_compile_options,
                  uint32_t flags);

  /** Sets information related to EP context binary file.
   *
   * EP uses this information to decide the location and context binary file name.
   * Used while compiling model with input and output in memory buffer
   *
   * \param[in] model_compile_options The OrtModelCompilationOptions instance.
   * \param[in] output_directory Null terminated string of the path (wchar on Windows, char otherwise).
   * \param[in] model_name Null terminated string of the model name (wchar on Windows, char otherwise).
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(ModelCompilationOptions_SetEpContextBinaryInformation,
                  _In_ OrtModelCompilationOptions* model_compile_options,
                  _In_ const ORTCHAR_T* output_directory,
                  _In_ const ORTCHAR_T* model_name);

  /** Set the graph optimization level.
   *
   * \param[in] model_compile_options The OrtModelCompilationOptions instance.
   * \param[in] graph_optimization_level The graph optimization level.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(ModelCompilationOptions_SetGraphOptimizationLevel,
                  _In_ OrtModelCompilationOptions* model_compile_options,
                  _In_ GraphOptimizationLevel graph_optimization_level);

  /** \brief Sets a OrtWriteBufferFunc function that is called by ORT to write out the output model's serialized
   * ONNX bytes.
   *
   * The provided write function may be called repeatedly until then entire output model has been written out. Each call
   * to the write function is expected to consume the entire input buffer.
   *
   * The output model's destination (e.g., file path, memory buffer, or stream) can be set with any of the functions
   * that begin with ModelCompilationOptions_SetOutputModel____.
   *
   * \param[in] model_compile_options The OrtModelCompilationOptions instance.
   * \param[in] write_func The OrtWriteBufferFunc function called by ORT when writing out the model.
   * \param[in] state Opaque state passed as the first argument to OrtWriteBufferFunc. Can be NULL.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(ModelCompilationOptions_SetOutputModelWriteFunc,
                  _In_ OrtModelCompilationOptions* model_compile_options,
                  _In_ OrtWriteBufferFunc write_func, _In_ void* state);

  /** \brief Sets a OrtGetInitializerLocationFunc function that is called by ORT for every initializer in the generated
   * model. Allows implementer to specify whether initializers should be stored within the model or externally.
   *
   * \param[in] model_compile_options The OrtModelCompilationOptions instance.
   * \param[in] get_initializer_location_func The OrtGetInitializerLocationFunc function called by ORT when
   *                                          to determine the location of the initializer.
   * \param[in] state Opaque state passed as the first argument to OrtGetInitializerLocationFunc. Can be NULL.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.23.
   */
  ORT_API2_STATUS(ModelCompilationOptions_SetOutputModelGetInitializerLocationFunc,
                  _In_ OrtModelCompilationOptions* model_compile_options,
                  _In_ OrtGetInitializerLocationFunc get_initializer_location_func, _In_ void* state);
};

/**
 * \brief The OrtInteropApi struct provides functions for external resource interop with execution providers.
 *
 * This API enables importing external GPU resources (memory and semaphores) for zero-copy sharing
 * between ORT inference and other GPU workloads (e.g., D3D12 applications, media pipelines).
 *
 * The API is designed to be EP-agnostic and can be extended to support various GPU interop mechanisms
 * (D3D12 shared handles, CUDA external memory, Vulkan, etc.).
 *
 * Example usage (error handling not shown):
 *   const OrtInteropApi* interop_api = ort_api->GetInteropApi();
 *   OrtExternalResourceImporter* importer = NULL;
 *
 *   status = interop_api->CreateExternalResourceImporterForDevice(ep_device, &importer);
 *   if (importer == nullptr) {
 *     // External resource import is optional for EPs to implement
 *     return;
 *   }
 *   bool can_import = false;
 *   status = interop_api->CanImportMemory(importer, ORT_EXTERNAL_MEMORY_HANDLE_TYPE_D3D12_RESOURCE, &can_import);
 *   if (can_import) {
 *     OrtExternalMemoryHandle* mem_handle = NULL;
 *     status = interop_api->ImportMemory(importer, &mem_desc, &mem_handle);
 *     // ... use mem_handle to create tensors ...
 *     interop_api->ReleaseExternalMemoryHandle(mem_handle);
 *   }
 *   interop_api->ReleaseExternalResourceImporter(importer);
 *
 * \since Version 1.24.
 */
struct OrtInteropApi {
  /// \name OrtExternalResourceImporter
  /// @{

  /** \brief Create an external resource importer for a specific EP device.
   *
   * The external resource importer is a capability object that provides methods for importing
   * external GPU memory and semaphores for zero-copy import with an execution provider.
   *
   * This is an optional EP capability. If the EP does not support external resource import,
   * out_importer is set to nullptr and the function returns success (nullptr status).
   * This allows callers to use the simple "if (status != nullptr) handle_error()" pattern
   * and check out_importer separately for capability detection.
   *
   * \param[in] ep_device The OrtEpDevice instance to create the importer for.
   * \param[out] out_importer Output parameter set to the created OrtExternalResourceImporter instance,
   *                          or nullptr if the EP does not support external resource import.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24.
   */
  ORT_API2_STATUS(CreateExternalResourceImporterForDevice,
                  _In_ const OrtEpDevice* ep_device,
                  _Outptr_result_maybenull_ OrtExternalResourceImporter** out_importer);

  /** \brief Release an OrtExternalResourceImporter instance.
   *
   * \param[in] input The OrtExternalResourceImporter instance to release. May be nullptr.
   *
   * \since Version 1.24.
   */
  ORT_CLASS_RELEASE(ExternalResourceImporter);

  /// @}
  /// \name Memory Import
  /// @{

  /** \brief Check if the external resource importer can import a specific memory handle type.
   *
   * \param[in] importer The OrtExternalResourceImporter instance.
   * \param[in] handle_type The type of external memory handle to check.
   * \param[out] out_supported Set to true if the handle type is supported.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24.
   */
  ORT_API2_STATUS(CanImportMemory,
                  _In_ const OrtExternalResourceImporter* importer,
                  _In_ OrtExternalMemoryHandleType handle_type,
                  _Out_ bool* out_supported);

  /** \brief Import external memory into the execution provider.
   *
   * \param[in] importer The OrtExternalResourceImporter instance.
   * \param[in] desc Descriptor containing the external memory handle and properties.
   * \param[out] out_handle Output parameter set to the created OrtExternalMemoryHandle.
   *                        The caller owns the returned handle and must call ReleaseExternalMemoryHandle to free it.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24.
   */
  ORT_API2_STATUS(ImportMemory,
                  _In_ OrtExternalResourceImporter* importer,
                  _In_ const OrtExternalMemoryDescriptor* desc,
                  _Outptr_ OrtExternalMemoryHandle** out_handle);

  /** \brief Release an OrtExternalMemoryHandle instance.
   *
   * \param[in] input The OrtExternalMemoryHandle instance to release. May be nullptr.
   *
   * \since Version 1.24.
   */
  ORT_CLASS_RELEASE(ExternalMemoryHandle);

  /** \brief Create a tensor backed by imported external memory.
   *
   * The created tensor is a view over the imported memory and does not copy data.
   * The OrtExternalMemoryHandle must remain valid for the lifetime of the tensor.
   *
   * \param[in] importer The OrtExternalResourceImporter instance.
   * \param[in] mem_handle The imported external memory handle.
   * \param[in] tensor_desc Descriptor specifying tensor element type, shape, and optional offset.
   * \param[out] out_tensor Output parameter set to the created OrtValue containing the tensor.
   *                        The caller owns the returned tensor and must call ReleaseValue to free it.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24.
   */
  ORT_API2_STATUS(CreateTensorFromMemory,
                  _In_ OrtExternalResourceImporter* importer,
                  _In_ const OrtExternalMemoryHandle* mem_handle,
                  _In_ const OrtExternalTensorDescriptor* tensor_desc,
                  _Outptr_ OrtValue** out_tensor);

  /// @}
  /// \name Semaphore Import
  /// @{

  /** \brief Check if the external resource importer can import a specific semaphore type.
   *
   * \param[in] importer The OrtExternalResourceImporter instance.
   * \param[in] type The type of external semaphore to check.
   * \param[out] out_supported Set to true if the semaphore type is supported.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24.
   */
  ORT_API2_STATUS(CanImportSemaphore,
                  _In_ const OrtExternalResourceImporter* importer,
                  _In_ OrtExternalSemaphoreType type,
                  _Out_ bool* out_supported);

  /** \brief Import an external semaphore into the execution provider.
   *
   * The returned OrtExternalSemaphoreHandle can be used with WaitSemaphore and an OrtSyncStream
   * to synchronize execution with external operations.
   *
   * \param[in] importer The OrtExternalResourceImporter instance.
   * \param[in] desc Descriptor containing the external semaphore handle and type.
   * \param[out] out_handle Output parameter set to the created OrtExternalSemaphoreHandle.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24.
   */
  ORT_API2_STATUS(ImportSemaphore,
                  _In_ OrtExternalResourceImporter* importer,
                  _In_ const OrtExternalSemaphoreDescriptor* desc,
                  _Outptr_ OrtExternalSemaphoreHandle** out_handle);

  /** \brief Release an OrtExternalSemaphoreHandle instance.
   *
   * \param[in] input The OrtExternalSemaphoreHandle instance to release. May be nullptr.
   *
   * \since Version 1.24.
   */
  ORT_CLASS_RELEASE(ExternalSemaphoreHandle);

  /** \brief Wait on an external semaphore on the EP's stream.
   *
   * Inserts a wait operation into the EP's stream that blocks until the semaphore
   * reaches the specified value. This is used to synchronize with external GPU work
   * (e.g., D3D12 timeline fence).
   *
   * \param[in] importer The OrtExternalResourceImporter instance.
   * \param[in] semaphore_handle The imported external semaphore.
   * \param[in] stream The OrtSyncStream to wait on.
   * \param[in] value The fence/semaphore value to wait for.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24.
   */
  ORT_API2_STATUS(WaitSemaphore,
                  _In_ OrtExternalResourceImporter* importer,
                  _In_ OrtExternalSemaphoreHandle* semaphore_handle,
                  _In_ OrtSyncStream* stream,
                  _In_ uint64_t value);

  /** \brief Signal an external semaphore from the EP's stream.
   *
   * Inserts a signal operation into the EP's stream that sets the semaphore
   * to the specified value when reached. This is used to notify external GPU work
   * (e.g., D3D12 timeline fence) that ORT inference is complete.
   *
   * \param[in] importer The OrtExternalResourceImporter instance.
   * \param[in] semaphore_handle The imported external semaphore.
   * \param[in] stream The OrtSyncStream to signal from.
   * \param[in] value The fence/semaphore value to signal.
   *
   * \snippet{doc} snippets.dox OrtStatus Return Value
   *
   * \since Version 1.24.
   */
  ORT_API2_STATUS(SignalSemaphore,
                  _In_ OrtExternalResourceImporter* importer,
                  _In_ OrtExternalSemaphoreHandle* semaphore_handle,
                  _In_ OrtSyncStream* stream,
                  _In_ uint64_t value);

  /// @}
};

/*
 * This is the old way to add the CUDA provider to the session, please use SessionOptionsAppendExecutionProvider_CUDA above to access the latest functionality
 * This function always exists, but will only succeed if Onnxruntime was built with CUDA support and the CUDA provider shared library exists
 *
 * \param device_id CUDA device id, starts from zero.
 */
ORT_API_STATUS(OrtSessionOptionsAppendExecutionProvider_CUDA, _In_ OrtSessionOptions* options, int device_id);

/*
 * This is the old way to add the ROCm provider to the session, please use
 * SessionOptionsAppendExecutionProvider_ROCM above to access the latest functionality
 * This function always exists, but will only succeed if Onnxruntime was built with
 * HIP support and the ROCm provider shared library exists
 *
 * \param device_id HIP device id, starts from zero.
 */
ORT_API_STATUS(OrtSessionOptionsAppendExecutionProvider_ROCM, _In_ OrtSessionOptions* options, int device_id);

/*
 * This is the old way to add the MIGraphX provider to the session, please use
 * SessionOptionsAppendExecutionProvider_MIGraphX above to access the latest functionality
 * This function always exists, but will only succeed if Onnxruntime was built with
 * HIP support and the MIGraphX provider shared library exists
 *
 * \param device_id HIP device id, starts from zero.
 */
ORT_API_STATUS(OrtSessionOptionsAppendExecutionProvider_MIGraphX, _In_ OrtSessionOptions* options, int device_id);

/*
 * This is the old way to add the oneDNN provider to the session, please use
 * SessionOptionsAppendExecutionProvider_oneDNN above to access the latest functionality
 * This function always exists, but will only succeed if Onnxruntime was built with
 * oneDNN support and the oneDNN provider shared library exists
 *
 * \param use_arena zero: false. non-zero: true.
 */
ORT_API_STATUS(OrtSessionOptionsAppendExecutionProvider_Dnnl, _In_ OrtSessionOptions* options, int use_arena);

/*
 * This is the old way to add the TensorRT provider to the session, please use SessionOptionsAppendExecutionProvider_TensorRT_V2 above to access the latest functionality
 * This function always exists, but will only succeed if Onnxruntime was built with TensorRT support and the TensorRT provider shared library exists
 *
 * \param device_id CUDA device id, starts from zero.
 */
ORT_API_STATUS(OrtSessionOptionsAppendExecutionProvider_Tensorrt, _In_ OrtSessionOptions* options, int device_id);

#ifdef __cplusplus
}
#endif
/// @}

#include "onnxruntime_ep_c_api.h"
