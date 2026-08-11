---
title: "UE Day 09：GameInstance 与 Subsystem 生命周期"
description: "通过跨地图 World 观察与多 LocalPlayer 实验，验证 GameInstanceSubsystem 和 LocalPlayerSubsystem 的生命周期、实例隔离及回调清理边界。"
date: 2026-07-28
domain: ue
type: journal
series: ue-client-roadmap
tags:
  - Unreal Engine 5
  - C++
  - Project Aegis
  - GameInstance
  - Subsystem
status: published
outline: deep
---

# UE Day 09：GameInstance 与 Subsystem 生命周期

## 背景与目标

### 背景

`GameInstance` 和 `Subsystem` 是 `UE` 工程里面 `Gameplay Framework` 的基础，而且在 `UE` 工程中会有跨地图场景，另外使用 `Actor` 或静态单例来管理一个游戏实例中的状态存在很多不足，所以需要掌握 `GameInstance` 和 `Subsystem` 的生命周期，以及职责边界。

### 目标

通过增加 `UAegisSessionSubsystem`，掌握 `UGameInstanceSubsystem` 和 `UGameInstance` 的关系，以及自身的生命周期，还有在地图 `Travel` 时的特性；通过新增 `UAegisLocalSettingsSubsystem`，掌握 `ULocalPlayerSubsystem` 和 `ULocalPlayer` 的关系，以及自身的生命周期。

- 跨地图实验的可观察目标：`Travel` 前后 `UAegisSessionSubsystem` 地址不变，`GameInstance` 地址不变，`World` 发生变化。
- 多本地玩家实验的可观察目标：同一 `GameInstance` 下，不同 `LocalPlayer` 各自拥有独立的 `ULocalPlayerSubsystem`。

## 关键概念

### Subsystem 生命周期与实例归属

`UGameInstanceSubsystem` 的 `Outer` 是 `GameInstance`，由对应的 `Subsystem Collection` 自动创建。它的生命周期通常覆盖所属 `GameInstance`，适合承载跨地图的 `Session` 服务，但不是进程全局单例；单进程多人 `PIE` 中可以同时存在多个 `GameInstance`，每个游戏实例都有自己的 `UGameInstanceSubsystem` 实例。

`ULocalPlayerSubsystem` 由每个 `LocalPlayer` 对应的 `Subsystem Collection` 自动创建，其 `Outer` 是所属 `LocalPlayer`。`ULocalPlayerSubsystem` 不是当前玩家全局对象，适合本地玩家设置，同一个 `GameInstance` 可以有多个 `ULocalPlayerSubsystem` 实例，每个 `LocalPlayer` 都有自己独立的实例。

`Subsystem` 的 `Initialize()` 适合做一些资源初始化注册，回调绑定等工作，`Deinitialize()` 适合做一些资源清理，解除回调绑定的工作。而且资源注册和清理需要在 `Initialize()` 和 `Deinitialize()` 进行配对。否则可能会有如下问题：`Subsystem` 已经退出有效服务期后，仍可能收到后续回调；对象在 `Deinitialize()` 后不一定立即被 `GC`，因此回调仍可能进入已清理的内部状态；重新创建游戏实例时，可能出现旧绑定与新绑定并存，产生重复日志或重复状态修改；生命周期边界变得不明确，后续增加资源、`Timer` 或其他引用后风险会进一步扩大。`Initialize()` 只代表 `Subsystem` 已创建，不代表 `World` 已加载或 `Gameplay` 已经 `BeginPlay`。尤其是 `UGameInstanceSubsystem::Initialize()` 中不能假定 `GetWorld()` 已经返回可用的 `Gameplay World`。

### World 上下文与观察边界

在同一个 `GameInstance` 的普通地图 `Travel` 中，旧 `World` 进入清理流程，并创建一个地址不同的新 `World`。对应的 `UGameInstanceSubsystem` 会保持不变，但不能把旧 `UWorld*` 当做长期状态保存，否则可能在指针失效后继续访问旧 `World`，产生不可预知的错误。

需要注意的是 `PIE duplication World` 是通过复制获得的，所以不会回调 `PostLoadMapWithWorld`，`PostLoadMapWithWorld` 会在 `LoadMap` 时回调触发。不论是 `LoadMap` 还是 `duplication`，都会执行 `UWorld::InitWorld()`，在 `UWorld::InitWorld()` 中会回调 `FWorldDelegates::OnPostWorldInitialization`。

