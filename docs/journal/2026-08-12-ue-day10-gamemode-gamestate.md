---
title: "UE Day 10：GameMode 与 GameState 的权威边界"
description: "通过服务器训练阶段、整数秒倒计时和客户端复制实验，验证 GameMode 的权威规则职责与 GameState 的共享状态职责。"
date: 2026-08-12
domain: ue
type: journal
series: ue-client-roadmap
tags:
  - Unreal Engine 5
  - C++
  - Project Aegis
  - GameMode
  - GameState
  - Replication
status: published
outline: deep
---

# UE Day 10：GameMode 与 GameState 的权威边界

## 背景与目标

### 背景

在 `UE` 工程中，`GameMode` 和 `GameState` 承担不同的 `Gameplay` 职责，需要正确区分服务器权威规则与客户端可观察的共享状态，为了以后能在实际的生产项目中熟练应用 `GameMode` 和 `GameState`，所以学习这部分内容。

### 目标

通过实现训练阶段和倒计时，掌握 `GameMode` 和 `GameState` 的功能职责边界，以及两者之间的服务器写入和客户端复制边界。

## 关键概念

### GameMode 与 GameState

`GameMode` 承担服务器权威规则和流程控制。在网络游戏中，只存在于服务器，客户端没有权威的 `GameMode`，客户端不能把 `GameMode` 当做共享数据来源。
`GameState` 承担客户端需要观察的共享状态，服务器和客户端存在。服务器通常用于写入数据，客户端复制获得服务器写入的数据。`GameState` 不适合保存服务器内部规则实现状态、敏感信息、只属于单个玩家的本地设置、不需要所有客户端观察的临时对象，以及只由服务器使用而无须复制的内部数据。
服务器端的 `GameMode` 保存当前 `GameState` 的引用；客户端通过当前 `World` 获得复制到本机的 `GameState` 实例，而不是通过 `GameMode` 获取共享状态。
不应该把所有逻辑放进 `GameState`，因为这样会导致：权威规则和共享展示状态职责耦合；服务器专用逻辑被带到客户端副本中；容易遗漏 `Authority` 检查，导致客户端错误执行规则；可能暴露不应该公开的服务器内部状态，复制无关数据，增加网络带宽和 `RepNotify` 开销；后续规则修改、测试和复用会更加困难。

### Authority 与数据写入边界

通常是服务器端的 `GameState` 写入数据，客户端通过复制获得服务器写入的数据，服务器和客户端运行的是同一个 `GameState` 类的不同实例。共享状态由服务器权威实例写入，再复制到客户端实例。对于可能在两端进入的写入入口，应该通过 `HasAuthority()` 限制服务器写入；如果调用链已经明确只会在服务器执行，也可以由调用上下文建立权威边界。客户端本地修改复制属性不会反向写入服务器，并可能被后续服务器复制结果覆盖。

### 属性复制与客户端观察

属性复制用于把服务器属性在网络更新时的当前状态同步到客户端，客户端可以通过 `RepNotify` 响应已接收的状态变化。它不是可靠 `RPC` 事件队列，不保证逐次回放服务器对属性的每一次赋值；同一次网络更新前发生的多个中间值可能被最终状态覆盖。因此，需要逐次保留语义的事件不能仅依赖复制属性表达。

需要在 `GameState` 的头文件中，对需要复制的属性在 `UPROPERTY` 通过 `ReplicatedUsing` 指定复制函数。另外还需要在 `GameState` 中的 `GetLifetimeReplicatedProps()` 中对需要复制的数据使用 `DOREPLIFETIME` 注册属性的生命周期复制规则。

## 实践过程

### 训练阶段与服务器倒计时

在服务器端的 `GameMode` 中注册逐秒进行倒计时的 `Timer`，并在 `Timer` 回调中依次推进 `Waiting->Playing->Completed`，并把阶段和剩余秒数写入 `GameState`。
`Timer` 需要注册和清理配对，遵循在 `BeginPlay()` 中注册，在 `EndPlay()` 中清理的生命周期契约。

```cpp
// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "ProjectAegisGameMode.generated.h"

/**
 *  Simple GameMode for a third person game
 */
UCLASS(abstract)
class AProjectAegisGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:

	/** Constructor */
	AProjectAegisGameMode();

protected:
	/** Gameplay 开始后初始化服务器权威的共享比赛状态。 */
	virtual void BeginPlay() override;

	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
	void HandleTrainingTimer();

private:
	FTimerHandle TrainingTimerHandle;
	float CountDownInterval = 1.0f;
	int32 WaitingSeconds = 3;
	int32 PlayingSeconds = 5;
};
```

