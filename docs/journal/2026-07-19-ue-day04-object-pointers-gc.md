---
title: "UE Day 04：对象指针、Outer 与 GC 可达性"
description: "通过强引用、裸指针、弱引用、软引用与 Root 实验，验证 UObject 的 GC 可达性、Outer 引用方向和软引用的显式加载边界。"
date: 2026-07-19
domain: ue
type: journal
series: ue-client-roadmap
tags:
  - Unreal Engine 5
  - C++
  - Project Aegis
  - UObject
  - GC
  - Object Pointers
status: published
outline: deep
---

# UE Day 04：对象指针、Outer 与 GC 可达性

## 背景与目标

### 背景

- 在 `UE` 工程中常用 `GC` 模型对 `UObject` 体系的对象进行管理，`UObject` 体系是 `UE` 工程非常基础的内容，所以有必要掌握 `GC` 模型的原理。
- `TObjectPtr`、`TWeakObjectPtr`、`TSoftObjectPtr`、裸指针的特性不一样，且这些都非常常用，所以必须掌握。

### 目标

- 通过增加 `UAegisGcProbeObject` 和 `AAegisGcExperimentActor` 来完成实验，通过相应的实验逻辑代码和日志代码来理解 `GC` 和对象指针。
- 验证 `UPROPERTY() TObjectPtr<T>`、`UPROPERTY() TWeakObjectPtr<T>`、`UPROPERTY() TSoftObjectPtr<T>`、裸指针的特性。
- 验证 `AddToRoot()` 和 `RemoveFromRoot()` 对对象可达性和回收结果的影响。

## 关键概念

### GC 可达性

- `GC` 以 `GC Root` 为起点，沿 `GC` 可以追踪的引用关系遍历对象，判断目标对象是否可达，并标记不可达的对象。
- 如果对象不可达，且没有其他强引用，那么会在当前或后续的销毁、清理阶段被回收。
- 强引用只有从可达对象出发时才能继续扩展可达链；仅有一个来自不可达对象的强引用，不能让目标变为可达。

### 四类对象引用

| 引用方式 | 保存或观察什么 | 是否保活 | 目标回收或未加载后的状态 |
|---|---|---|---|
| `UPROPERTY() TObjectPtr<T>` | 是 `GC` 强引用 | 当持有者可达且引用仍然存在时保活 | 当持有者可达且引用仍然存在时，不能被 `GC` 回收 |
| 裸指针 | 指向的目标对象 | 不是 `GC` 强引用，不保活 | 目标回收后不会自动置空，可能成为悬空指针，不能直接访问或解引用 |
| `TWeakObjectPtr<T>` | 观察目标是否有效，不是 `GC` 强引用 | 不保活 | 目标回收后安全无效状态 |
| `TSoftObjectPtr<T>` | 目标资产路径，不是 `GC`强引用 | 不保活 | 目标回收或未加载时仍保留路径，可以通过路径重新加载目标；未加载时保存有效路径，并处于 `Pending` 状态 |

- 注意： `UPROPERTY()` 本身不等于所有权，也不能单独决定是否保活，它的作用是让成员进入 `UE` 的反射属性体系。
- `TSoftObjectPtr::IsNull()` 是否没有有效软对象路径；`TSoftObjectPtr::IsPending()` 路径存在，但当前没有解析到已加载目标，`TSoftObjectPtr::IsValid()` 当前是否已经解析到有效对象，`TSoftObjectPtr::Get()` 只取得当前已经加载的对象，不会主动加载。如果要加载目标，必须由代码显式调用同步加载或异步加载。`TSoftObjectPtr` 之所以设计成这样的特性，是为了避免访问一个配置或引用时，意外触发磁盘加载、网络加载或同步卡顿。

### Outer

- `Outer` 是每个 `UObject` 的“外层对象”关系。它主要表达对象处于哪个对象命名空间、上下文和序列化层级中，但不等同于 `C++` 所有权，也不意味着 `Outer` 会自动保活所有内部对象。
- 内部对象保存指向 `Outer` 的关系，如果内部对象可达，这条关系可以参与让 `Outer` 保持可达。
- 仅仅把一个对象指定为 `Outer`，不会自动建立 `Outer` -> 内部对象的反向 `GC` 强引用。`Outer` 仍然可以通过自己声明的其他强引用属性持有内部对象，但那是另一条独立引用关系。