在观察 `World` 时，为了确保是有效 `World`，需要通过 `IsValid()` 确认，为了观察是否是 `GameWorld`，需要通过 `IsGameWorld()` 来确认，为了确认是不是在同一个 `GameInstance`，需要通过 `InitializedWorld->GetGameInstance() == GetGameInstance()` 来确认。`IsValid()` 只能说明对象当前仍可用，不代表 `Gameplay` 已经开始；如果要判断运行阶段，还需要结合 `HasBegunPlay()`、`World Type` 和 `NetMode` 共同确认。

确认一个 `World` 类型和当前运行上下文时，需要通过 `World Type`、`World` 名称、`World` 路径，以及 `World` 对应的 `NetMode` 综合确认。需要注意的是 `World` 初始化完成之后不能默认 `Gameplay` 已经 `BeginPlay()`。

`GWorld` 是引擎维护的当前 `World` 上下文，可能随 `World` 切换或调用上下文变化；项目自己长期保存的静态 `UWorld*`，则可能继续指向已经 `Cleanup` 的旧 `World`。两者都不能替代来自当前对象、`WorldContext` 或明确 `Subsystem` 上下文的 `World`，否则可能导致旧 `World`、`Listen Server World` 和 `Client World` 串用。

### 蓝图说明符

| 说明符 | 解决的问题 |
|---|---|
| `BlueprintType` | 蓝图能否把该类型作为变量、属性、参数或引脚类型 |
| `Blueprintable` | 蓝图能否创建该类的蓝图子类 |

即使类已经支持蓝图类型，普通 `C++` 成员函数也不会自动变成蓝图节点。`UCLASS()` 是“让 UE 认识这个类”；`BlueprintType` 是“让蓝图把它当成一种类型”；`Blueprintable` 是“允许蓝图继承它”；`BlueprintCallable`、`BlueprintReadOnly` 等说明符则决定蓝图具体能做什么。是否添加这些能力，应该由真实蓝图调用需求决定。

## 实践过程

为了观察跨 `World` 的特性，新增继承自 `UGameInstanceSubsystem` 的 `UAegisSessionSubsystem`。具体代码如下。

```cpp
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Engine/World.h"

#include "AegisSessionSubsystem.generated.h"

/**
 * 保存单个 GameInstance 的跨地图观察状态。
 * 这个 Session 不是 Online Session，也不是网络复制状态。
 */
UCLASS()
class PROJECTAEGIS_API UAegisSessionSubsystem final : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	int32 GetObservedWorldCount() const
	{
		return ObservedWorldCount;
	}
	const FString& GetLastLoadedWorldPath() const
	{
		return LastLoadedWorldPath;
	}

private:
	void HandlePostWorldInitialization(UWorld* InitializedWorld, const UWorld::InitializationValues);

	// 只是统计属于当前 GameInstance 的有效游戏 World。
	int32 ObservedWorldCount = 0;
	// 保存安全复制的最后观察到的 World 路径，不持有旧 World。
	FString LastLoadedWorldPath;
	// 用于保证 World 初始化回调注册与清理配对。
	FDelegateHandle PostWorldInitializationHandle;
};
```