```cpp
// Copyright Epic Games, Inc. All Rights Reserved.

#include "ProjectAegisGameMode.h"

#include "AegisCoreLog.h"
#include "ProjectAegisGameState.h"

AProjectAegisGameMode::AProjectAegisGameMode()
{
	GameStateClass = AProjectAegisGameState::StaticClass();
}

void AProjectAegisGameMode::BeginPlay()
{
	Super::BeginPlay();

	if (!HasAuthority())
	{
		return;
	}

	UWorld* World = GetWorld();
	if (!IsValid(World))
	{
		UE_LOG(
			LogAegisCore,
			Error,
			TEXT("GameMode BeginPlay Failed: World is invalid."));
		return;
	}

	FTimerManager& TimerManager = World->GetTimerManager();

	if (TimerManager.IsTimerActive(TrainingTimerHandle))
	{
		return;
	}

	AProjectAegisGameState* AegisGameState = GetGameState<AProjectAegisGameState>();
	if (!IsValid(AegisGameState))
	{
		UE_LOG(
			LogAegisCore,
			Error,
			TEXT("ProjectAegis GameMode BeginPlay failed to get AProjectAegisGameState. GameMode=%p ActualGameState=%s"),
			this,
			*GetNameSafe(GameState.Get()));
		return;
	}

	AegisGameState->SetMatchPhase(EAegisMatchPhase::Waiting);
	AegisGameState->SetRemainingSeconds(WaitingSeconds);
	World->GetTimerManager().SetTimer(TrainingTimerHandle, this, &AProjectAegisGameMode::HandleTrainingTimer, CountDownInterval, true);
	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("ProjectAegis GameMode BeginPlay: GameMode=%p GameState=%p GameStateClass=%s WorldType=%s NetMode=%d HasAuthority=%s MatchPhase=%d "),
		this,
		AegisGameState,
		*GetNameSafe(AegisGameState->GetClass()),
		LexToString(World->WorldType),
		static_cast<int32>(GetNetMode()),
		HasAuthority() ? TEXT("true") : TEXT("false"),
		static_cast<uint8>(AegisGameState->GetMatchPhase()));
}

void AProjectAegisGameMode::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	UWorld* World = GetWorld();
	if (!IsValid(World))
	{
		Super::EndPlay(EndPlayReason);
		UE_LOG(
			LogAegisCore,
			Error,
			TEXT("GameMode EndPlay Failed: World is invalid."));
		return;
	}

	FTimerManager& TimerManager = World->GetTimerManager();

	const bool bWasActive = TimerManager.IsTimerActive(TrainingTimerHandle);

	if (TrainingTimerHandle.IsValid())
	{
		TimerManager.ClearTimer(TrainingTimerHandle);
	}

	const bool bTimerActiveAfterClear = TimerManager.IsTimerActive(TrainingTimerHandle);

	const bool bTimerHandleValidAfterClear = TrainingTimerHandle.IsValid();

	Super::EndPlay(EndPlayReason);
	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("GameMode EndPlay. Reason=%s TimerWasActive=%s TimerActiveAfterClear=%s TimerHandleValidAfterClear=%s"),
		*UEnum::GetValueAsString(EndPlayReason),
		bWasActive ? TEXT("true") : TEXT("false"),
		bTimerActiveAfterClear ? TEXT("true") : TEXT("false"),
		bTimerHandleValidAfterClear ? TEXT("true") : TEXT("false"));
}

void AProjectAegisGameMode::HandleTrainingTimer()
{
	UWorld* World = GetWorld();
	if (!IsValid(World))
	{
		UE_LOG(
			LogAegisCore,
			Error,
			TEXT("GameMode HandleTrainingTimer Failed: World is invalid."));
		return;
	}

	FTimerManager& TimerManager = World->GetTimerManager();

	AProjectAegisGameState* AegisGameState = GetGameState<AProjectAegisGameState>();
	if (!IsValid(AegisGameState))
	{
		UE_LOG(
			LogAegisCore,
			Error,
			TEXT("ProjectAegis GameMode HandleTrainingTimer failed to get AProjectAegisGameState. GameMode=%p ActualGameState=%s"),
			this,
			*GetNameSafe(GameState.Get()));

		TimerManager.ClearTimer(TrainingTimerHandle);
		return;
	}

	if (AegisGameState->GetMatchPhase() == EAegisMatchPhase::Waiting)
	{
		WaitingSeconds = WaitingSeconds - 1;
		UE_LOG(
			LogAegisCore,
			Display,
			TEXT("AProjectAegisGameMode Waiting Remaining. WaitingSeconds=%d"),
			WaitingSeconds);
		AegisGameState->SetRemainingSeconds(WaitingSeconds);
		if (WaitingSeconds <= 0)
		{
			AegisGameState->SetMatchPhase(EAegisMatchPhase::Playing);
			AegisGameState->SetRemainingSeconds(PlayingSeconds);
			UE_LOG(
				LogAegisCore,
				Display,
				TEXT("AProjectAegisGameMode Enter Playing"));
		}
		return;
	}

	if (AegisGameState->GetMatchPhase() == EAegisMatchPhase::Playing)
	{
		PlayingSeconds = PlayingSeconds - 1;
		AegisGameState->SetRemainingSeconds(PlayingSeconds);
		UE_LOG(
			LogAegisCore,
			Display,
			TEXT("AProjectAegisGameMode Playing Remaining Time. PlayingSeconds=%d"),
			PlayingSeconds);
		if (PlayingSeconds <= 0)
		{
			AegisGameState->SetMatchPhase(EAegisMatchPhase::Completed);
			UE_LOG(
				LogAegisCore,
				Display,
				TEXT("AProjectAegisGameMode Enter Completed"));
			if (TrainingTimerHandle.IsValid())
			{
				TimerManager.ClearTimer(TrainingTimerHandle);
			}
		}
		return;
	}
	return;
}
```

