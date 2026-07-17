---
title: "UE Day 02：从 AegisCore 模块到 UBT/UHT 与 Unity Build 边界"
description: "通过建立 AegisCore 模块，学习 UBT/UHT 的职责以及 Unity Build 的作用。"
date: 2026-07-17
domain: ue
type: journal
series: ue-client-roadmap
tags:
  - Unreal Engine 5
  - C++
  - Project Aegis
  - UBT/UHT
  - Unity Build
status: published
outline: deep
---

# UE Day 02：从 AegisCore 模块到 UBT/UHT 与 Unity Build 边界

## 背景与目标

### 背景

`UBT`/`UHT` 是 `UE` 工程中涉及的常见编译内容，需要掌握。

### 目标

掌握 `UBT`/`UHT`、`Unity Build` 的概念及其作用，并通过 `AegisCore` 来掌握其工作流程以及如何影响 `UE` 工程的编译。

## 关键概念

### .uproject

`.uproject` 是 `UE` 工程的入口文件，用于描述项目模块元数据，描述了 `UE` 工程包含哪些模块以及启用了哪些插件。

```json
{
	"FileVersion": 3,
	"EngineAssociation": "5.8",
	"Category": "",
	"Description": "",
	"Modules": [
		{
			"Name": "ProjectAegis",
			"Type": "Runtime",
			"LoadingPhase": "Default",
			"AdditionalDependencies": [
				"Engine",
				"AIModule",
				"UMG"
			]
		},
		{
			"Name": "AegisCore",
			"Type": "Runtime",
			"LoadingPhase": "Default"
		}
	],
	"Plugins": [
		{
			"Name": "ModelingToolsEditorMode",
			"Enabled": true,
			"TargetAllowList": [
				"Editor"
			]
		},
		{
			"Name": "StateTree",
			"Enabled": true
		},
		{
			"Name": "GameplayStateTree",
			"Enabled": true
		}
	]
}
```

### Target.cs

这个文件用于描述 `UE` 工程的目标构建产品角色，以及应该以哪个模块作为顶层模块加入该 `Target` 的构建图中。

```cs
using UnrealBuildTool;
using System.Collections.Generic;

public class ProjectAegisTarget : TargetRules
{
	public ProjectAegisTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.V7;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_8;
		ExtraModuleNames.Add("ProjectAegis");
	}
}
```

比如在这个 `Target` 中，这个描述的角色是 `Game`，顶层模块是 `ProjectAegis` 来进行构建图。

### Build.cs

这个文件用于描述 `UE` 工程在编译时的依赖模块和编译规则。`PublicDependencyModuleNames` 用于声明依赖模块的类型或头文件出现在当前模块的公共头文件、公共接口中，需要向使用当前模块的下游模块传递这层依赖，`PrivateDependencyModuleNames` 用于声明依赖只在当前模块的私有头文件或 `.cpp` 实现中使用，不应作为公共接口的一部分传播。

```cs
// 为并列展示 PublicDependencyModuleNames 与 PrivateDependencyModuleNames 的声明方式，下面保留了一个空的 Private 依赖示例；
// 当前 AegisCore 没有 Private 依赖，该声明不产生构建效果，最终提交中已省略。
using UnrealBuildTool;

public class AegisCore : ModuleRules
{
	public AegisCore(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[] {
			"Core"
		});

		PrivateDependencyModuleNames.AddRange(new string[] { });
	}
}
```

### UBT

`UBT` 的全称是 `Unreal Build Tool`，负责组织整个构建过程。主要读取 `.uproject`、`Target.cs`、`Build.cs`、源文件和头文件、目标 `Platform`、`Build Configuration`，根据这个创建 `Target` 和模块依赖图，决定需要构建哪些模块，应用 `Build.cs` 中的依赖和编译规则，选择平台工具链，判断是否需要 `UHT`，组织 `C++` 编译和链接动作，生成响应文件、`Manifest`、对象文件路径等中间构建数据。

### UHT

`UHT` 的全称是 `Unreal Header Tool`，解析 `UE` 反射标记并生成相应的 `UE` 反射辅助代码，它关注的主要内容包括：`UCLASS()`、`USTRUCT()`、`UENUM()`、`UPROPERTY()`、`UFUNCTION()`、`UINTERFACE()`、`GENERATED_BODY()`，它会生成 `*.generated.h` 和 `*.gen.cpp`，反射代码不是手写代码，这些代码不能手动修改，也不能提交。