```cpp
#include "AegisSessionSubsystem.h"

#include "AegisCoreLog.h"
#include "Engine/GameInstance.h"
#include "Engine/World.h"

void UAegisSessionSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	PostWorldInitializationHandle = FWorldDelegates::OnPostWorldInitialization.AddUObject(this, &UAegisSessionSubsystem::HandlePostWorldInitialization);
	const TCHAR* LastLoadedWorldPathText = LastLoadedWorldPath.IsEmpty() ? TEXT("<none>") : *LastLoadedWorldPath;

	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("UAegisSessionSubsystem Event=Initialize Subsystem=%p GameInstance=%p GameInstanceName=%s ObservedWorldCount=%d LastLoadedWorldPath=%s"),
		this,
		GetGameInstance(),
		*GetNameSafe(GetGameInstance()),
		ObservedWorldCount,
		LastLoadedWorldPathText);
}

void UAegisSessionSubsystem::Deinitialize()
{
	if (PostWorldInitializationHandle.IsValid())
	{
		FWorldDelegates::OnPostWorldInitialization.Remove(PostWorldInitializationHandle);
		PostWorldInitializationHandle.Reset();
	}
	const TCHAR* LastLoadedWorldPathText = LastLoadedWorldPath.IsEmpty() ? TEXT("<none>") : *LastLoadedWorldPath;

	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("UAegisSessionSubsystem Event=Deinitialize Subsystem=%p GameInstance=%p ObservedWorldCount=%d LastLoadedWorldPath=%s"),
		this,
		GetGameInstance(),
		ObservedWorldCount,
		LastLoadedWorldPathText);
	Super::Deinitialize();
}

void UAegisSessionSubsystem::HandlePostWorldInitialization(UWorld* InitializedWorld, const UWorld::InitializationValues)
{
	if (!IsValid(InitializedWorld))
	{
		return;
	}

	UGameInstance* GameInstance = GetGameInstance();

	if (!IsValid(GameInstance))
	{
		return;
	}

	if (!InitializedWorld->IsGameWorld())
	{
		return;
	}

	if (InitializedWorld->GetGameInstance() != GameInstance)
	{
		return;
	}

	++ObservedWorldCount;
	LastLoadedWorldPath = InitializedWorld->GetPathName();
	const TCHAR* LastLoadedWorldPathText = LastLoadedWorldPath.IsEmpty() ? TEXT("<none>") : *LastLoadedWorldPath;
	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("UAegisSessionSubsystem HandlePostWorldInitialization Event=WorldObserved Subsystem=%p GameInstance=%p World=%p WorldName=%s WorldPath=%s WorldType=%s NetMode=%s ObservedWorldCount=%d LastLoadedWorldPath=%s"),
		this,
		GameInstance,
		InitializedWorld,
		*GetNameSafe(InitializedWorld),
		*InitializedWorld->GetPathName(),
		LexToString(InitializedWorld->WorldType),
		*ToString(InitializedWorld->GetNetMode()),
		ObservedWorldCount,
		LastLoadedWorldPathText);
}
```
为了遵循“只在 Initialize() 到 Deinitialize() 之间接收回调”的生命周期契约，在 `UAegisSessionSubsystem::Initialize()` 中注册 `FWorldDelegates::OnPostWorldInitialization`，在 `UAegisSessionSubsystem::Deinitialize()` 中解绑。


为了让每个 `LocalPlayer` 拥有独立的本地设置对象，新增继承自 `ULocalPlayerSubsystem` 的 `UAegisLocalSettingsSubsystem`，具体代码如下。

```cpp
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/LocalPlayerSubsystem.h"

#include "AegisLocalSettingsSubsystem.generated.h"

class APlayerController;

/**
 * 保存单个 LocalPlayer 的内存设置。
 * 设置不复制、不发送服务器，也不写入磁盘。
 */
UCLASS()
class PROJECTAEGIS_API UAegisLocalSettingsSubsystem final : public ULocalPlayerSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;
	virtual void PlayerControllerChanged(APlayerController* NewPlayerController) override;

	bool SetLookSensitivity(float NewLookSensitivity);
	float GetLookSensitivity() const
	{
		return LookSensitivity;
	}

	void SetInvertYAxis(bool bNewInvertYAxis);
	bool IsYAxisInverted() const
	{
		return bInvertYAxis;
	}

private:
	// 属于该 LocalPlayer 的视角灵敏度。
	float LookSensitivity = 1.0f;
	// 属于该 LocalPlayer 的 Y 轴反转选项。
	bool bInvertYAxis = false;
};
```

