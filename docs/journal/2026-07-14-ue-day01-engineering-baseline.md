---
title: "Day 01：基于 Third Person 模板建立可恢复、可构建、可调试的 UE 5.8 C++ 工程基线"
description: "通过 Project Aegis 验证 UE 5.8 C++ 工程从环境配置、版本管理到 DebugGame 源码调试的完整基线。"
date: 2026-07-14
domain: ue
type: journal
series: ue-client-roadmap
tags:
  - Unreal Engine 5
  - C++
  - Project Aegis
  - Build System
  - DebugGame
status: published
outline: deep
---

# Day 01：基于 Third Person 模板建立可恢复、可构建、可调试的 UE 5.8 C++ 工程基线

## 背景与目标

### 背景
在成都找游戏工作时，发现招聘的游戏岗位 JD 上很多都会有 UE 或 Unity 开发经验，我自己之前是在 QQ 炫舞做客户端开发，但是 QQ 炫舞是使用自研引擎开发的，结合成都的真实岗位需求，所以决定开始自学 UE，将已有 C++ 游戏开发经验迁移到 UE 技术体系。

### 长期方向
总目标掌握 UE 开发游戏所需的系统能力，补齐基于 UE 的 Gameplay、GAS、AI、网络、资源、测试和性能优化等能力，自己能上手参与真实的 UE 商业游戏项目。

### Day 01 目标
今天的目标是使用 UE、Git、Git LFS、Visual Studio 等开发工具，在本地搭建可恢复、可构建、可调试的 Project Aegis 工程基线。并验证项目仓库可以使用 `git clone` 恢复，项目可以编译成功，ProjectAegisEditor 和 PIE（Play In Editor）可以运行；Project Aegis 可以使用 Visual Studio 进行调试。

### 验收标准

注意仅仅只是能在本机打开，还不足以说明是一个可开发、可恢复、可调试的工程基线，必须保证能在自己机器的另一个独立的开发环境目录中使用远程仓库 Clone 成功、编译成功，才能说明可恢复、可构建。

- 项目恢复能力：可以在同机独立目录中 Clone 项目文件，关键文件存在，一些被 Git 忽略的文件不存在。
- 项目构建能力：可以在 Project Aegis 和 Clone 目录中编译，且没有报错，关键 DLL 和 PDB 存在，`ExitCode` 为 0。
- 项目运行能力：可以在 Project Aegis 项目目录和对应 Clone 目录中启动编辑器和 PIE。
- 项目调试能力：可以在使用 Visual Studio 进行调试 `ProjectAegisEditor`，命中写的 `StartupModule()` 函数。
- 版本控制与证据：能正常使用 Git 提交代码和 Git LFS 管理大文件，且工程的主支 `main` 与远程仓库同步，本地工作区保持干净，Git 提交历史可追踪。

## 关键概念

### Target、Platform 与 Build Configuration

注：`Project Aegis` 是我学习 UE 时的工程名字

| 维度 | 解决的问题 | Project Aegis 中的实例 |
|---|---|---|
| Target | 需要构建的 UE 程序的角色 | `ProjectAegisEditor`（Editor Target） |
| Platform | 确定 UE 程序的目标运行操作系统、硬件架构和对应的工具链 | `Win64` |
| Build Configuration | UE 程序代码采用什么编译策略和规则进行编译，不同的编译策略和规则，对程序做的优化不一样，调试效果也不一样 | `Development` 和 `DebugGame` |

Target、Platform、Build Configuration 是三个不同的维度。
Target 描述的是产品角色，比如 `Editor`、`Game`、`Server` 等。
Platform 描述的是产品的运行操作系统、硬件架构和对应的工具链，比如 `Win64`。
Build Configuration 是构建策略、发布策略、优化策略，规定了在编译代码时做什么优化；会影响代码优化程度、调试信息和调试体验。

这三个维度可以组合，但不是任意组合，也不是一一对应，能否组合受到 `TargetRules`、产品角色、目标平台、平台工具链、硬件架构和引擎的支持范围影响。
在我实践的 `Project Aegis` 中实际验证了以下两组组合：