`UBT`、`UHT` 本身不是编译器或链接器，不负责编译和链接，`UBT` 负责组织构建，并在需要时调用 `UHT`，最终调用 `MSVC` 等实际工具完成编译和链接。

### Unity Build、间接包含与 IWYU

`IWYU` 是 `Include What You Use`，基本要求是：每个源文件和头文件都显式包含自己直接使用的声明，不依赖 `PCH`、其他头文件的间接包含或 `Unity Build` 的偶然合并结果。
如果不直接 `include` 自己直接需要的头文件，`Unity Build` 合并多个编译单元可能掩盖依赖文件的问题，假如 `A.cpp` 包含 `A.h`，`B.cpp` 使用了在 `C.h` 中定义的类型或宏，`A.h` 中包含了 `C.h`，`B.cpp` 没有直接包含 `C.h`，且 `B.h` 也没有包含 `C.h`，也没有包含任何能够稳定提供 `C.h` 声明的头文件，如果 `Unity Build` 恰好先合并 `A.cpp`，再合并 `B.cpp`，`B.cpp` 因为看到了前面遗留的声明而偶然编译成功，但是关闭 `Unity Build` 后就不能编译通过，因为关闭之后 `A.cpp` 与 `B.cpp` 会分别作为独立编译单元处理，`B.cpp` 无法再看到由 `A.cpp` 的包含过程带入的声明，编译失败。所以在实际开发中我们应该直接依赖需要的头文件，且每个 `.cpp` 优先使用与自己匹配的 `.h`，不依赖 `PCH`、间接包含或 `Unity` 合并顺序，且应该尽量使用指针类型、引用类型，从而可以使用前向声明来减少编译依赖，对于反射代码的头文件 `.generated.h` 应该保持为最后一个 `include`。

## 实践过程

完成 `AegisCore` 模块的编码，且在 `ProjectAegis` 模块中使用 `LogAegisCore`。

```cpp
#pragma once

#include "Logging/LogMacros.h"

/** Project Aegis 通用核心基础设施日志分类。 */
AEGISCORE_API DECLARE_LOG_CATEGORY_EXTERN(LogAegisCore, Log, All);
```

```cpp
#include "AegisCoreLog.h"

DEFINE_LOG_CATEGORY(LogAegisCore);

```

```cpp
#include "AegisCoreLog.h"
#include "Modules/ModuleManager.h"

class FAegisCoreModule final : public IModuleInterface
{
public:
	virtual void StartupModule() override
	{
		UE_LOG(LogAegisCore, Log, TEXT("AegisCore module StartupModule"));
	}

	virtual void ShutdownModule() override
	{
		UE_LOG(LogAegisCore, Log, TEXT("AegisCore module ShutdownModule"));
	}
};

IMPLEMENT_MODULE(FAegisCoreModule, AegisCore);
```

```cpp
#include "ProjectAegis.h"
#include "AegisCoreLog.h"
#include "Modules/ModuleManager.h"

class FProjectAegisModule final : public FDefaultGameModuleImpl
{
public:

	virtual void StartupModule() override
	{
		FDefaultGameModuleImpl::StartupModule();
		UE_LOG(LogProjectAegis, Log, TEXT("ProjectAegis module StartupModule"));
		UE_LOG(LogAegisCore, Log, TEXT("ProjectAegis module uses AegisCore log category"));
	}

	virtual void ShutdownModule() override
	{
		UE_LOG(LogProjectAegis, Log, TEXT("ProjectAegis module ShutdownModule"));
		FDefaultGameModuleImpl::ShutdownModule();
	}
};

IMPLEMENT_PRIMARY_GAME_MODULE(FProjectAegisModule, ProjectAegis, "ProjectAegis");

DEFINE_LOG_CATEGORY(LogProjectAegis)
```

启动 `UnrealEditor` 打开 `ProjectAegis.uproject`，进行一轮 `PIE`，移动正常、跳跃正常、鼠标移动相机正常。且没有出现加载错误和警告。

```text
Saved\Logs\ProjectAegis.log:1348:[2026.07.17-06.36.18:797][  0]LogProjectAegis: ProjectAegis module StartupModule
Saved\Logs\ProjectAegis.log:1349:[2026.07.17-06.36.18:797][  0]LogAegisCore: ProjectAegis module uses AegisCore log category
Saved\Logs\ProjectAegis.log:1351:[2026.07.17-06.36.18:797][  0]LogAegisCore: AegisCore module StartupModule
```