```cpp
#include "AegisLocalSettingsSubsystem.h"

#include "AegisCoreLog.h"
#include "Engine/GameInstance.h"
#include "Engine/LocalPlayer.h"
#include "GameFramework/PlayerController.h"

void UAegisLocalSettingsSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	ULocalPlayer* LocalPlayer = GetLocalPlayer();
	UGameInstance* GameInstance = nullptr;
	int32 ControllerId = INDEX_NONE;
	if (IsValid(LocalPlayer))
	{
		GameInstance = LocalPlayer->GetGameInstance();
		ControllerId = LocalPlayer->GetControllerId();
	}

	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("UAegisLocalSettingsSubsystem Initialize Event=Initialize Subsystem=%p LocalPlayer=%p LocalPlayerName=%s GameInstance=%p ControllerId=%d LookSensitivity=%.2f InvertYAxis=%s"),
		this,
		LocalPlayer,
		*GetNameSafe(LocalPlayer),
		GameInstance,
		ControllerId,
		LookSensitivity,
		bInvertYAxis ? TEXT("true") : TEXT("false"));
}

void UAegisLocalSettingsSubsystem::Deinitialize()
{
	ULocalPlayer* LocalPlayer = GetLocalPlayer();
	UGameInstance* GameInstance = nullptr;
	int32 ControllerId = INDEX_NONE;
	if (IsValid(LocalPlayer))
	{
		GameInstance = LocalPlayer->GetGameInstance();
		ControllerId = LocalPlayer->GetControllerId();
	}
	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("UAegisLocalSettingsSubsystem Event=Deinitialize Subsystem=%p LocalPlayer=%p GameInstance=%p ControllerId=%d LookSensitivity=%.2f InvertYAxis=%s"),
		this,
		LocalPlayer,
		GameInstance,
		ControllerId,
		LookSensitivity,
		bInvertYAxis ? TEXT("true") : TEXT("false"));
	Super::Deinitialize();
}

void UAegisLocalSettingsSubsystem::PlayerControllerChanged(APlayerController* NewPlayerController)
{
	Super::PlayerControllerChanged(NewPlayerController);
	ULocalPlayer* LocalPlayer = GetLocalPlayer();
	UGameInstance* GameInstance = nullptr;
	int32 ControllerId = INDEX_NONE;
	if (IsValid(LocalPlayer))
	{
		GameInstance = LocalPlayer->GetGameInstance();
		ControllerId = LocalPlayer->GetControllerId();
	}
	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("UAegisLocalSettingsSubsystem Event=PlayerControllerChanged Subsystem=%p LocalPlayer=%p GameInstance=%p ControllerId=%d PlayerController=%p PlayerControllerName=%s LookSensitivity=%.2f InvertYAxis=%s"),
		this,
		LocalPlayer,
		GameInstance,
		ControllerId,
		NewPlayerController,
		*GetNameSafe(NewPlayerController),
		LookSensitivity,
		bInvertYAxis ? TEXT("true") : TEXT("false"));
}

bool UAegisLocalSettingsSubsystem::SetLookSensitivity(float NewLookSensitivity)
{
	const float OldLookSensitivity = LookSensitivity;
	ULocalPlayer* LocalPlayer = GetLocalPlayer();
	if (NewLookSensitivity <= 0.0f || !FMath::IsFinite(NewLookSensitivity))
	{
		UE_LOG(
			LogAegisCore,
			Warning,
			TEXT("UAegisLocalSettingsSubsystem Event=LookSensitivityRejected Subsystem=%p LocalPlayer=%p OldValue=%.2f RequestedValue=%.2f"),
			this,
			LocalPlayer,
			OldLookSensitivity,
			NewLookSensitivity);
		return false;
	}
	LookSensitivity = NewLookSensitivity;
	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("UAegisLocalSettingsSubsystem Event=LookSensitivityChanged Subsystem=%p LocalPlayer=%p OldValue=%.2f NewValue=%.2f"),
		this,
		LocalPlayer,
		OldLookSensitivity,
		LookSensitivity);
	return true;
}

void UAegisLocalSettingsSubsystem::SetInvertYAxis(bool bNewInvertYAxis)
{
	const bool OldInvertYAxis = bInvertYAxis;
	bInvertYAxis = bNewInvertYAxis;
	ULocalPlayer* LocalPlayer = GetLocalPlayer();
	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("UAegisLocalSettingsSubsystem Event=InvertYAxisChanged Subsystem=%p LocalPlayer=%p OldValue=%s NewValue=%s"),
		this,
		LocalPlayer,
		OldInvertYAxis ? TEXT("true") : TEXT("false"),
		bInvertYAxis ? TEXT("true") : TEXT("false"));
}
```

通过 `UAegisLocalSettingsSubsystem::PlayerControllerChanged` 观察 `Controller` 的变化。

启动一次 `Standalone PIE` 后，`Travel` 到 `Lvl_ThirdPerson`，日志如下。

