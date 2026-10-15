#pragma once
#include <stddef.h>
#include <stdint.h>

typedef struct SyOCRSession SyOCRSession;
typedef struct SyOCROutput SyOCROutput;
char *sy_ocr_init(const char *library);
char *sy_ocr_session(const void *model, size_t size, SyOCRSession **session);
void sy_ocr_close(SyOCRSession *session);
char *sy_ocr_options(void **options);
void sy_ocr_cancel(void *options);
void sy_ocr_free_options(void *options);
char *sy_ocr_run(SyOCRSession *session, void *options, float *input, size_t count, const int64_t *shape, SyOCROutput **output);
int sy_ocr_output(SyOCROutput *output, const float **data, const int64_t **shape, size_t *rank, size_t *count);
void sy_ocr_free_output(SyOCROutput *output);