- `ProjectAegisEditor × Win64 × Development`。
- `ProjectAegisEditor × Win64 × DebugGame`。

在上述的两种组合中，`Target`（都是 `ProjectAegisEditor`）和 `Platform`（都是 `Win64`）相同，但是 `Build Configuration` 不同。这恰恰说明这三个维度可以组合但不是一一对应的。

## 实践过程

### 环境与工程创建

| 工具 | 版本 | 本次用途 |
|---|---|---|
| Unreal Engine | `5.8.0` | 创建和编辑 `Project Aegis`、启动 Unreal Editor、运行 PIE |
| Visual Studio 2022 | `17.14.35` | 编写 C++ 代码、调试代码、项目构建 |
| MSVC | `14.44.35207` | 编译和链接 `Project Aegis` 的 C++ 模块 |
| Windows SDK | `10.0.22621.0`、`10.0.26100.0` | 提供 `Win64` 构建所需的头文件、库以及工具 |

#### 工具版本选择原因

- 选择 `UE 5.8` 是因为 `Project Aegis` 在启动时选择 `UE 5.8` 作为统一基线，后面的所有学习、代码和资产都基于这个版本积累。
- 选择 `Visual Studio 2022` 是因为我之前常用的就是这个版本，且 `UE 5.8` 工程支持 `Visual Studio 2022`，可以通过它完成 `C++` 代码编写、项目构建和调试。
- 学习期间锁定 `UE` 版本，用于保持 `UE API`、构建规则、插件兼容性、资产版本相对稳定，并减少版本变化可能带来的额外理解成本、额外排障。

#### 如何建立 Project Aegis

- 使用 `UE 5.8` 自带的 `Third Person` 模板的 `C++` 项目，创建 `ProjectAegis` 项目。
- `Third Person` 模板提供了基础内容：可控制的第三人称角色、相机、角色网格与动画、可直接进入 `PIE` 的最小玩法闭环、`Character Movement` 组件、输入系统。
- 之所以选择 `Third Person` 模板作为基线，是因为该模板提供了一个已经可运行的角色、输入、移动、相机和动画起点，后续还可以在同一个项目上加入 `Gameplay`、`AI`、网络、资源与性能等内容，减少从空工程重新搭建基础可控角色、输入、移动、相机、动画的工作。

#### 第一次运行效果

- 第一次构建用时在 35 分钟左右，没有模块缺失、编译失败等异常提示。
- 使用 `Unreal Editor` 可以成功打开 `Project Aegis` 进入默认第三人称地图，且可以进入 `PIE`，`PIE` 退出正常。
- `W`、`A`、`S`、`D` 键移动功能正常。
- 鼠标操作相机正常。
- 空格键跳跃功能正常。
- `Unreal Editor` 关闭功能正常。
- 没有出现报错和异常。

### Git 与可恢复工程基线

#### 仓库与 Git LFS 基线

| 管理对象 | 使用方式 | 原因 |
|---|---|---|
| `Source/` 中的 `C++` 源码、`Config/` 配置、`ProjectAegis.uproject` | Git | 这些主要是文本内容，适合进行差异对比，可以审核修改，可以追踪历史 |
| `*.uasset`、`*.umap` 等 UE 二进制资产 | Git LFS | 二进制资产不适合普通文本的差异对比，体积可能也比较大，适合使用 Git LFS 管理实际文件对象，Git 提交中保存 LFS 指针 |
| `*.sln`、`DerivedDataCache/`、`Intermediate/`、`.vs/`、`Saved/`、`Binaries/` | `.gitignore` 排除 | 可重新生成的构建产物、缓存、工作区数据排除之后，可以减少无意义变更，控制仓库体积，减少不同机器的冲突；`*.sln` 可以根据 UE 工程规则重新生成；`.vs/` 是本机 IDE 工作区 |