```text
[2026.07.28-04.13.39:242][202]LogPlayLevel: PIE: Created PIE world by copying editor world from /Game/Aegis/Labs/Lvl_LifecycleLab.Lvl_LifecycleLab to /Game/Aegis/Labs/UEDPIE_0_Lvl_LifecycleLab.Lvl_LifecycleLab (0.006687s)
[2026.07.28-04.13.39:283][202]LogAegisCore: Display: UAegisSessionSubsystem Event=Initialize Subsystem=00000230282C08A0 GameInstance=000002302D040A00 GameInstanceName=GameInstance_0 ObservedWorldCount=0 LastLoadedWorldPath=<none>
[2026.07.28-04.13.39:287][202]LogAegisCore: Display: UAegisSessionSubsystem HandlePostWorldInitialization Event=WorldObserved Subsystem=00000230282C08A0 GameInstance=000002302D040A00 World=0000023016C46200 WorldName=Lvl_LifecycleLab WorldPath=/Game/Aegis/Labs/UEDPIE_0_Lvl_LifecycleLab.Lvl_LifecycleLab WorldType=PIE NetMode=Standalone ObservedWorldCount=1 LastLoadedWorldPath=/Game/Aegis/Labs/UEDPIE_0_Lvl_LifecycleLab.Lvl_LifecycleLab
[2026.07.28-04.13.39:287][202]LogAegisCore: Display: Aegis World Lifecycle PostInit: World=0000023016C46200 Name=Lvl_LifecycleLab Path=/Game/Aegis/Labs/UEDPIE_0_Lvl_LifecycleLab.Lvl_LifecycleLab WorldType=PIE NetMode=Standalone PIEInstanceId=0 IsGameWorld=true HasBegunPlay=false GameInstance=000002302D040A00 GameInstanceName=GameInstance_0 PersistentLevel=0000023045FEF000 PersistentLevelName=PersistentLevel
[2026.07.28-04.13.39:324][202]LogAegisCore: Display: UAegisLocalSettingsSubsystem Initialize Event=Initialize Subsystem=00000230295CCCC0 LocalPlayer=0000023028A47E00 LocalPlayerName=LocalPlayer_0 GameInstance=000002302D040A00 ControllerId=0 LookSensitivity=1.00 InvertYAxis=false
[2026.07.28-04.13.39:355][202]LogAegisCore: Display: UAegisLocalSettingsSubsystem Event=PlayerControllerChanged Subsystem=00000230295CCCC0 LocalPlayer=0000023028A47E00 GameInstance=000002302D040A00 ControllerId=0 PlayerController=0000023045AA8200 PlayerControllerName=BP_ThirdPersonPlayerController_C_0 LookSensitivity=1.00 InvertYAxis=false
[2026.07.28-04.13.54:679][327]LogGlobalStatus: UEngine::Browse Started Browse: "/Game/ThirdPerson/Lvl_ThirdPerson"
[2026.07.28-04.13.54:679][327]LogNet: Browse: /Game/ThirdPerson/Lvl_ThirdPerson
[2026.07.28-04.13.54:680][327]LogLoad: LoadMap: /Game/ThirdPerson/Lvl_ThirdPerson
[2026.07.28-04.13.54:684][327]LogAegisCore: Display: Aegis World Lifecycle Cleanup: World=0000023016C46200 Name=Lvl_LifecycleLab Path=/Game/Aegis/Labs/UEDPIE_0_Lvl_LifecycleLab.Lvl_LifecycleLab WorldType=PIE NetMode=Standalone PIEInstanceId=0 IsGameWorld=true HasBegunPlay=false SessionEnded=true CleanupResources=true
[2026.07.28-04.13.54:770][327]LogAegisCore: Display: UAegisSessionSubsystem HandlePostWorldInitialization Event=WorldObserved Subsystem=00000230282C08A0 GameInstance=000002302D040A00 World=000002303C49C400 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=PIE NetMode=Standalone ObservedWorldCount=2 LastLoadedWorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson
[2026.07.28-04.13.54:770][327]LogAegisCore: Display: Aegis World Lifecycle PostInit: World=000002303C49C400 Name=Lvl_ThirdPerson Path=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=PIE NetMode=Standalone PIEInstanceId=0 IsGameWorld=true HasBegunPlay=false GameInstance=000002302D040A00 GameInstanceName=GameInstance_0 PersistentLevel=00000230A4409C00 PersistentLevelName=PersistentLevel
[2026.07.28-04.13.54:803][327]LogAegisCore: Display: UAegisLocalSettingsSubsystem Event=PlayerControllerChanged Subsystem=00000230295CCCC0 LocalPlayer=0000023028A47E00 GameInstance=000002302D040A00 ControllerId=0 PlayerController=0000023020736E00 PlayerControllerName=BP_ThirdPersonPlayerController_C_0 LookSensitivity=1.00 InvertYAxis=false
[2026.07.28-04.14.03:118][403]LogAegisCore: Display: UAegisLocalSettingsSubsystem Event=Deinitialize Subsystem=00000230295CCCC0 LocalPlayer=0000023028A47E00 GameInstance=000002302D040A00 ControllerId=0 LookSensitivity=1.00 InvertYAxis=false
[2026.07.28-04.14.03:118][403]LogAegisCore: Display: UAegisSessionSubsystem Event=Deinitialize Subsystem=00000230282C08A0 GameInstance=000002302D040A00 ObservedWorldCount=2 LastLoadedWorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson
[2026.07.28-04.14.03:120][403]LogAegisCore: Display: Aegis World Lifecycle Cleanup: World=000002303C49C400 Name=Lvl_ThirdPerson Path=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=PIE NetMode=Standalone PIEInstanceId=0 IsGameWorld=true HasBegunPlay=false SessionEnded=true CleanupResources=true
```