### GameState 共享状态与复制

通过服务器 `GameState` 写入 `MatchPhase` 和 `RemainingSeconds`，写入时使用 `HasAuthority()` 过滤非权威调用；属性通过 `ReplicatedUsing` 指定对应的 `RepNotify` 函数，客户端接收到复制状态后执行相应通知。

```cpp
// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameStateBase.h"
#include "Net/UnrealNetwork.h"
#include "ProjectAegisGameState.generated.h"

UENUM(BlueprintType)

enum class EAegisMatchPhase : uint8
{
	Waiting,
	Playing,
	Completed
};

/**
* 保存需要在整局游戏范围内共享的状态。
*/

UCLASS()
class AProjectAegisGameState : public AGameStateBase
{
	GENERATED_BODY()

public:

	/** 注册需要复制给客户端的共享状态。 */
	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

	/** 获取当前比赛阶段。 */
	EAegisMatchPhase GetMatchPhase() const
	{
		return MatchPhase;
	}

	/** 由服务器写入当前比赛阶段。 */
	void SetMatchPhase(EAegisMatchPhase NewMatchPhase);

	int32 GetRemainingSeconds() const
	{
		return RemainingSeconds;
	}

	void SetRemainingSeconds(int32 NewRemainingSeconds);

protected:

	/** 服务器权威写入、客户端接收的比赛阶段。 */
	UPROPERTY(ReplicatedUsing = OnRep_MatchPhase, VisibleAnywhere, BlueprintReadOnly, Category = "Aegis|Match")
	EAegisMatchPhase MatchPhase = EAegisMatchPhase::Waiting;

	/** 客户端收到服务器新值后执行。 */
	UFUNCTION()
	void OnRep_MatchPhase();


	UPROPERTY(ReplicatedUsing = OnRep_RemainingSeconds, VisibleAnywhere, BlueprintReadOnly, Category = "Aegis|Match")
	int32 RemainingSeconds = 0;

	UFUNCTION()
	void OnRep_RemainingSeconds();

};
```