- 远程仓库是 `JeromeJtw/ProjectAegis`，可见性是 `Private`。
- 基线提交的标题是 `chore(project): initialize UE 5.8 C++ project baseline`，提交 hash 是 `600d80b288542c242c02d84b198a32c79196b73d`。
- 提交文件数量是 850，提交之后本地 `main` 和 `origin/main` 同步，工作区 `clean`。初始化提交可以追踪和回滚。
- Git LFS 管理的核心资产有 `.uasset`、`.umap`、`.ubulk`、`.uexp`、`.uptnl`，还有常见的美术资源。
- Git LFS 文件数量是 753。
- Git LFS 首次上传 100% 成功。
- 首次推送完成后，`git lfs status` 没有显示待处理内容。

#### 干净 Clone 恢复验证

- 为了验证工程的可恢复、可构建，在同机的另一个独立目录中 `Clone` 了 `Project Aegis`。
- 验证结果证明了仓库内容、`Git LFS` 资产和基础恢复流程有效。

| 验证项 | 已验证结果 | 详细描述 |
|---|---|---|
| `Clone` | 成功 | 能从远程仓库恢复到同机的独立目录 |
| `Clone HEAD` | `600d80b288542c242c02d84b198a32c79196b73d` | 和初始化基线提交一致 |
| `Git LFS Pull` | 成功，共 753 个 `LFS` 文件 | `LFS` 资产能够恢复 |
| `LFS` 测试资产 | 20.03 MB，不是 `LFS` 指针文本 | 恢复的是实际二进制资产 |
| 初始生成目录 | 被忽略的生成目录和本机工作区文件不存在 | `.gitignore` 生效，仓库没有依赖生成产物 |
| 关键交付文件 | 全部存在 | `ProjectAegis.uproject`、`Source/`、`Config/`、`Content/` 等工程输入已经恢复 |

#### Clone 中的项目文件生成

- 初始 `Clone` 没有 `ProjectAegis.sln`，它属于可以重新生成且是被 `Git` 忽略的文件。
- 本机的 `UE 5.8 Launcher` 安装中没有此前预期的 `GenerateProjectFiles.bat`。
- 实际使用 `UE` 自带的 `dotnet.exe` 调用 `UnrealBuildTool.dll`，并使用 `Mode=GenerateProjectFiles` 生成项目文件。
- 项目文件生成的 `ExitCode` 为 0。
- `ProjectAegis.sln` 成功生成。
- 证明解决方案文件可以根据已提交的 `UE` 工程规则重新生成，仓库不需要提交 `.sln`。

#### Clone 中的 Development 构建验证

- 构建组合为 `ProjectAegisEditor × Win64 × Development`。
- 构建成功，没有异常报错，`ExitCode` 为 0。
- 本机本次构建耗时为 0.92 分钟。
- 生成了 `UnrealEditor-ProjectAegis.dll`，对应的 `UnrealEditor-ProjectAegis.pdb` 存在。
- 证明了从远程仓库恢复的源码和工程配置能够重新生成模块二进制与调试符号文件。

#### Clone 中的 Editor 与 PIE 运行验证

- `Unreal Editor` 从 `Clone` 工程成功启动，本机启动耗时小于 1 分钟。
- 已确认打开的是独立 `Clone` 中的 `ProjectAegis-Clone`，不是原开发工程。
- 可以正常进入和退出 `PIE`。
- `W`、`A`、`S`、`D` 键移动、鼠标相机和空格键跳跃均正常。
- 没有出现模块、蓝图或资产加载错误。
- `Unreal Editor` 可以正常关闭。
- 关闭后 `Clone` 仓库的 `main` 与 `origin/main` 同步，工作区 `clean`。

远程 `Clone` 项目后，`Git LFS` 实际资产恢复，代码等文件恢复，项目文件重新生成，`Development` 构建成功，`Unreal Editor` 与 `PIE` 正常运行且没有模块、蓝图或资产加载错误。这些证据共同证明 `Project Aegis` 能够从远程仓库恢复到可构建、可运行状态。