执行 `DebugCreatePlayer 1` 后的日志如下。

```text
[2026.07.28-04.35.01:874][724]LogPlayLevel: PIE: Created PIE world by copying editor world from /Game/Aegis/Labs/Lvl_LifecycleLab.Lvl_LifecycleLab to /Game/Aegis/Labs/UEDPIE_0_Lvl_LifecycleLab.Lvl_LifecycleLab (0.012799s)
[2026.07.28-04.35.01:949][724]LogAegisCore: Display: UAegisSessionSubsystem Event=Initialize Subsystem=000002303C42D2C0 GameInstance=0000022F9531CD00 GameInstanceName=GameInstance_1 ObservedWorldCount=0 LastLoadedWorldPath=<none>
[2026.07.28-04.35.01:953][724]LogAegisCore: Display: UAegisSessionSubsystem HandlePostWorldInitialization Event=WorldObserved Subsystem=000002303C42D2C0 GameInstance=0000022F9531CD00 World=000002302CB03800 WorldName=Lvl_LifecycleLab WorldPath=/Game/Aegis/Labs/UEDPIE_0_Lvl_LifecycleLab.Lvl_LifecycleLab WorldType=PIE NetMode=Standalone ObservedWorldCount=1 LastLoadedWorldPath=/Game/Aegis/Labs/UEDPIE_0_Lvl_LifecycleLab.Lvl_LifecycleLab
[2026.07.28-04.35.01:953][724]LogAegisCore: Display: Aegis World Lifecycle PostInit: World=000002302CB03800 Name=Lvl_LifecycleLab Path=/Game/Aegis/Labs/UEDPIE_0_Lvl_LifecycleLab.Lvl_LifecycleLab WorldType=PIE NetMode=Standalone PIEInstanceId=0 IsGameWorld=true HasBegunPlay=false GameInstance=0000022F9531CD00 GameInstanceName=GameInstance_1 PersistentLevel=0000022F95373000 PersistentLevelName=PersistentLevel
[2026.07.28-04.35.01:988][724]LogAegisCore: Display: UAegisLocalSettingsSubsystem Initialize Event=Initialize Subsystem=000002303C7D1C80 LocalPlayer=00000230A758DB00 LocalPlayerName=LocalPlayer_1 GameInstance=0000022F9531CD00 ControllerId=0 LookSensitivity=1.00 InvertYAxis=false
[2026.07.28-04.35.02:002][724]LogAegisCore: Display: UAegisLocalSettingsSubsystem Event=PlayerControllerChanged Subsystem=000002303C7D1C80 LocalPlayer=00000230A758DB00 GameInstance=0000022F9531CD00 ControllerId=0 PlayerController=00000230A6D8D200 PlayerControllerName=BP_ThirdPersonPlayerController_C_0 LookSensitivity=1.00 InvertYAxis=false
[2026.07.28-04.35.11:681][847]LogAegisCore: Display: UAegisLocalSettingsSubsystem Initialize Event=Initialize Subsystem=000002302A3EED40 LocalPlayer=000002302A479300 LocalPlayerName=LocalPlayer_2 GameInstance=0000022F9531CD00 ControllerId=1 LookSensitivity=1.00 InvertYAxis=false
[2026.07.28-04.35.11:685][847]LogAegisCore: Display: UAegisLocalSettingsSubsystem Event=PlayerControllerChanged Subsystem=000002302A3EED40 LocalPlayer=000002302A479300 GameInstance=0000022F9531CD00 ControllerId=1 PlayerController=00000230A732B400 PlayerControllerName=BP_ThirdPersonPlayerController_C_1 LookSensitivity=1.00 InvertYAxis=false
[2026.07.28-04.35.30:290][ 59]LogAegisCore: Display: UAegisLocalSettingsSubsystem Event=Deinitialize Subsystem=000002302A3EED40 LocalPlayer=000002302A479300 GameInstance=0000022F9531CD00 ControllerId=1 LookSensitivity=1.00 InvertYAxis=false
[2026.07.28-04.36.07:895][410]LogAegisCore: Display: UAegisLocalSettingsSubsystem Event=Deinitialize Subsystem=000002303C7D1C80 LocalPlayer=00000230A758DB00 GameInstance=0000022F9531CD00 ControllerId=0 LookSensitivity=1.00 InvertYAxis=false
[2026.07.28-04.36.07:895][410]LogAegisCore: Display: UAegisSessionSubsystem Event=Deinitialize Subsystem=000002303C42D2C0 GameInstance=0000022F9531CD00 ObservedWorldCount=1 LastLoadedWorldPath=/Game/Aegis/Labs/UEDPIE_0_Lvl_LifecycleLab.Lvl_LifecycleLab
[2026.07.28-04.36.07:896][410]LogAegisCore: Display: Aegis World Lifecycle Cleanup: World=000002302CB03800 Name=Lvl_LifecycleLab Path=/Game/Aegis/Labs/UEDPIE_0_Lvl_LifecycleLab.Lvl_LifecycleLab WorldType=PIE NetMode=Standalone PIEInstanceId=0 IsGameWorld=true HasBegunPlay=false SessionEnded=true CleanupResources=true
```

