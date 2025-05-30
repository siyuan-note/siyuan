## 如何编译
### 运行内核
在`kernel`目录下运行`go run`命令可以将kernel内容运行起来
``` bash
cd kernel
go run main.go
```

### 编译内核
在`kernel`目录下运行`go build`命令可以将kernel内容编译成可执行文件

**注意：这个是客户端运行的基础**
``` bash
cd kernel
# 客户端依赖这个内核
go build -o ../app/kernel/SiYuan-Kernel
```

### 运行客户端程序
在`app`目录下运行如下命令将程序启动起来

**注意：需要先运行`pnpm install && pnpm rebuild` 将electron 客户端安装到本地**

### 安装依赖
``` bash
cd app
# 安装依赖包
# 安装electron客户端包
pnpm install && pnpm rebuild

### 编译客户端页面
```bash
# 运行编译命令
pnpm run build:desktop & pnpm run build:mobile & pnpm run build:app & pnpm run build:export
# 或者
pnpm run build
```

### 启动程序
```bash
cd app
./kernel/SiYuan-Kernel && pnpm run start
```


### 打包
```bash
pnpm run dist
```