关闭 `UnrealEditor`，没有出现错误和警告。

```text
Saved\Logs\ProjectAegis.log:2211:[2026.07.17-07.10.27:439][120]LogAegisCore: AegisCore module ShutdownModule
Saved\Logs\ProjectAegis.log:2212:[2026.07.17-07.10.27:439][120]LogProjectAegis: ProjectAegis module ShutdownModule
```

通过日志分析可以得到结论 `PIE` 的生命周期时长少于模块的生命周期，`Build.cs` 中依赖保证构建、链接和跨模块符号使用关系，但不能单独作为 `StartupModule()` 和 `ShutdownModule()` 回调顺序的保证，本次日志记录的是实际观察到的回调顺序。

## 验证或作品证据

这段录像展示了 `AegisCore` 结构以及对应的 `Build.cs`，还有和 `ProjectAegis` 模块和 `AegisCore` 模块的依赖关系。

<video controls playsinline preload="metadata" aria-label="Day 02 AegisCore结构及Build.cs" style="display: block; width: 100%; border-radius: 12px;">
  <source src="/media/ue/day02/Day02_AegisCore_Module_20260717.mp4" type="video/mp4" />
  当前浏览器不支持视频播放，
  <a href="/media/ue/day02/Day02_AegisCore_Module_20260717.mp4">请打开视频文件</a>。
</video>

| 证据 | 结果 | 说明 |
|---|---|---|
| 缺少模块依赖实验 | 预期失败 | 暂时移除 `ProjectAegis → AegisCore` 直接依赖后，`ProjectAegis.cpp` 无法找到 `AegisCoreLog.h`；`ExitCode` 为 6 |
| 恢复模块依赖 | 通过 | 在 `ProjectAegis.Build.cs` 恢复 `PrivateDependencyModuleNames` 后，构建 `Succeeded`；`ExitCode` 为 0，耗时 18.43 秒，0 Warning、0 Error |
| 模块构建产物 | 通过 | `ProjectAegis` 和 `AegisCore` 对应的 `DLL`、`PDB` 均存在 |
| Non-Unity Build | 通过 | 临时在两个模块的 `Build.cs` 中设置 `bUseUnity = false`；构建包含 46 个动作，各业务 `.cpp` 独立编译，耗时 135.22 秒，0 Warning、0 Error |
| Non-Unity 配置恢复 | 通过 | 删除临时 `bUseUnity = false` 后重新构建成功，`ExitCode` 为 0，耗时 7.83 秒 |
| AegisCore 的 UBT 中间产物 | 通过 | 找到 `.rsp`、`.obj`、`.dep.json` 等；这些证明 UBT、编译器和链接器为模块组织并生成了中间产物 |
| UHT 生成物边界 | 通过 | `ProjectAegis` 有 41 个 `*.generated.h` 和 42 个 `*.gen.cpp`；纯日志版本的 `AegisCore` 没有自己的 UHT 输出目录，因为其中没有反射声明 |
| Editor 与 PIE | 通过 | Editor 正常启动；PIE 正常进入和退出；移动、相机和跳跃正常；未出现新的 Error |
| 模块生命周期日志 | 通过 | 两个模块的启动和关闭日志各出现 1 次，并记录实际观察到的回调顺序 |
| 关联提交 | 已推送 | `10cd1b922ae4ec0c1e5f782422bf0882c51e6196`：`feat(core): 新增 AegisCore 模块与日志分类`；`main` 与 `origin/main` 同步 |
| 演示录像 | 已嵌入 | `Day02_AegisCore_Module_20260717.mp4`，86 秒，SHA-256 为 `E5690BAEE5B3BE4C055860607FA11EF2C58ED7A227A451A39504EBD8953D4F5F`；本地生产构建与页面播放器验证通过 |

## 问题与复盘

### ProjectAegis 模块不依赖 AegisCore，但在代码中直接使用 AegisCore