## 验证或作品证据

<video controls playsinline preload="metadata" aria-label="GameInstance 与 Subsystem 生命周期" style="display: block; width: 100%; border-radius: 12px;">
  <source src="/media/ue/day09/day09-gameinstance-subsystem.mp4" type="video/mp4" />
  当前浏览器不支持视频播放，
  <a href="/media/ue/day09/day09-gameinstance-subsystem.mp4">请打开视频文件</a>。
</video>

本视频展示实验过程及对应的日志。

## 问题与复盘

### PIE duplication World 未被旧观察入口统计

第一版代码使用 `PostLoadMapWithWorld` 进行统计，实验之后观察日志，发现 `World` 数量比预期少一次。通过资料查询得知初始 `PIE World` 由 `CreatePIEWorldByDuplication` 创建，没有广播 `PostLoadMapWithWorld`，后续的 `LoadMap` 才触发。对照 `World.cpp` 和 `UnrealEngine.cpp`，确认了两条创建路径最终都进入了 `UWorld::InitWorld()`，之后改用 `FWorldDelegates::OnPostWorldInitialization`，最终能够正确统计 `World` 数量。

### DebugRemovePlayer 与 Pawn 清理职责边界

`DebugRemovePlayer 1` 移除了第二个 `LocalPlayer`、视口和 `Local Settings Subsystem`，但场景中可能仍有第二个 `Pawn`。调试命令的 `LocalPlayer/PlayerController` 移除流程与 `Pawn` 的 `Gameplay` 清理流程不是同一件事。`GameMode` 或服务器离开玩家流程决定清理策略；`PlayerController/Pawn` 或项目自定义流程执行 `UnPossess`、销毁或回收；`Local Settings Subsystem` 只负责本地设置状态和自己的生命周期清理。

## 下一步

学习 `GameMode` 与 `GameState`。