### 主工程的模块生命周期实验

- 默认的 `FDefaultGameModuleImpl` 没有可观察的自定义启动/关闭行为；
- 为了验证模块加载与卸载时机，并为后续 `DebugGame` 源码断点提供位置，创建了 `FProjectAegisModule`；
- 该实验只增加生命周期日志，不改变 `Gameplay` 功能。

```cpp
class FProjectAegisModule final : public FDefaultGameModuleImpl
{
public:

	virtual void StartupModule() override
	{
		FDefaultGameModuleImpl::StartupModule();
		UE_LOG(LogProjectAegis, Log, TEXT("ProjectAegis module StartupModule"));
	}

	virtual void ShutdownModule() override
	{
		UE_LOG(LogProjectAegis, Log, TEXT("ProjectAegis module ShutdownModule"));
		FDefaultGameModuleImpl::ShutdownModule();
	}
};

IMPLEMENT_PRIMARY_GAME_MODULE(FProjectAegisModule, ProjectAegis, "ProjectAegis");
```

- `IMPLEMENT_PRIMARY_GAME_MODULE` 通过宏让模块管理器创建自定义的 `FProjectAegisModule`。
- `StartupModule()` 和 `ShutdownModule()` 是模块生命周期回调，分别由模块管理器在模块加载后的启动阶段和正常卸载前的关闭阶段调用；它们不属于 `Actor` 生命周期，也不同于 `BeginPlay()`。

#### 生命周期修改后的 Development 构建验证

- 这是主工程修改 `FProjectAegisModule` 后的 `Development` 增量构建，不是前面 `Clone` 中耗时 0.92 分钟的构建。
- 构建前 `Unreal Editor` 和 `Visual Studio` 均已关闭。
- 构建组合是 `ProjectAegisEditor × Win64 × Development`。
- 构建成功，`ExitCode` 为 0。
- 本机本次构建耗时为 0.89 分钟。
- 没有 `Warning`。
- `UnrealEditor-ProjectAegis.dll` 和 `UnrealEditor-ProjectAegis.pdb` 均存在。
- 这证明自定义模块实现能够通过编译和链接；是否按预期加载与卸载，可以通过运行日志验证。

#### 模块启动运行验证

- `Unreal Editor` 成功启动，本机启动耗时约 30 秒。
- 已确认打开的是主工程 `Project Aegis`，不是 `Clone` 工程。
- 没有出现模块缺失或重新编译提示。
- `StartupModule()` 日志出现 1 次。
- 启动阶段没有出现其他 `Error`。
- 这证明 `IMPLEMENT_PRIMARY_GAME_MODULE` 已让模块管理器创建并启动自定义的 `FProjectAegisModule`。

```text
LogProjectAegis: ProjectAegis module StartupModule
```

#### 两轮 PIE 与模块生命周期验证

| 验证时点 | `StartupModule()` 次数 | `ShutdownModule()` 次数 | `PIE` 与基础功能 |
|---|---:|---:|---|
| `Unreal Editor` 启动后 | 1 | 0 | 尚未进入 `PIE` |
| 第一轮 `PIE` 结束后 | 1 | 0 | `PIE` 成功，移动、相机和跳跃正常 |
| 第二轮 `PIE` 结束后 | 1 | 0 | `PIE` 成功，移动、相机和跳跃正常 |

- 两轮 `PIE` 都成功，没有出现新的 `Error`；
- 开始和结束 `PIE` 主要创建、运行并销毁 `Gameplay World`；
- `ProjectAegis` 游戏模块仍然加载在同一个 `Unreal Editor` 进程中，因此 `StartupModule()` 没有再次执行，`ShutdownModule()` 也尚未执行；
- 这证明模块生命周期长于单轮 `PIE`，也长于该轮 `PIE World` 和 `Actor` 的运行生命周期。

#### Editor 关闭与模块卸载验证

