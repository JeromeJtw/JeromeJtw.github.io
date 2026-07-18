---
title: "UE Day 03：从 UObject 反射到 CDO 与默认值来源、GC"
description: "通过 UAegisDeveloperSettings 实验，区分 C++ 默认值、配置、蓝图 Class Defaults、CDO 与普通实例的关系。还了解 UE GC 模型。"
date: 2026-07-18
domain: ue
type: journal
series: ue-client-roadmap
tags:
  - Unreal Engine 5
  - C++
  - Project Aegis
  - UObject
  - Reflection
  - CDO
status: published
outline: deep
---

# UE Day 03：从 UObject 反射到 CDO 与默认值来源、GC

## 背景与目标

### 背景

- `UObject`、反射、`CDO` 是 `UE` 体系中非常基础的概念，需要理解透彻，为后续复杂的开发任务打好基础。
- `C++` 默认值、`Config`、蓝图 `Class Defaults`、实例这些概念相互依赖，容易混淆，为了厘清这些概念，所以进行该章学习。
- `UE` 的 `GC` 通过可追踪的引用关系判断 `UObject` 是否可达，并在后续 `GC` 阶段回收不可达对象。内存管理是游戏开发非常重要的内容，需要掌握。

### 目标

- 实现 `UAegisDeveloperSettings` 和反射属性。
- 观察 `UHT` 生成物。
- 掌握原生 `CDO`、原生实例、蓝图 `CDO`、蓝图实例之间关系，以及如何相互影响。
- 了解 `GC` 模型；理解构造函数、`World` 与对象引用边界。

## 关键概念

### UObject 与反射

- `UObject` 是 `UE` 反射对象体系的基础，为对象接入 `UClass` 类型信息、反射、`GC` 引用追踪、序列化与配置、名称与 `Outer` 层级、对象路径以及编辑器和蓝图继承等能力；但普通 `UObject` 不会因此自动拥有 `Actor` 的场景、`World`、变换或 `Tick` 行为。
- `UCLASS` 类进入`UObject` 反射系统。
- `UFUNCTION` 指定函数进入反射系统。
- `UPROPERTY` 指定成员进入反射、序列化、编辑器或 `GC` 跟踪体系。
- `GENERATED_BODY()` 会展开为 `UHT` 写入 `*.generated.h` 的声明宏，使当前类接入反射生成代码；它本身不负责生成 `*.generated.h` 或 `*.gen.cpp`。
- `UHT` 读取头文件中的 UE 反射声明，生成 `*.generated.h` 和 `*.gen.cpp` ，其中包含反射注册代码、序列化和元数据等相关辅助代码；项目源码和生成代码随后由 `C++` 编译器编译，并由链接器链接到模块二进制中，`UHT` 本身不负责把 `C++` 编译成 `DLL`。

### 原生 CDO

- 由原生 `UClass` 管理。
- `UE` 先有原生 `UClass` 的注册信息。当该 `Class` 需要默认对象，而且 `CDO` 不存在时，`UClass::GetDefaultObject()` 会触发 `CreateDefaultObject()`。

### 蓝图 CDO

- 由对应的 `BlueprintGeneratedClass` 管理。

### CDO 的作用

- `CDO` 是对应 `Class` 的默认属性基线和实例初始化模板，并参与配置加载、反射、序列化和蓝图 `Class Defaults` 等机制。
- 每个 `UClass` 可以拥有不同的构造默认值、配置值和蓝图 `Class Defaults`，因此通常需要自己的 `CDO` 保存该类最终生效的默认属性，并作为该类新实例的初始化模板；不同 `UClass` 使用独立的 `CDO`，可以避免父类与派生类的默认值相互污染。

### 原生 CDO 和蓝图 CDO 的关系以及默认值来源

- 原生 `CDO` 和蓝图 `CDO` 都有各自独立的地址，且和各自 `Class` 实例的地址不一样。
- 原生 `CDO` 和蓝图 `CDO` 都有各自的 `RF_ClassDefaultObject`；但是对应 `Class` 的实例是没有 `RF_ClassDefaultObject`的。
- 原生 `CDO` 的基线默认值来自构造默认，通过构造默认初始化之后，还会通过对应配置覆盖。
- 蓝图 `CDO` 的基线默认值继承自原生 `CDO`，之后会被蓝图资产 `*.uasset` 的值覆盖。
- `CDO` 修改之后会影响所有以该 `CDO` 为模板创建的新实例，不会影响修改之前创建的实例；但是实例修改之后不会反过来影响对应的 `CDO`。