### Root

- `Root` 集合本身是 `GC` 的可达性起点之一。对象加入 `Root` 后，即使没有 `UPROPERTY` 引用，`GC` 也会把它视为可达对象。
- `AddToRoot()` 后 `Root` 集合提供可达起点。
- `RemoveFromRoot()` 移除 `Root` 后不再有 `Root` 保活，如果没有其他强引用，后续 `GC` 可能回收。
- `AddToRoot()` 和 `RemoveFromRoot()` 要正确配对，否则可能出现内存泄漏的问题。

## 实践过程

### 实验对象与触发入口

- `UAegisGcProbeObject` 和 `AAegisGcExperimentActor` 属于实验类，不是基础设施，应该放在 `ProjectAegis`。
- 使用 `UFUNCTION(CallInEditor)` 修饰实验入口，使其能够在编辑器里触发实验流程。
- `CreateExperimentObjects()` 是创建强引用、裸指针、弱引用目标，`CollectGarbageAndReport()` 触发 `GC` 然后打印强引用、裸指针、弱引用的状态。
- `RunRootExperiment()` 观察 `AddToRoot()` 和 `RemoveFromRoot()` 对可达性的影响。
- `InspectSoftReference()` 测试软引用特性。

```cpp
#include "CoreMinimal.h"
#include "UObject/Object.h"

#include "AegisGcProbeObject.generated.h"

UCLASS()
class PROJECTAEGIS_API UAegisGcProbeObject final : public UObject
{
	GENERATED_BODY()

public:
	void SetLabel(const FName& InLabel);

	virtual void BeginDestroy() override;

private:
	FName Label = NAME_None;
};
```

```cpp
#include "AegisGcProbeObject.h"

#include "AegisCoreLog.h"

void UAegisGcProbeObject::SetLabel(const FName& InLabel)
{
	Label = InLabel;
	UE_LOG(
		LogAegisCore,
		Log,
		TEXT("GC probe created: Object=%p Label=%s"),
		this,
		*Label.ToString());

}

void UAegisGcProbeObject::BeginDestroy()
{
	UE_LOG(
		LogAegisCore,
		Log,
		TEXT("GC probe BeginDestroy: Object=%p Label=%s"),
		this,
		*Label.ToString());
	Super::BeginDestroy();
}
```

```cpp
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "UObject/SoftObjectPtr.h"
#include "UObject/WeakObjectPtr.h"

#include "AegisGcExperimentActor.generated.h"

class UAegisGcProbeObject;

UCLASS()
class PROJECTAEGIS_API AAegisGcExperimentActor final : public AActor
{
	GENERATED_BODY()

public:
	AAegisGcExperimentActor();

	UFUNCTION(CallInEditor, Category = "Aegis|GC")
	void CreateExperimentObjects();

	UFUNCTION(CallInEditor, Category = "Aegis|GC")
	void CollectGarbageAndReport();

	UFUNCTION(CallInEditor, Category = "Aegis|GC")
	void RunRootExperiment();

	UFUNCTION(CallInEditor, Category = "Aegis|GC")
	void InspectSoftReference();

private:
	/** 由可达 Actor 的反射属性持有，形成 GC 可追踪强引用。 */
	UPROPERTY(Transient)
	TObjectPtr<UAegisGcProbeObject> StrongReference;

	/** 故意不使用 UPROPERTY，验证裸指针不会保活 UObject。 */
	UAegisGcProbeObject* RawReference = nullptr;

	/** 安全观察裸指针目标是否已经被回收。 */
	TWeakObjectPtr<UAegisGcProbeObject> RawReferenceObserver;

	/** 即使作为 UPROPERTY，弱引用也不会保活目标。 */
	UPROPERTY(Transient)
	TWeakObjectPtr<UAegisGcProbeObject> WeakReference;

	/** 保存资产路径，不自动加载或保活目标资产。 */
	UPROPERTY(EditAnywhere, Category = "Aegis|GC")
	TSoftObjectPtr<UObject> SoftReference;

};
```