- `Unreal Editor` 正常关闭。
- 关闭后使用 `Get-Process` 检查，已没有 `Unreal Editor` 进程。
- 日志文件为工程内的 `Saved/Logs/ProjectAegis.log`。
- 最终 `StartupModule()` Count 为 1。
- 最终 `ShutdownModule()` Count 为 1。
- 关闭阶段没有出现 `Error`。
- 这说明本次运行中，`ShutdownModule()` 不是在 `PIE` 结束时执行，而是在 `Unreal Editor` 关闭、模块正常卸载阶段执行。

```text
[2026.07.13-10.17.33:428][  0]LogProjectAegis: ProjectAegis module StartupModule
[2026.07.13-10.26.46:962][743]LogProjectAegis: ProjectAegis module ShutdownModule
```

`Unreal Editor` 进程中的模块只启动一次，经历两轮 `PIE` 后仍保持加载，并在 `Unreal Editor` 正常关闭时执行一次卸载回调。

### DebugGame 构建与源码调试

#### DebugGame 构建验证

- 构建前 `Unreal Editor` 和 `Visual Studio` 均已关闭。
- 构建组合是 `ProjectAegisEditor × Win64 × DebugGame`。
- 构建成功，`ExitCode` 为 0。
- 本机本次构建耗时为 1.21 分钟。
- 没有 `Warning`。
- 生成了 `ProjectAegisEditor-Win64-DebugGame.target`。
- `UnrealEditor-ProjectAegis-Win64-DebugGame.dll` 和对应的 `.pdb` 均存在。
- `DebugGame` 让项目游戏模块以更适合源码调试的方式构建，而引擎主体通常保持 `Development` 构建策略，避免将庞大的引擎整体按 `Debug` 方式运行。

#### Visual Studio 源码断点验证

| 验证项 | 结果 |
|---|---|
| `Visual Studio` 解决方案配置 | `DebugGame Editor` |
| 解决方案平台 | `Win64` |
| 启动项目 | `ProjectAegis` |
| `F5` 启动调试 | 成功 |
| 断点文件 | `ProjectAegis.cpp` |
| 断点位置 | 原本在第 12 行附近设置，调试器实际绑定并停在 `StartupModule()` 内的 `UE_LOG` 语句 |
| 调试进程 | `UnrealEditor-Win64-DebugGame.exe` |
| 调用栈 | 栈顶进入 `FProjectAegisModule::StartupModule()` |
| 加载模块 | `UnrealEditor-ProjectAegis-Win64-DebugGame.dll` |
| 调试符号 | 已加载 |
| 继续执行 | `Editor` 正常进入 `Project Aegis` |
| 结束调试 | `Editor` 正常关闭，没有 `Error` 或 `Warning` |

- 通过观察证明 `UnrealEditor-ProjectAegis-Win64-DebugGame.dll` 被实际进程加载。
- `PDB` 与当前源码正确匹配，因此 `Visual Studio` 能绑定并命中 `StartupModule()` 中的 `C++` 语句。
- 单纯生成 `DLL` 和 `PDB` 只能证明调试产物存在；本次实际加载 `DebugGame DLL`、加载符号并命中 `C++` 源码断点，才完成了工程“可调试”的验收。

#### DebugGame 源码断点演示

这段录像展示了 DebugGame Editor 配置、源码断点命中、调用栈、DebugGame DLL 与符号加载，以及继续执行后 Editor 正常启动。

<video controls playsinline preload="metadata" aria-label="Day 01 DebugGame 源码断点演示" style="display: block; width: 100%; border-radius: 12px;">
  <source src="/media/ue/day01/Day01_DebugGame_Breakpoint_20260714.mp4" type="video/mp4" />
  当前浏览器不支持视频播放，
  <a href="/media/ue/day01/Day01_DebugGame_Breakpoint_20260714.mp4">请打开视频文件</a>。
</video>

## 验证或作品证据