```cpp
// Copyright Epic Games, Inc. All Rights Reserved.

#include "ProjectAegisGameState.h"

#include "AegisCoreLog.h"


void AProjectAegisGameState::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);

	DOREPLIFETIME(AProjectAegisGameState, MatchPhase);
	DOREPLIFETIME(AProjectAegisGameState, RemainingSeconds);
}


void AProjectAegisGameState::SetMatchPhase(EAegisMatchPhase NewMatchPhase)
{
	if (!HasAuthority())
	{
		UE_LOG(
			LogAegisCore,
			Warning,
			TEXT("AProjectAegisGameState::SetMatchPhase ignored on non-authority. Actor=%p"),
			this);
		return;
	}

	if (MatchPhase == NewMatchPhase)
	{
		return;
	}

	MatchPhase = NewMatchPhase;

	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("AProjectAegisGameState MatchPhase Set: Actor=%p MatchPhase=%d"),
		this,
		static_cast<uint8>(MatchPhase));
}

void AProjectAegisGameState::SetRemainingSeconds(int32 NewRemainingSeconds)
{
	if (!HasAuthority())
	{
		UE_LOG(
			LogAegisCore,
			Warning,
			TEXT("AProjectAegisGameState::SetRemainingSeconds ignored on non-authority. Actor=%p"),
			this);
		return;
	}

	if (RemainingSeconds == NewRemainingSeconds)
	{
		return;
	}

	RemainingSeconds = NewRemainingSeconds;

	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("AProjectAegisGameState SetRemainingSeconds Set: Actor=%p RemainingSeconds=%d MatchPhase=%d NetMode=%d"),
		this,
		RemainingSeconds,
		static_cast<uint8>(MatchPhase),
		static_cast<uint8>(GetNetMode()));
}

void AProjectAegisGameState::OnRep_MatchPhase()
{
	const bool bAuthGameModeValid = GetWorld() != nullptr && GetWorld()->GetAuthGameMode() != nullptr;
	const bool bGameStateValid = IsValid(this);
	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("AProjectAegisGameState MatchPhase Replicated: Actor=%p MatchPhase=%d RemainingSeconds=%d NetMode=%d AuthGameModeValid=%s GameStateValid=%s"),
		this,
		static_cast<uint8>(MatchPhase),
		RemainingSeconds,
		static_cast<uint8>(GetNetMode()),
		bAuthGameModeValid ? TEXT("true") : TEXT("false"),
		bGameStateValid ? TEXT("true") : TEXT("false")
	);
}

void AProjectAegisGameState::OnRep_RemainingSeconds()
{
	const bool bAuthGameModeValid = GetWorld() != nullptr && GetWorld()->GetAuthGameMode() != nullptr;
	const bool bGameStateValid = IsValid(this);
	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("AProjectAegisGameState RemainingSeconds Replicated: Actor=%p RemainingSeconds=%d MatchPhase=%d NetMode=%d AuthGameModeValid=%s GameStateValid=%s"),
		this,
		RemainingSeconds,
		static_cast<uint8>(MatchPhase),
		static_cast<uint8>(GetNetMode()),
		bAuthGameModeValid ? TEXT("true") : TEXT("false"),
		bGameStateValid ? TEXT("true") : TEXT("false"));
}
```

### 实验日志

构建之后，打开工程，设置为 2 个玩家，以 `Listen Server` 开启 `PIE`，运行之后的关键日志如下。通过日志可以看到服务器进行倒计时，并推进 `Waiting->Playing->Completed`，服务器 `GameState` 写入阶段和剩余时间，客户端 `GameState` 通过 `RepNotify` 复制获得服务器写入的状态。