```cpp
#include "AegisGcExperimentActor.h"

#include "AegisCoreLog.h"
#include "AegisGcProbeObject.h"
#include "UObject/GarbageCollection.h"
#include "UObject/UObjectGlobals.h"

AAegisGcExperimentActor::AAegisGcExperimentActor()
{
	PrimaryActorTick.bCanEverTick = false;
}

void AAegisGcExperimentActor::CreateExperimentObjects()
{
	if (IsValid(StrongReference.Get()))
	{
		UE_LOG(
			LogAegisCore,
			Warning,
			TEXT("GC experiment objects already exist: Actor=%p"),
			this);
		return;
	}

	StrongReference = NewObject<UAegisGcProbeObject>(this);
	StrongReference->SetLabel(FName(TEXT("StrongReference")));

	RawReference = NewObject<UAegisGcProbeObject>(this);
	RawReference->SetLabel(FName(TEXT("RawReference")));

	RawReferenceObserver = RawReference;

	UAegisGcProbeObject* WeakObject = NewObject<UAegisGcProbeObject>(this);
	WeakObject->SetLabel(FName(TEXT("WeakReference")));
	WeakReference = WeakObject;
	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("GC objects created: Actor=%p Strong=%p Raw=%p RawObserverValid=%s Weak=%p WeakValid=%s"),
		this,
		StrongReference.Get(),
		RawReference,
		RawReferenceObserver.IsValid() ? TEXT("true") : TEXT("false"),
		WeakReference.Get(),
		WeakReference.IsValid() ? TEXT("true") : TEXT("false"));
}

void AAegisGcExperimentActor::CollectGarbageAndReport()
{
	if (!IsValid(StrongReference.Get()))
	{
		UE_LOG(
			LogAegisCore,
			Warning,
			TEXT("Create experiment objects before collecting garbage: Actor=%p"),
			this);
		return;
	}

	const void* RawAddressBeforeGc = RawReference;

	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("Before GC: StrongValid=%s Raw=%p RawObserverValid=%s WeakValid=%s"),
		IsValid(StrongReference.Get()) ? TEXT("true") : TEXT("false"),
		RawAddressBeforeGc,
		RawReferenceObserver.IsValid() ? TEXT("true") : TEXT("false"),
		WeakReference.IsValid() ? TEXT("true") : TEXT("false"));

	CollectGarbage(RF_NoFlags, true);

	// GC 后 RawReference 可能已经悬空，立即清空，不再读取或解引用。
	RawReference = nullptr;

	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("After GC: StrongValid=%s RawAddressBeforeGc=%p RawObserverValid=%s WeakValid=%s"),
		IsValid(StrongReference.Get()) ? TEXT("true") : TEXT("false"),
		RawAddressBeforeGc,
		RawReferenceObserver.IsValid() ? TEXT("true") : TEXT("false"),
		WeakReference.IsValid() ? TEXT("true") : TEXT("false"));
}

void AAegisGcExperimentActor::RunRootExperiment()
{
	UAegisGcProbeObject* RootObject = NewObject<UAegisGcProbeObject>(this);
	RootObject->SetLabel(FName(TEXT("RootReference")));

	TWeakObjectPtr<UAegisGcProbeObject> RootObserver = RootObject;
	const void* RootAddress = RootObject;

	RootObject->AddToRoot();

	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("Before rooted GC: Object=%p IsRooted=%s ObserverValid=%s"),
		RootAddress,
		RootObject->IsRooted() ? TEXT("true") : TEXT("false"),
		RootObserver.IsValid() ? TEXT("true") : TEXT("false"));

	CollectGarbage(RF_NoFlags, true);

	// AddToRoot 保证此处对象仍然可达，因此可以安全访问。
	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("After AddToRoot GC: ObjectValid=%s IsRooted=%s ObserverValid=%s"),
		IsValid(RootObject) ? TEXT("true") : TEXT("false"),
		RootObject->IsRooted() ? TEXT("true") : TEXT("false"),
		RootObserver.IsValid() ? TEXT("true") : TEXT("false"));

	// 移除 Root 后，不再保留任何强引用。
	RootObject->RemoveFromRoot();
	RootObject = nullptr;

	CollectGarbage(RF_NoFlags, true);

	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("After RemoveFromRoot GC: Address=%p ObserverValid=%s"),
		RootAddress,
		RootObserver.IsValid() ? TEXT("true") : TEXT("false"));
}

void AAegisGcExperimentActor::InspectSoftReference()
{
	if (SoftReference.IsNull())
	{
		UE_LOG(
			LogAegisCore,
			Warning,
			TEXT("Soft reference is null: assign an asset before inspection."));
		return;
	}

	const FString AssetPath = SoftReference.ToSoftObjectPath().ToString();
	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("Soft reference before load: Path=%s IsNull=%s IsPending=%s IsValid=%s Get=%p"),
		*AssetPath,
		SoftReference.IsNull() ? TEXT("true") : TEXT("false"),
		SoftReference.IsPending() ? TEXT("true") : TEXT("false"),
		SoftReference.IsValid() ? TEXT("true") : TEXT("false"),
		SoftReference.Get());

	UObject* LoadedObject = SoftReference.LoadSynchronous();

	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("Soft reference after explicit load: Path=%s LoadedObject=%p IsNull=%s IsPending=%s IsValid=%s Get=%p"),
		*AssetPath,
		LoadedObject,
		SoftReference.IsNull() ? TEXT("true") : TEXT("false"),
		SoftReference.IsPending() ? TEXT("true") : TEXT("false"),
		SoftReference.IsValid() ? TEXT("true") : TEXT("false"),
		SoftReference.Get());
}

```