| 证据 | 结果 | 说明 |
|---|---|---|
| `Git` 与 `Git LFS` 基线 | 通过 | 初始化提交包含 850 个文件和 753 个 LFS 文件，首次推送成功，`main` 与 `origin/main` 同步 |
| 干净 `Clone` 恢复 | 通过 | `Clone HEAD` 与基线提交一致，`LFS` 实际资产、源码、配置和内容文件均成功恢复 |
| 项目文件重新生成 | 通过 | 使用 `UE` 自带的 `dotnet.exe` 与 `UnrealBuildTool.dll` 成功生成 `ProjectAegis.sln`，`ExitCode` 为 0 |
| `Development` 构建 | 通过 | `Clone` 构建耗时 0.92 分钟；主工程生命周期修改后的增量构建耗时 0.89 分钟，`DLL` 与 `PDB` 均存在 |
| `Unreal Editor` 与 `PIE` | 通过 | `Clone Editor` 成功启动，两轮 `PIE`、移动、相机和跳跃正常，没有模块、蓝图或资产加载错误 |
| 模块生命周期 | 通过 | `Unreal Editor` 进程中 `StartupModule()` 执行 1 次，两轮 `PIE` 后模块保持加载，`Unreal Editor` 关闭时 `ShutdownModule()` 执行 1 次 |
| `DebugGame` 构建 | 通过 | 构建耗时 1.21 分钟，`ExitCode` 为 0，没有 `Warning`，`DebugGame target`、`DLL` 与 `PDB` 均存在 |
| `Visual Studio` 源码调试 | 通过 | `DebugGame DLL` 与符号被实际进程加载，调用栈进入 `FProjectAegisModule::StartupModule()`，`C++` 源码断点成功命中 |
| 关联代码提交 | 已推送 | `57ad11ad14e0eeaf1bf6971ff25450bbf4001884`：`feat(core): add game module lifecycle logging` |
| 页面演示视频 | 已嵌入 | 页面使用原生 `<video>` 播放 `Day01_DebugGame_Breakpoint_20260714.mp4`；本地生产构建与页面播放器验证通过 |

## 问题与复盘

### UE 5.8 Launcher 版项目文件生成入口差异

- 现象：最初尝试运行预期的 `Engine/Build/BatchFiles/GenerateProjectFiles.bat`，`PowerShell` 返回 `CommandNotFoundException`。
- 根因：本机 `UE 5.8 Launcher` 安装中没有这个入口；此前直接套用了其他 `UE` 版本或其他引擎分发方式的目录假设。
- 修正：使用 `UE` 自带的 `dotnet.exe` 调用 `UnrealBuildTool.dll`，并使用 `Mode=GenerateProjectFiles`。
- 验证：项目文件生成 `ExitCode` 为 0，`ProjectAegis.sln` 存在，随后 `Development` 构建成功。
- 经验：涉及 `UE` 版本和工具入口时，先检查当前引擎安装中的真实文件与工具实现，不应只根据旧教程或命令名称推断路径。

### 模块生命周期实现中的自递归与注册错误

- 现象：初版 `StartupModule()` 内调用了未限定作用域的 `StartupModule()`，`ShutdownModule()` 也存在同样问题；同时 `IMPLEMENT_PRIMARY_GAME_MODULE` 仍注册 `FDefaultGameModuleImpl`，关闭日志还误写成了启动日志。
- 根因一：在覆盖函数内部直接调用同名函数，会再次进入当前覆盖函数，而不是调用父类实现，形成无限递归。
- 根因二：`IMPLEMENT_PRIMARY_GAME_MODULE` 的第一个参数决定模块管理器创建哪个实现类。仍使用 `FDefaultGameModuleImpl` 时，自定义的 `FProjectAegisModule` 不会被模块管理器创建。
- 为什么最初没有立刻触发递归崩溃：递归代码在语法上可以通过编译，但自定义模块当时没有被注册和执行，因此错误路径尚未运行。
- 修正：使用 `FDefaultGameModuleImpl::StartupModule()` 和 `FDefaultGameModuleImpl::ShutdownModule()` 明确调用父类，并把宏的第一个参数改为 `FProjectAegisModule`，同时修正关闭日志。
- 验证：完成空白检查、`Development` 构建、`Editor` 启动、两轮 `PIE` 和 `Editor` 正常关闭；最终启动和关闭日志各出现 1 次。
- 经验：编译成功只能证明语法、编译和链接通过；模块注册关系与生命周期行为必须通过运行日志和实际关闭流程验证。