```text
[2026.08.12-03.17.32:967][147]LogAegisCore: Display: AProjectAegisGameState SetRemainingSeconds Set: Actor=00000129F70B6E00 RemainingSeconds=3 MatchPhase=0 NetMode=2
[2026.08.12-03.17.32:967][147]LogAegisCore: Display: ProjectAegis GameMode BeginPlay: GameMode=000001297DF45400 GameState=00000129F70B6E00 GameStateClass=ProjectAegisGameState WorldType=PIE NetMode=2 HasAuthority=true MatchPhase=0
[2026.08.12-03.17.33:270][153]LogAegisCore: Display: AProjectAegisGameState RemainingSeconds Replicated: Actor=0000012A0AD0AF00 RemainingSeconds=3 MatchPhase=0 NetMode=3 AuthGameModeValid=false GameStateValid=true
[2026.08.12-03.17.34:085][156]LogAegisCore: Display: AProjectAegisGameMode Waiting Remaining. WaitingSeconds=2
[2026.08.12-03.17.34:085][156]LogAegisCore: Display: AProjectAegisGameState SetRemainingSeconds Set: Actor=00000129F70B6E00 RemainingSeconds=2 MatchPhase=0 NetMode=2
[2026.08.12-03.17.34:087][156]LogAegisCore: Display: AProjectAegisGameState RemainingSeconds Replicated: Actor=0000012A0AD0AF00 RemainingSeconds=2 MatchPhase=0 NetMode=3 AuthGameModeValid=false GameStateValid=true
[2026.08.12-03.17.35:150][164]LogAegisCore: Display: AProjectAegisGameMode Waiting Remaining. WaitingSeconds=1
[2026.08.12-03.17.35:150][164]LogAegisCore: Display: AProjectAegisGameState SetRemainingSeconds Set: Actor=00000129F70B6E00 RemainingSeconds=1 MatchPhase=0 NetMode=2
[2026.08.12-03.17.35:150][164]LogAegisCore: Display: AProjectAegisGameState RemainingSeconds Replicated: Actor=0000012A0AD0AF00 RemainingSeconds=1 MatchPhase=0 NetMode=3 AuthGameModeValid=false GameStateValid=true
[2026.08.12-03.17.36:190][173]LogAegisCore: Display: AProjectAegisGameMode Waiting Remaining. WaitingSeconds=0
[2026.08.12-03.17.36:190][173]LogAegisCore: Display: AProjectAegisGameState SetRemainingSeconds Set: Actor=00000129F70B6E00 RemainingSeconds=0 MatchPhase=0 NetMode=2
[2026.08.12-03.17.36:190][173]LogAegisCore: Display: AProjectAegisGameState MatchPhase Set: Actor=00000129F70B6E00 MatchPhase=1
[2026.08.12-03.17.36:190][173]LogAegisCore: Display: AProjectAegisGameState SetRemainingSeconds Set: Actor=00000129F70B6E00 RemainingSeconds=5 MatchPhase=1 NetMode=2
[2026.08.12-03.17.36:190][173]LogAegisCore: Display: AProjectAegisGameMode Enter Playing
[2026.08.12-03.17.36:302][174]LogAegisCore: Display: AProjectAegisGameState MatchPhase Replicated: Actor=0000012A0AD0AF00 MatchPhase=1 RemainingSeconds=5 NetMode=3 AuthGameModeValid=false GameStateValid=true
[2026.08.12-03.17.36:302][174]LogAegisCore: Display: AProjectAegisGameState RemainingSeconds Replicated: Actor=0000012A0AD0AF00 RemainingSeconds=5 MatchPhase=1 NetMode=3 AuthGameModeValid=false GameStateValid=true
[2026.08.12-03.17.37:077][194]LogAegisCore: Display: AProjectAegisGameState SetRemainingSeconds Set: Actor=00000129F70B6E00 RemainingSeconds=4 MatchPhase=1 NetMode=2
[2026.08.12-03.17.37:077][194]LogAegisCore: Display: AProjectAegisGameMode Playing Remaining Time. PlayingSeconds=4
[2026.08.12-03.17.37:103][195]LogAegisCore: Display: AProjectAegisGameState RemainingSeconds Replicated: Actor=0000012A0AD0AF00 RemainingSeconds=4 MatchPhase=1 NetMode=3 AuthGameModeValid=false GameStateValid=true
[2026.08.12-03.17.38:078][232]LogAegisCore: Display: AProjectAegisGameState SetRemainingSeconds Set: Actor=00000129F70B6E00 RemainingSeconds=3 MatchPhase=1 NetMode=2
[2026.08.12-03.17.38:078][232]LogAegisCore: Display: AProjectAegisGameMode Playing Remaining Time. PlayingSeconds=3
[2026.08.12-03.17.38:103][233]LogAegisCore: Display: AProjectAegisGameState RemainingSeconds Replicated: Actor=0000012A0AD0AF00 RemainingSeconds=3 MatchPhase=1 NetMode=3 AuthGameModeValid=false GameStateValid=true
[2026.08.12-03.17.39:165][238]LogAegisCore: Display: AProjectAegisGameState SetRemainingSeconds Set: Actor=00000129F70B6E00 RemainingSeconds=2 MatchPhase=1 NetMode=2
[2026.08.12-03.17.39:166][238]LogAegisCore: Display: AProjectAegisGameMode Playing Remaining Time. PlayingSeconds=2
[2026.08.12-03.17.39:166][238]LogAegisCore: Display: AProjectAegisGameState RemainingSeconds Replicated: Actor=0000012A0AD0AF00 RemainingSeconds=2 MatchPhase=1 NetMode=3 AuthGameModeValid=false GameStateValid=true
[2026.08.12-03.17.40:492][268]LogAegisCore: Display: AProjectAegisGameState SetRemainingSeconds Set: Actor=00000129F70B6E00 RemainingSeconds=1 MatchPhase=1 NetMode=2
[2026.08.12-03.17.40:492][268]LogAegisCore: Display: AProjectAegisGameMode Playing Remaining Time. PlayingSeconds=1
[2026.08.12-03.17.40:492][268]LogAegisCore: Display: AProjectAegisGameState RemainingSeconds Replicated: Actor=0000012A0AD0AF00 RemainingSeconds=1 MatchPhase=1 NetMode=3 AuthGameModeValid=false GameStateValid=true
[2026.08.12-03.17.41:503][306]LogAegisCore: Display: AProjectAegisGameState SetRemainingSeconds Set: Actor=00000129F70B6E00 RemainingSeconds=0 MatchPhase=1 NetMode=2
[2026.08.12-03.17.41:503][306]LogAegisCore: Display: AProjectAegisGameMode Playing Remaining Time. PlayingSeconds=0
[2026.08.12-03.17.41:503][306]LogAegisCore: Display: AProjectAegisGameState MatchPhase Set: Actor=00000129F70B6E00 MatchPhase=2
[2026.08.12-03.17.41:503][306]LogAegisCore: Display: AProjectAegisGameMode Enter Completed
[2026.08.12-03.17.41:605][310]LogAegisCore: Display: AProjectAegisGameState MatchPhase Replicated: Actor=0000012A0AD0AF00 MatchPhase=2 RemainingSeconds=0 NetMode=3 AuthGameModeValid=false GameStateValid=true
[2026.08.12-03.17.41:605][310]LogAegisCore: Display: AProjectAegisGameState RemainingSeconds Replicated: Actor=0000012A0AD0AF00 RemainingSeconds=0 MatchPhase=2 NetMode=3 AuthGameModeValid=false GameStateValid=true
[2026.08.12-03.17.59:337][995]LogAegisCore: Display: GameMode EndPlay. Reason=EEndPlayReason::EndPlayInEditor TimerWasActive=false TimerActiveAfterClear=false TimerHandleValidAfterClear=false
```