![Aegis GC 实验 Actor 及四个编辑器实验入口](/img/Day0401.png)

### 强引用、裸指针与弱引用

- 通过编辑器先点击 `CreateExperimentObjects`，再点击 `CollectGarbageAndReport`，可以得到的日志如下。

```text
LogAegisCore: GC probe created: Object=000001CD90318300 Label=StrongReference
LogAegisCore: GC probe created: Object=000001CD90316D80 Label=RawReference
LogAegisCore: GC probe created: Object=000001CD90318280 Label=WeakReference
LogAegisCore: Display: GC objects created: Actor=000001CD687D4100 Strong=000001CD90318300 Raw=000001CD90316D80 RawObserverValid=true Weak=000001CD90318280 WeakValid=true
LogAegisCore: Display: Before GC: StrongValid=true Raw=000001CD90316D80 RawObserverValid=true WeakValid=true
LogAegisCore: GC probe BeginDestroy: Object=000001CD90318280 Label=WeakReference
LogAegisCore: GC probe BeginDestroy: Object=000001CD90316D80 Label=RawReference
LogAegisCore: Display: After GC: StrongValid=true RawAddressBeforeGc=000001CD90316D80 RawObserverValid=false WeakValid=false
```

- 三个 `Probe` 都将实验 `Actor` 作为 `Outer`。`GC` 后 `Strong Probe` 仍然有效，`Raw Probe` 和 `Weak Probe` 执行了 `BeginDestroy()`，两个弱观察状态均变为 `false`。这证明可达 `Actor` 的 `UPROPERTY() TObjectPtr` 能够保活目标，而裸指针、弱引用和 `Outer` 关系本身不能形成 `Actor → Probe` 的反向保活关系。

### Root 两阶段实验

- 通过编辑器点击 `RunRootExperiment`，可以得到的日志如下。

```text
LogAegisCore: GC probe created: Object=000001EF99E6F8C0 Label=RootReference
LogAegisCore: Display: Before rooted GC: Object=000001EF99E6F8C0 IsRooted=true ObserverValid=true
LogAegisCore: Display: After AddToRoot GC: ObjectValid=true IsRooted=true ObserverValid=true
LogAegisCore: GC probe BeginDestroy: Object=000001EF99E6F8C0 Label=RootReference
LogAegisCore: Display: After RemoveFromRoot GC: Address=000001EF99E6F8C0 ObserverValid=false
```

- 第一次 `GC` 后 `Root Probe` 仍然有效；执行 `RemoveFromRoot()` 后，第二次 GC 触发 `BeginDestroy()`，弱观察者变为无效，说明 `Root` 的加入和移除直接改变了对象的可达结果。

### 软引用显式加载

- 通过编辑器将 `BP_AegisDeveloperSettings` 作为目标资产设置好后，点击 `InspectSoftReference`，可以得到的日志如下。

```text
LogAegisCore: Display: Soft reference before load: Path=/Game/Aegis/Settings/BP_AegisDeveloperSettings.BP_AegisDeveloperSettings IsNull=false IsPending=true IsValid=false Get=0000000000000000
LogAegisCore: Display: Soft reference after explicit load: Path=/Game/Aegis/Settings/BP_AegisDeveloperSettings.BP_AegisDeveloperSettings LoadedObject=000002609A18C000 IsNull=false IsPending=false IsValid=true Get=000002609A18C000
```