```cs
using UnrealBuildTool;

public class ProjectAegis : ModuleRules
{
	public ProjectAegis(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[] {
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",
			"EnhancedInput",
			"AIModule",
			"StateTreeModule",
			"GameplayStateTreeModule",
			"UMG",
			"Slate"
		});

		// PrivateDependencyModuleNames.AddRange(new string[] {
		// 	"AegisCore"
		// });

		PublicIncludePaths.AddRange(new string[] {
			"ProjectAegis",
			"ProjectAegis/Variant_Platforming",
			"ProjectAegis/Variant_Platforming/Animation",
			"ProjectAegis/Variant_Combat",
			"ProjectAegis/Variant_Combat/AI",
			"ProjectAegis/Variant_Combat/Animation",
			"ProjectAegis/Variant_Combat/Gameplay",
			"ProjectAegis/Variant_Combat/Interfaces",
			"ProjectAegis/Variant_Combat/UI",
			"ProjectAegis/Variant_SideScrolling",
			"ProjectAegis/Variant_SideScrolling/AI",
			"ProjectAegis/Variant_SideScrolling/Gameplay",
			"ProjectAegis/Variant_SideScrolling/Interfaces",
			"ProjectAegis/Variant_SideScrolling/UI"
		});

		// Uncomment if you are using Slate UI
		// PrivateDependencyModuleNames.AddRange(new string[] { "Slate", "SlateCore" });

		// Uncomment if you are using online features
		// PrivateDependencyModuleNames.Add("OnlineSubsystem");

		// To include OnlineSubsystemSteam, add it to the plugins section in your uproject file with the Enabled attribute set to true
	}
}
```

```cpp
#include "ProjectAegis.h"
#include "AegisCoreLog.h"
#include "Modules/ModuleManager.h"

class FProjectAegisModule final : public FDefaultGameModuleImpl
{
public:

	virtual void StartupModule() override
	{
		FDefaultGameModuleImpl::StartupModule();
		UE_LOG(LogProjectAegis, Log, TEXT("ProjectAegis module StartupModule"));
		UE_LOG(LogAegisCore, Log, TEXT("ProjectAegis module uses AegisCore log category"));
	}

	virtual void ShutdownModule() override
	{
		UE_LOG(LogProjectAegis, Log, TEXT("ProjectAegis module ShutdownModule"));
		FDefaultGameModuleImpl::ShutdownModule();
	}
};

IMPLEMENT_PRIMARY_GAME_MODULE(FProjectAegisModule, ProjectAegis, "ProjectAegis");

DEFINE_LOG_CATEGORY(LogProjectAegis)
```

因为 `Build.cs` 去掉了对 `AegisCore` 的依赖，编译出错，错误码是 6。出错信息如下

```text
[6/12] Compile [x64] ProjectAegis.cpp
Source\ProjectAegis\ProjectAegis.cpp(4,1): fatal error C1083: 无法打开包括文件: “AegisCoreLog.h”: No such file or directory
#include "AegisCoreLog.h"
```

将这个依赖加回来之后能成功编译。

## 我的理解

- `AegisCore` 提供与具体 `Gameplay` 无关、可以被多个上层模块复用的基础设施，当前只是包含了模块入口和日志分类。
- `ProjectAegis` 包含角色、输入、GameMode、战斗、AI、UI 和具体玩法规则，因此属于高层业务模块。
- 依赖顺序应该是 `ProjectAegis` 依赖 `AegisCore`，而不是反过来，如果反过来，底层模块就会知道具体玩法类型，降低复用性，还可能导致循环依赖；同时也不能因为名称里有 `Core`，就把所有难以分类的代码都一股脑放进去。

## 对外表达

今天的学习，主要是新增一个 `AegisCore` 模块，为 `ProjectAegis` 模块提供基础设施，通过这一模块化实践，集中学习了 `.uproject`、`Build.cs`、`Target.cs`、`UBT`、`UHT`、编译器和链接器的职责。通过暂时移除 `ProjectAegis.Build.cs` 中的直接模块依赖，复现了头文件不可见的编译错误，并在恢复依赖后完成构建，以及通过 `Non-Unity Build` 验证各源文件独立编译时不依赖 `Unity` 合并产生的偶然包含关系。另外确认了 `AegisCore` 和 `ProjectAegis` 的依赖关系，`AegisCore` 作为底层模块不能依赖高层业务模块`ProjectAegis`，而应该是业务模块 `ProjectAegis` 依赖底层模块 `AegisCore`。

## 下一步

学习 `UObject` 序列，反射和CDO。