## 我的理解

- 工程基线：不只是“我的电脑能打开”，而是仓库中的源码、配置和资产能够恢复，生成文件能够重建，工程能够构建、运行并进入调试。
- `Target`、`Platform`、`Build Configuration` 的关系：`Target`、`Platform`、`Build Configuration` 是三个不同的维度；`Target` 描述的是产品角色，比如 `Editor`、`Game`、`Server` 等；`Platform` 描述的是产品的运行操作系统、硬件架构和对应的工具链，比如 `Win64`；`Build Configuration` 是构建策略、发布策略、优化策略，规定了在编译代码时做什么优化；会影响代码优化程度、调试信息和调试体验。这三个维度可以组合但不是一一对应；在 `Project Aegis` 中，`ProjectAegisEditor × Win64 × Development` 和 `ProjectAegisEditor × Win64 × DebugGame` 具有相同的 `Target` 与 `Platform`，但 `Build Configuration` 不同。
- `Git`、`Git LFS` 与生成目录的边界：源码和配置使用 `Git` 的原因是方便使用文本差异比较；而 `UE` 二进制资产使用 `Git LFS` 是因为二进制不方便使用文本差异比较，且文件内容较大，而 `.sln`、`Binaries/`、`Intermediate/`、`Saved/` 等内容应该忽略并重新生成，是因为可以重新生成，这些如果通过 `Git` 管理，容易造成不同机器的冲突。
- 模块、`PIE World` 与 `Actor` 的生命周期：`Editor` 启动时 `ProjectAegis` 游戏模块只加载一次，两轮 `PIE` 不会重复执行 `StartupModule()`，`Editor` 关闭时才执行 `ShutdownModule()`，`PIE World` 与 `Actor` 的生命周期小于模块的生命周期。
- “可调试”：生成 `DLL`/`PDB` 只是前提；必须确认实际进程加载了正确的 `DebugGame DLL` 与符号，并真实命中当前 `C++` 源码断点。

<!-- 列表结束 -->

Day 01 完成的是后续 `Gameplay`、`GAS`、`AI`、网络和性能学习所依赖的工程基础，不代表已经掌握这些上层系统。

## 对外表达

我基于 `UE 5.8 Third Person C++` 模板建立 `Project Aegis` 工程基线。使用 `Git`、`Git LFS` 和忽略规则管理不同文件，并通过独立 `Clone`、`LFS` 资产恢复和项目文件重新生成验证仓库完整性。完成了 `ProjectAegisEditor × Win64 × Development` 构建，重新生成 `DLL`/`PDB`，并验证 `Editor`、`PIE`、`W/A/S/D` 键移动、鼠标操作相机和空格键跳跃。自定义了 `FProjectAegisModule`，通过 `Editor` 启动、两轮 `PIE` 以及 `Editor` 关闭时的日志，验证模块生命周期长于 `PIE World` 与 `Actor` 的生命周期。使用 `DebugGame` 构建，通过 `Visual Studio` 的 `F5` 启动，确认实际进程加载正确 `DLL` 与符号，并命中 `StartupModule()` 的 `C++` 源码断点。通过我的实践明白工程基线不能只靠“本机能打开”判断，而要使用恢复、构建、运行、日志、调试和版本状态形成可复核证据。

## 下一步

- 完成 Day 01 博客发布，并验证线上文章、代码块、表格和页面内 `MP4` 播放正常。
- 发布完成后正式进入 Day 02，从原始计划起点继续执行模块边界与依赖实验，包括按计划建立 `AegisCore`、验证模块声明和缺依赖行为。