## 验证或作品证据

<video controls playsinline preload="metadata" aria-label="GameMode 与 GameState 的权威边界" style="display: block; width: 100%; border-radius: 12px;">
  <source src="/media/ue/day10/day10-gamemode-gamestate.mp4" type="video/mp4" />
  当前浏览器不支持视频播放，
  <a href="/media/ue/day10/day10-gamemode-gamestate.mp4">请打开视频文件</a>。
</video>

本视频展示服务器驱动训练阶段与倒计时，并由客户端通过 `GameState` 获取复制后的共享状态。

## 问题与复盘

### 服务器倒计时没有形成客户端观察闭环

- 问题描述：初版只是在服务器端的 `GameMode` 中实现私有倒计时，`GameState` 尚未完整保存并复制剩余秒数，客户端观察链路不完整。
- 问题原因：服务器规则虽然可以独立运行，但客户端不存在权威 `GameMode`，无法直接获得用于 `UI` 展示的阶段和倒计时。
- 解决办法：让 `GameMode` 只负责阶段规则和 `Timer`，把客户端需要观察的 `MatchPhase`、`RemainingSeconds` 写入 `GameState`；补齐了复制注册和 `RepNotify`；在 `Completed` 阶段与 `EndPlay` 清理 `Timer`。
- 解决证据：在双人 `Listen Server` 中，服务器以 `NetMode=2` 推进倒计时；客户端以 `NetMode=3` 收到状态，并显示 `AuthGameModeValid=false GameStateValid=true`；`Completed` 后不再继续计时。

## 我的理解

- 设计网络 `Gameplay` 功能时，不能只确认服务器规则能运行，还要从客户端观察反推共享数据应该落在哪里。如果客户端需要观察或者使用整局共享状态，就需要由服务器将对应数据写入 `GameState` 并复制给客户端。
- 判断数据是否应该进入 `GameState`，关键不在于它是否“权威”，而是客户端是否需要观察，以及它是否属于整局共享状态。
- `GameMode` 与 `GameState` 的分离，本质上是把“谁决定规则”和“谁需要看到结果”分开。

## 下一步

按计划学习 `PlayerController` 与 `PlayerState`。