### CDO 的获取以及实例的创建
- `GetDefault<T>()` 返回 `const T*`，表示通常只应读取 `CDO`。
- `GetMutableDefault<T>()` 返回 `T*`，和 `GetDefault<T>()` 获取的同一个 `CDO`，其区别是可以修改当前进程内存中的默认对象；且修改不会自动持久化到 `Config` 或蓝图资产中，持久化需要执行对应的配置或资产保存流程。
- `UClass::GetDefaultObject()` 根据调用它的具体 `Class` 返回对应 `CDO`。蓝图类调用返回的就是蓝图 `CDO`。
- `NewObject()` 创建新的普通实例，不返回 `CDO`。每个不同的实例都有各自独立的地址，且不一样。

### GC 与对象引用

- `GC` 是 `Garbage Collection`，即垃圾回收。它主要负责自动管理继承自 `UObject` 的对象内存。`UE` 会判断 `UObject` 是否仍然"可达"，如果已经没有 `GC` 能识别的强引用路径，它就可能在后续某次 `GC` 中被回收。`GC` 只管理 `UObject` 体系，不负责所有 `C++` 内存。
- 裸指针不构成 `GC` 强引用。
- `UPROPERTY() TObjectPtr<T>` 用于可达 `UObject` 中可追踪的强引用。
- `TStrongObjectPtr<T>` 用于非 `UObject` 或局部/异步逻辑明确保活对象。
- `TWeakObjectPtr<T>` 只用于观察、不保活，使用前检查有效性。
- 需要注意的是 `Outer` 表达命名、上下文、序列化等关系，不能单独作为保活保证。

### 构造函数与 World

- `UObject` 构造函数可能在 `CDO` 创建、类加载、`Editor` 操作、蓝图编译或重实例化等非 `Gameplay` 上下文执行，`GetWorld()` 可能为空或不是预期的运行时 `World`。
- `Actor`/`ActorComponent` 可以在 `BeginPlay()` 或者之后使用运行时 `World`；普通 `UObject` 没用通用 `BeginPlay()`，需要由拥有者在 `World` 有效阶段显示初始化并传入上下文。
- 在今天的实践中添加的 `UAegisDeveloperSettings` 只保存配置，不直接执行 `Gameplay World` 逻辑；需要配置的运行时系统应在自己的有效生命周期通过 `GetDefault<UAegisDeveloperSettings>()` 读取。

## 实践过程

### 建立设置类与模块依赖

- 在今天的实践中新加了 `UAegisDeveloperSettings`，且将其放在 `AegisCore` 模块中，因为属于基础设施，没有具体的业务逻辑。

```cs
using UnrealBuildTool;

public class AegisCore : ModuleRules
{
	public AegisCore(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[] {
			"Core",
			"CoreUObject",
			"DeveloperSettings"
		});
	}
}
```

```cpp
#pragma once

#include "Engine/DeveloperSettings.h"

#include "AegisDeveloperSettings.generated.h"

/**
 * Project Aegis 项目级开发配置，并提供 CDO 与普通实例的诊断入口。
 */
UCLASS(
	Config = Game,
	DefaultConfig,
	BlueprintType,
	Blueprintable,
	meta = (DisplayName = "Aegis Developer Settings"))
class AEGISCORE_API UAegisDeveloperSettings : public UDeveloperSettings
{
	GENERATED_BODY()

public:
	UAegisDeveloperSettings();

	/** 输出当前对象、所属类、对应 CDO、对象标记和两个实验值。 */
	UFUNCTION(BlueprintCallable, Category = "Aegis|Developer Settings")
	void LogObjectState() const;

	/** 验证 C++ 默认值、配置文件、Project Settings 与原生 CDO 的覆盖关系。 */
	UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "CDO Experiment")
	int32 ProjectSettingValue = 100;

	/** 验证 C++ 默认值、蓝图 Class Defaults、蓝图 CDO 与蓝图实例的关系。 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "CDO Experiment")
	int32 ClassDefaultValue = 10;
};
```

- 根据之前学习的知识，`#include "AegisDeveloperSettings.generated.h"` 放在了最后。
- `ProjectSettingValue` 这个可以通过配置覆盖，值在 `C++` 源码中初始化为100，`ClassDefaultValue` 不能通过配置覆盖，值在 `C++` 源码中初始化为10。是否能通过配置覆盖，关键差异在 `Config`。

### 验证 UHT 生成与构建

- 完成编码之后，构建成功。生成了文件如下。

```text
Intermediate/Build/Win64/UnrealEditor/Inc/AegisCore/UHT/
├── AegisCore.init.gen.cpp
├── AegisCoreClasses.h
├── AegisDeveloperSettings.gen.cpp
└── AegisDeveloperSettings.generated.h
```

- `Module.AegisCore.gen.cpp` 文件内容如下。