- 显式加载前，软引用保留路径并处于 `Pending` 状态，`Get()` 返回空地址；调用 `LoadSynchronous()` 后，`IsPending()` 变为 `false`、`IsValid()` 变为 `true`，并且 `LoadedObject` 与 `Get()` 返回相同地址。

## 验证或作品证据

<video controls playsinline preload="metadata" aria-label="对象指针、Outer 与 GC 可达性" style="display: block; width: 100%; border-radius: 12px;">
  <source src="/media/ue/day04/Day04_ObjectPointers_GC_20260719.mp4" type="video/mp4" />
  当前浏览器不支持视频播放，
  <a href="/media/ue/day04/Day04_ObjectPointers_GC_20260719.mp4">请打开视频文件</a>。
</video>

- 这段录屏展示了强引用、软引用、弱引用、裸指针各自的特性。

## 问题与复盘

### 是否保活

最开始误以为只要目标有强引用，就会保活，不会被回收或者销毁、清理，经过今天的编码实验和文档阅读，才明白过来强引用保活的前提是持有者可达，并且该引用关系能够被 `GC` 追踪时，才能继续扩展可达链。在今天的实践中，可达实验 `Actor` 的 `UPROPERTY() TObjectPtr` 保活了 `Strong Probe`。

### 软引用状态混淆

软引用未加载时的状态描述不严谨，不能认为未加载时是安全无效状态，当有效路径已经设置但目标尚未加载时，`IsPending()` 返回 `true`，`IsValid()` 会返回 `false`，`Get()` 拿到空指针，显式调用加载且成功后，`IsPending()` 返回 `false`，`IsValid()` 返回 `true`，`Get()` 拿到有效值。

## 我的理解

- 判断一个 `UObject` 是否可达时，不能只看本身有没有强引用关系，还要关注其持有者是否可达，以及这条引用是否能够被 `GC` 追踪。另外，要注意的是即使没有强引用关系，还要看看是否被 `AddToRoot()` 了，因为 `Root` 是 `GC` 追踪的起点。
- 选择引用类型前，应该先确认是否需要保活目标、持有者是什么类型，以及目标是否必须立即加载。可达 `UObject` 的成员需要保活目标时，使用 `UPROPERTY() TObjectPtr`，如果只是观察某个 `UObject` 是否有效时，使用 `TWeakObjectPtr`，希望保存资产路径并在以后显式加载，使用 `TSoftObjectPtr` 即可。
- 裸指针的使用一定要注意安全性，只适合生命周期已经由其他机制保证的临时访问，不能单独作为保活或失效检测依据。销毁、清理后不能直接访问和解引用。
- `Outer` 表达内部对象指向外层对象的命名和上下文关系，但不会自动建立 `Outer->内部对象` 的反向强引用，因此不能仅凭 `Outer` 判断内部对象会被保活。

## 对外表达

- 今天实现了 `AAegisGcExperimentActor` 和 `UAegisGcProbeObject` 两个实验类。通过这两个实验类的相关逻辑，让我明白了下面这些内容。
- `UPROPERTY()` 不等于所有权。
- `UPROPERTY() TObjectPtr<T>` 是强引用，当持有者可达，且能被 `GC` 追踪时，`UPROPERTY() TObjectPtr<T>` 指向的对象是保活的。
- `TWeakObjectPtr<T>` 是弱引用，不能保活，只能观察是否有效。
- `TSoftObjectPtr<T>` 是软引用，持有资产路径，但不会主动将资产加载进内存；需要时可以由代码显式调用加载资产。
- 裸指针不能作为保活依据，且在销毁、清理后不能直接访问。
- 还明白了是内部对象指向 `Outer`，仅仅指定 `Outer` 不会自动建立 `Outer → 内部对象` 的反向 `GC` 强引用。
- 在实验中 `GC` 后 `Strong Probe` 仍然有效，`Raw/Weak Probe` 被回收，两个弱观察状态变为 `false`。
- 软引用从 `IsPending=true`、`IsValid=false`、`Get=nullptr`，变为显式加载后的 `IsPending=false`、`IsValid=true` 和有效对象地址。

## 下一步

进入课程计划里面的 Day 05 `Actor` 与 `Component` 生命周期。
