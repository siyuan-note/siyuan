// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

// 桌面端主进程入口：只做进程级环境设置与启动调用，启动流程本身在 `startup/bootstrap.ts`。

// 环境变量要在启动依赖图求值之前生效，因此用副作用导入放在最前。
import "./environment";
import {bootstrap} from "./startup/bootstrap";

void bootstrap();