```text
#include "/Intermediate/Build/Win64/UnrealEditor/Inc/AegisCore/UHT/AegisCore.init.gen.cpp"
#include "/Intermediate/Build/Win64/UnrealEditor/Inc/AegisCore/UHT/AegisDeveloperSettings.gen.cpp"
```
- 证明了这是一个聚合反射 `.gen.cpp`的编译单元。
- `AegisCore` 模块信息加 `AegisDeveloperSettings.h` 反射头文件输入，加 `AegisCore/UHT` 输出目录，加 `AegisCore.gen` 生成 `C++` 基名，证明了`UBT` 为本次 `Target` 组织了 `AegisCore` 的 `UHT` 输入、依赖和输出计划，然后结合实际生成文件和 `Module.AegisCore.gen.cpp` 编译动作，才能形成完整的“计划->生成->编译”证据链。

### 验证 Config 与原生 CDO

![Aegis Developer Settings 显示 200/10](/img/Day0302.png)

- `Project Settings` 能自动显示该设置，是因为 `AegisCore` 模块与反射类已经成功加载，`UAegisDeveloperSettings` 是可自动注册的具体 `UDeveloperSettings` 子类，并且其 `CDO` 可用、类没有被 `Abstract` 或 `Deprecated` 等条件排除；`Settings Editor` 再根据 `Container`、`Category` 和 `Section` 名称将它放到对应设置页面。反射是必要前提，但不是自动注册的唯一条件。
- `ProjectSettingValue` 从 100 改成 200 后保存在 `Config/DefaultGame.ini` 中的 `[/Script/AegisCore.AegisDeveloperSettings]` 小节。如下所示。

```text
[/Script/EngineSettings.GeneralProjectSettings]
ProjectID=1C087C2343D38422BCDC89BDCDB3E8BE
ProjectName=Third Person Game Template

[ConsoleVariables]
CommonUI.CheckKeyboardFocusAndParentage=1
CommonUI.DisallowUserFocusedWidgetForPendingFocusRecipient=1
CommonUI.FallbackToDesiredOnAutoRestoreFailure=1

[/Script/AegisCore.AegisDeveloperSettings]
ProjectSettingValue=200
```

- 重启 `Editor` 后，原生 `CDO` 先根据构造默认初始化，然后根据 `Config/DefaultGame.ini` 中的配置覆盖，所以 `ProjectSettingValue` 是 200。

### 验证蓝图 Class Defaults 与蓝图 CDO

- 创建 `BP_AegisDeveloperSettings` 通过 `Editor` 的操作即可完成。在 `Content` 中鼠标右键选择 添加->蓝图类，然后搜索新加的 `AegisDeveloperSettings`，并将新加的蓝图类命名为`BP_AegisDeveloperSettings`，然后保存，就完成了。
- 为了区分 `Config` 与蓝图 `Class Defaults` 两条默认值来源，实验保持 `ProjectSettingValue=200` 不变，只在蓝图中把非 `Config` 属性 `ClassDefaultValue` 从 10 修改为 20；这样原生 `CDO` 保持 200/10，蓝图 `CDO` 变为 200/20。
- 蓝图资产保存在 `Content/Aegis/Settings` 路径下的 `*.uasset`。
- 因为蓝图 `CDO` 继承原生 `CDO` 后，通过蓝图资产的设置重新覆盖，所以是修改后的 `200/20`。

### 比较四种对象

```python
import unreal;
native_class=unreal.load_class(None, "/Script/AegisCore.AegisDeveloperSettings");
native_cdo=unreal.get_default_object(native_class);
native_instance=unreal.new_object(native_class, name="Day03NativeInstance");
bp_class=unreal.load_class(None, "/Game/Aegis/Settings/BP_AegisDeveloperSettings.BP_AegisDeveloperSettings_C");
bp_cdo=unreal.get_default_object(bp_class);
bp_instance=unreal.new_object(bp_class, name="Day03BlueprintInstance");
native_cdo.log_object_state();
native_instance.log_object_state();
bp_cdo.log_object_state();
bp_instance.log_object_state();
unreal.log_flush();
del native_instance, bp_instance, native_cdo, bp_cdo, native_class, bp_class
```

- 上面的 `python` 代码可以通过编辑器的命令窗口进行执行。

```text
Saved\Logs\ProjectAegis.log:2177:[2026.07.18-08.55.50:836][193]LogAegisCore: Display: AegisDeveloperSettings Object=000001C60AE740C0 Class=AegisDeveloperSettings ClassDefaultObject=000001C60AE740C0 IsClassDefaultObject=true ProjectSettingValue=200 ClassDefaultValue=10
Saved\Logs\ProjectAegis.log:2178:[2026.07.18-08.55.50:836][193]LogAegisCore: Display: AegisDeveloperSettings Object=000001C74E7517A0 Class=AegisDeveloperSettings ClassDefaultObject=000001C60AE740C0 IsClassDefaultObject=false ProjectSettingValue=200 ClassDefaultValue=10
Saved\Logs\ProjectAegis.log:2179:[2026.07.18-08.55.50:836][193]LogAegisCore: Display: AegisDeveloperSettings Object=000001C751C04C90 Class=BP_AegisDeveloperSettings_C ClassDefaultObject=000001C751C04C90 IsClassDefaultObject=true ProjectSettingValue=200 ClassDefaultValue=20
Saved\Logs\ProjectAegis.log:2180:[2026.07.18-08.55.50:836][193]LogAegisCore: Display: AegisDeveloperSettings Object=000001C74E754DE0 Class=BP_AegisDeveloperSettings_C ClassDefaultObject=000001C751C04C90 IsClassDefaultObject=false ProjectSettingValue=200 ClassDefaultValue=20
```

- 通过日志可以看到原生 `CDO` 和蓝图 `CDO` 有各自的地址，原生实例和蓝图实例也有各自的地址，且和各自的 `CDO` 地址不一样。
- 只有 `CDO` 才有 `RF_ClassDefaultObject`，而实例是没有的。
- 200/10 中的 200 来自配置，10 来自 `C++` 源码；200/20 中的 200 来自原生 `CDO`，也就是配置，20来自蓝图资产。

### 验证 GC、生命周期与运行回归

- `Python` `del` 只删除 `Python` 变量绑定及其临时引用，不会调用 `C++` `delete`，也不会同步触发一次 `UE` `GC`。因此普通实例不会在执行 `del` 的那一刻立即销毁。
- 普通实例的销毁，不会让原生 `CDO` 不可达，只要对应的 `Class` 可以正常加载并可达，那么 `Class` 对其 `CDO` 的管理关系仍然存在，`CDO` 还有效。
- PIE、移动、跳跃、相机、Editor 启动与关闭验证结果都正常。

## 验证或作品证据

<video controls playsinline preload="metadata" aria-label="从 UObject 反射到 CDO 与默认值来源" style="display: block; width: 100%; border-radius: 12px;">
  <source src="/media/ue/day03/Day03_UObject_CDO_20260718.mp4" type="video/mp4" />
  当前浏览器不支持视频播放，
  <a href="/media/ue/day03/Day03_UObject_CDO_20260718.mp4">请打开视频文件</a>。
</video>

- 本次录屏展示了 `Aegis Developer Settings` 的 Config 值、蓝图 `Class Defaults`，以及原生/蓝图 CDO 与普通实例的地址、标记和默认值关系。对应的 Project Aegis Commit 为 `46f07d6ede685291ecd8a4bcb3ac1e8f9ec70adb`。

## 问题与复盘

- 最初把 C++ 默认值、Config、蓝图 Class Defaults 和实例值混在一起，仅看最终数值很难判断来源。
- 后来使用两个用途不同的属性作为探针，再比较原生 CDO、原生实例、蓝图 CDO 和蓝图实例的地址、标记与数值，才把两条默认值来源分开。
- 今后遇到默认值问题，应该沿着“构造默认值 → 配置或蓝图资产覆盖 → CDO → 新实例”的链路验证，而不是只根据编辑器里看到的结果猜测。

## 我的理解

问：如果以后发现一个 UObject 属性的实际值与预期不同，我会如何判断当前对象是原生/蓝图 CDO 还是普通实例，并沿着 C++ 构造默认值、Config、蓝图 Class Defaults 和运行时修改逐层定位值的来源？
答：我会通过 `HasAnyFlags(RF_ClassDefaultObject)` 来判断是否是 `CDO` 如果返回true，则是 `CDO`，否则是普通实例，获取当前对象的运行时 `UClass`，用 `CLASS_Native` 等类标记判断是否为原生类；若要进一步确认蓝图生成类，则检查实际类类型，而不是只依赖名称中的 `_C`。通过比较当前对象、运行时 `Class` 的 `CDO` 和原生 `CDO`，再分别核对 `C++` 构造默认值、合并后的 `Config`、蓝图 `Class Defaults`、实例序列化值和运行时修改来定位值的来源。

## 对外表达

今天添加了继承自 `UDeveloperSettings` 的 `UAegisDeveloperSettings`，声明了两个用于实验的反射属性，并添加对象状态日志。通过 `Config` 将 100 覆盖为 200、通过蓝图 `Class Defaults` 将 10 覆盖为 20，再比较四种对象的地址、`RF_ClassDefaultObject` 标记和属性值，成功分析了原生 `CDO` 和蓝图 `CDO` 及其与各自实例的关系，及其 `CDO` 和实例值的传递链。我明白了 `CDO` 和实例有各自的地址，且修改实例，不会影响 `CDO`。蓝图 `CDO` 的值继承自原生 `CDO`，且会被蓝图资产覆盖。

## 下一步

按照计划进行Day04的课程内容学习。
