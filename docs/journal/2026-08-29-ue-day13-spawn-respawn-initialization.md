---
title: "UE Day 13：Spawn、重生与可重入初始化"
description: "通过服务器权威延迟重生实验，理解 Deferred Spawn、Possession、玩家状态保留与客户端可重入初始化。"
date: 2026-08-29
domain: ue
type: journal
series: ue-client-roadmap
tags:
  - Unreal Engine 5
  - C++
  - Project Aegis
  - Spawn
  - Respawn
  - PlayerController
  - GameMode
  - PlayerState
  - Replication
status: published
outline: deep
---

# Spawn、重生与可重入初始化

## 背景与目标

### 背景

在 `UE` 中 `SpawnActor` 和 `SpawnActorDeferred` 流程不一样，为了厘清二者的差别，方便在后续复杂的生产项目中正确应用，所以通过重生实验学习。

### 目标

通过服务器权威延迟重生实验，理解 `SpawnActorDeferred` 的完整流程，以及其和 `SpawnActor` 的差异。

## 关键概念

### SpawnActor() 与 SpawnActorDeferred()

普通 `SpawnActor()` 在生成成功后，会在返回前继续完成 `Construction`、组件初始化；如果当前 `World` 已经开始 `Gameplay`，还可能在返回前进入 `BeginPlay()`。而 `SpawnActorDeferred()` 返回的是已经分配，但尚未完成 `Construction`、组件初始化和 `Gameplay` 初始化的 `Actor`。
在使用 `SpawnActorDeferred()` 时，如果要向新生成的 `Actor` 写入初始数据，应该在 `Deferred Spawn` 成功后、`FinishSpawning()` 前写入，如果在 `FinishSpawning()` 之后才写，那么 `Construction`、组件初始化或 `BeginPlay()` 可能已经执行，初始数据无法被首次初始化逻辑看到。
使用 `SpawnActorDeferred()` 生成新 `Actor` 时，不能遗漏 `FinishSpawning()`，否则 `Actor` 会停留在未完成生成的状态。需要注意的是 `C++` 构造函数在 `Deferred Spawn` 返回前已经执行，`Deferred` 延迟的不是原生构造函数。

### 服务器权威重生与 RestartPlayer()

`RestartPlayer()` 由服务器权威 `GameMode` 调用，客户端不能自行决定权威重生结果，客户端可以通过本地 `PlayerController` 的 `Server RPC` 发起重生请求，但不能直接调用权威 `GameMode` 的 `RestartPlayer()` 决定重生结果。在权威延迟重生实验中，`GameMode` 负责验证请求、管理延迟并调用 `RestartPlayer()`。`RestartPlayer()` 负责生成默认 `Pawn`、建立 `Controller` 与新 `Pawn` 的控制关系。客户端通过网络复制、`ClientRestart()` 和相关 `OnRep` 入口观察结果并恢复本地状态。远程客户端只会为自己本地控制的 `Pawn` 建立本地输入；其他玩家复制到该客户端的 `Character` 只是网络观察对象，不会建立本地输入绑定。

### Pawn 重建与玩家状态保留

`Character/Pawn` 是可能死亡、销毁和重新生成的世界实体。`PlayerController` 与 `PlayerState` 的生命周期通常长于单个 `Pawn`，所以比如 `TeamId`、`Score` 等玩家状态应该由 `PlayerState` 保存，不随 `Character` 重生而重置。本地 `Widget` 属于本地 `Controller` 的长期状态，不应因 `Pawn` 重建而重复创建。

### 可重入初始化与复制到达顺序

`BeginPlay()` 只能证明 `Actor` 已进入 `Gameplay` 生命周期，不能证明客户端的 `Controller`、`PlayerState` 和玩家数据已经全部复制到达。`BeginPlay()`、`OnRep_PlayerState()` 和相关数据就绪入口可以共同调用同一个初始化函数。初始化需要允许重复尝试，但相同生成代次只能完成一次，不能重复绑定 `Delegate`、创建 `UI` 或执行 `Gameplay` 初始化。这里的“可重入”表示多个生命周期入口可以反复尝试并收敛到同一结果，不是函数执行过程中并发重入。

### TMap

`TMap::Find()` 只查找已有键，找到时返回对应值的指针，未找到时返回 `nullptr`；`TMap::FindOrAdd()` 先查找，键不存在时插入一个默认构造的值，并返回现有值或新值的引用。

### 服务器权威数据的复制

`UE` 网络复制系统在客户端接收并反序列化服务器数据时，自动把复制值写入客户端对应对象的属性内存。
`DOREPLIFETIME` 在 `GetLifetimeReplicatedProps()` 中把属性注册到该类的复制布局；`ReplicatedUsing` 标记客户端接收该属性的复制更新后应调用的 `RepNotify`。如果只有 `UPROPERTY()`，没有复制声明和生命周期注册的属性，不会自动通过网络复制。服务器直接修改属性时，不应假定对应的 `OnRep` 会自动在服务器执行。

## 实践过程

### 建立服务器权威的延迟重生链路

```cpp
void AProjectAegisPlayerController::HandleRespawnRequested()
{
	if (!IsLocalPlayerController())
	{
		return;
	}

	LogPossessionEvent(TEXT("RespawnInputRequested"), GetPawn(), GetPawn());
	ServerRequestRespawn();
}

void AProjectAegisPlayerController::ServerRequestRespawn_Implementation()
{
	if (!HasAuthority())
	{
		UE_LOG(
			LogProjectAegis,
			Warning,
			TEXT("Event=RespawnRpcRejected Reason=NonAuthority Controller=%p"),
			this
		);
		return;
	}

	UWorld* World = GetWorld();
	if (!IsValid(World) || !World->HasBegunPlay())
	{
		UE_LOG(
			LogProjectAegis,
			Warning,
			TEXT("Event=RespawnRpcRejected Reason=InvalidWorld Controller=%p"),
			this
		);
		return;
	}

	AProjectAegisGameMode* AegisGameMode = World->GetAuthGameMode<AProjectAegisGameMode>();

	if (!IsValid(AegisGameMode))
	{
		UE_LOG(
			LogProjectAegis,
			Warning,
			TEXT("Event=RespawnRpcRejected Reason=InvalidAuthGameMode Controller=%p World=%p NetMode=%d"),
			this,
			World,
			static_cast<uint8>(GetNetMode())
		);
		return;
	}

	LogPossessionEvent(TEXT("RespawnRpcReceived"), GetPawn(), GetPawn());
	AegisGameMode->RequestRespawn(this);
}
```

```cpp
void AProjectAegisGameMode::HandleRespawnTimer(TWeakObjectPtr<AController> WeakController)
{
	UWorld* World = GetWorld();
	FAegisRespawnState* RespawnState = RespawnStates.Find(WeakController);

	if (!IsValid(World) || RespawnState == nullptr)
	{
		if (RespawnState != nullptr)
		{
			RespawnState->TimerHandle.Invalidate();
		}
		return;
	}

	RespawnState->TimerHandle.Invalidate();

	AController* Controller = WeakController.Get();
	if (!IsValid(Controller) ||
		Controller->GetWorld() != World ||
		!HasAuthority() ||
		!World->HasBegunPlay())
	{
		LogRespawnEvent(TEXT("RespawnTimerRejected"), Controller, nullptr, RespawnState->RespawnGeneration);
		RespawnStates.Remove(WeakController);
		return;
	}

	LogRespawnEvent(TEXT("RespawnTimerFired"), Controller, Controller->GetPawn(), RespawnState->RespawnGeneration);

	if (IsValid(Controller->GetPawn()))
	{
		UE_LOG(
			LogAegisCore,
			Warning,
			TEXT("Event=RespawnTimerRejected Reason=ControllerAlreadyHasPawn")
		);
		return;
	}

	++RespawnState->RespawnGeneration;
	const int32 RequestedGeneration = RespawnState->RespawnGeneration;

	RestartPlayer(Controller);

	AProjectAegisCharacter* NewCharacter = Cast<AProjectAegisCharacter>(Controller->GetPawn());

	if (!IsValid(NewCharacter)
		|| NewCharacter->GetController() != Controller)
	{
		LogRespawnEvent(TEXT("RestartPlayerFailed"), Controller, Controller->GetPawn(), RequestedGeneration);
		return;
	}

	LogRespawnEvent(TEXT("RestartPlayerCompleted"), Controller, NewCharacter, RequestedGeneration);

}
```

实际调用链如下所示。

```text
本地按下 R
→ PlayerController::HandleRespawnRequested()
→ ServerRequestRespawn() Server RPC
→ GameMode::RequestRespawn()
→ 销毁旧 Character
→ 为对应 Controller 设置独立 Timer
→ HandleRespawnTimer()
→ RestartPlayer()
```

- 本地客户端 `PlayerController` 只负责接收输入并发送 `Server RPC`。
- 服务器 `PlayerController` 获取权威 `GameMode` 并转交请求。
- `GameMode` 检查 `Authority`、`World`、`Controller`、重复 `Timer`、`Observer Pawn` 和意外 `Pawn` 类型。
- 使用以弱 `Controller` 为键的 `TMap` 保存每名玩家自己的 `Timer` 与 `RespawnGeneration`，避免多个玩家共用一个 `Timer`。
- `Timer` 触发时再次验证 `Controller` 和 `World`；确认 `Controller` 仍没有 `Pawn` 后递增生成代次并调用 `RestartPlayer()`。

### 使用 Deferred Spawn 写入生成代次

```cpp
AProjectAegisCharacter* DeferredCharacter =
	World->SpawnActorDeferred<AProjectAegisCharacter>(
		PawnClass,
		SpawnTransform,
		nullptr,
		GetInstigator(),
		ESpawnActorCollisionHandlingMethod::Undefined);

if (!IsValid(DeferredCharacter))
{
	return nullptr;
}

DeferredCharacter->SetFlags(RF_Transient);
DeferredCharacter->SetRespawnGeneration(RespawnState.RespawnGeneration);
DeferredCharacter->FinishSpawning(SpawnTransform);
```

- `AProjectAegisGameMode` 重写的是 `SpawnDefaultPawnAtTransform_Implementation()`，因此 `RestartPlayer()` 仍使用引擎既有的默认 `Pawn` 生成和 `Possession` 流程。
- `RespawnGeneration` 在 `Deferred Spawn` 成功后、`FinishSpawning()` 前写入。
- `FinishSpawning()` 后再次检查 `Actor` 是否有效或正在销毁，失败时返回 `nullptr`。
- `RestartPlayer()` 后还要确认新 `Character` 有效，且其 `Controller` 确实是请求重生的 `Controller`。

### Character 的可重入初始化

定义了 `Character` 初始化阶段的枚举。

```cpp
UENUM()
enum class EAegisCharacterInitializationState : uint8
{
	Spawned,
	SpawnDataAvailable,
	PlayerDataAvailable,
	GameplayReady
};
```

```cpp
void AProjectAegisCharacter::TryInitializeGameplay(const TCHAR* EntryPoint)
{
	if (RespawnGeneration == INDEX_NONE)
	{
		return;
	}

	if (InitializationState == EAegisCharacterInitializationState::Spawned)
	{
		SetInitializationState(EAegisCharacterInitializationState::SpawnDataAvailable);
	}


	if (!HasActorBegunPlay())
	{
		return;
	}

	AProjectAegisPlayerState* CurrentState = GetPlayerState<AProjectAegisPlayerState>();
	if (!IsValid(CurrentState))
	{
		return;
	}

	RefreshPlayerStateBindings();

	if (!CurrentState->IsPlayerDataReady())
	{
		return;
	}

	if (InitializedGeneration == RespawnGeneration
		&& InitializedPlayerState.Get() == CurrentState)
	{
		SetInitializationState(EAegisCharacterInitializationState::GameplayReady);
		return;
	}

	SetInitializationState(EAegisCharacterInitializationState::PlayerDataAvailable);
	InitializedGeneration = RespawnGeneration;
	InitializedPlayerState = CurrentState;
	++GameplayInitializationCount;
	SetInitializationState(EAegisCharacterInitializationState::GameplayReady);

	LogInitializationEvent(TEXT("GameplayInitialized"), EntryPoint);
}
```

- `Character` 的 `PossessedBy()`、`OnRep_Controller()`、`BeginPlay()`、`OnRep_PlayerState()`、`OnRep_RespawnGeneration()`、`OnPlayerStateChanged()`、 `HandlePlayerStatePawnSet()`、`HandlePlayerDataReady()` 都会尝试调用 `TryInitializeGameplay()`。

```cpp
void AProjectAegisCharacter::RefreshPlayerStateBindings()
{
	AProjectAegisPlayerState* Current = GetPlayerState<AProjectAegisPlayerState>();

	if (BoundPlayerState.Get() == Current)
	{
		return;
	}

	ClearPlayerStateBindings();

	if (!IsValid(Current))
	{
		return;
	}

	BoundPlayerState = Current;

	PlayerDataReadyDelegateHandle = Current->OnPlayerDataReady().AddUObject(this, &AProjectAegisCharacter::HandlePlayerDataReady);
	Current->OnPawnSet.AddUniqueDynamic(this, &AProjectAegisCharacter::HandlePlayerStatePawnSet);

	++PlayerStateDelegateBindCount;
	LogInitializationEvent(TEXT("PlayerStateDelegatesBound"), TEXT("RefreshBindings"));
}
```

- `RefreshPlayerStateBindings()` 发现绑定对象变化时，先解除旧绑定，再绑定新 `PlayerState`。
- `EndPlay()` 也会调用 `ClearPlayerStateBindings()`。

编译之后，通过编辑器建立 `R` 键和 `PlayerController` 的 `RespawnAction` 映射，然后开始两人的 `Listen Server PIE`，并按 `R` 键，得到的日志如下。

```text
[2026.08.29-07.50.34:364][764]LogProjectAegis: Display: Possession Event=RespawnInputRequested World=0000017F152EB600 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=0000017EA1EA1400 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=256 Authority=true Local=true OldPawn=0000017EA340C800 OldPawnName=BP_ThirdPersonCharacter_C_0 NewPawn=0000017EA340C800 NewPawnName=BP_ThirdPersonCharacter_C_0 ControlRotation=R(P=0.52, Y=359.30) ViewTarget=0000017EA340C800 ViewTargetName=BP_ThirdPersonCharacter_C_0 PlayerStateWidget=0000017EB55A4200
[2026.08.29-07.50.34:364][764]LogProjectAegis: Display: Possession Event=RespawnRpcReceived World=0000017F152EB600 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=0000017EA1EA1400 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=256 Authority=true Local=true OldPawn=0000017EA340C800 OldPawnName=BP_ThirdPersonCharacter_C_0 NewPawn=0000017EA340C800 NewPawnName=BP_ThirdPersonCharacter_C_0 ControlRotation=R(P=0.52, Y=359.30) ViewTarget=0000017EA340C800 ViewTargetName=BP_ThirdPersonCharacter_C_0 PlayerStateWidget=0000017EB55A4200
[2026.08.29-07.50.34:364][764]LogAegisCore: Display: Event=RespawnRequested World=0000017F152EB600 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 HasBegunPlay=true GameMode=0000017EB55A6C00 Controller=0000017EA1EA1400 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=256 Authority=true Local=true CurrentPawn=0000017EA340C800 CurrentPawnName=BP_ThirdPersonCharacter_C_0 CurrentPawnClass=BP_ThirdPersonCharacter_C CurrentPawnPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_0 SubjectPawn=0000017EA340C800 SubjectPawnName=BP_ThirdPersonCharacter_C_0 SubjectPawnClass=BP_ThirdPersonCharacter_C SubjectPawnPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_0 PlayerState=0000017EB55A7E00 TeamId=0 Score=356.0 PlayerDataReady=true RespawnGeneration=0 TimerHandleValid=false TimerActive=false ControlRotation=R(P=0.52, Y=359.30) ViewTarget=0000017EA340C800 ViewTargetName=BP_ThirdPersonCharacter_C_0
[2026.08.29-07.50.34:364][764]LogAegisCore: Display: Event=CharacterDestroyRequested World=0000017F152EB600 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 HasBegunPlay=true GameMode=0000017EB55A6C00 Controller=0000017EA1EA1400 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=256 Authority=true Local=true CurrentPawn=0000017EA340C800 CurrentPawnName=BP_ThirdPersonCharacter_C_0 CurrentPawnClass=BP_ThirdPersonCharacter_C CurrentPawnPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_0 SubjectPawn=0000017EA340C800 SubjectPawnName=BP_ThirdPersonCharacter_C_0 SubjectPawnClass=BP_ThirdPersonCharacter_C SubjectPawnPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_0 PlayerState=0000017EB55A7E00 TeamId=0 Score=356.0 PlayerDataReady=true RespawnGeneration=0 TimerHandleValid=false TimerActive=false ControlRotation=R(P=0.52, Y=359.30) ViewTarget=0000017EA340C800 ViewTargetName=BP_ThirdPersonCharacter_C_0
[2026.08.29-07.50.34:364][764]LogProjectAegis: Display: Event=PlayerStatePawnSet. Character=0000017EA340C800 Generation=0 PlayerState=0000017EB55A7E00 NewPawn=0000000000000000 OldPawn=0000017EA340C800 BindCount=1 UnbindCount=0
[2026.08.29-07.50.34:364][764]LogProjectAegis: Display: Event=InitializationStateChanged. Character=0000017EA340C800 RespawnGeneration=0 OldState=3 NewState=1
[2026.08.29-07.50.34:364][764]LogProjectAegis: Display: Event=PlayerStateDelegatesUnbound EntryPoint=ClearBindings World=0000017F152EB600 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Character=0000017EA340C800 CharacterName=BP_ThirdPersonCharacter_C_0 CharacterPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_0 RespawnGeneration=0 InitializationState=1 InitializedGeneration=-1 CurrentController=0000017EA1EA1400 CurrentControllerName=BP_ThirdPersonPlayerController_C_0 HasAuthority=true IsLocallyController=true AegisPlayerState=0000000000000000 PlayerId=-1 TeamId=-1 Score=0.0 IsPlayerDataReady=false BoundPlayerState=0000000000000000 InitializedPlayerState=0000000000000000 PlayerDataReadyDelegateHandleIsValid=false PlayerStateDelegateBindCount=1 PlayerStateDelegateUnbindCount=1 GameplayInitializationCount=1 SetupPlayerInputCount=1 InputComponent=0000017EB40D4EC0 ViewTarget=0000017EA340C800 FollowCamera=0000017E9B50C000
[2026.08.29-07.50.34:364][764]LogProjectAegis: Display: Character UnPossessed. Character=0000017EA340C800 CharacterName=BP_ThirdPersonCharacter_C_0 OldController=0000017EA1EA1400 OldControllerName=BP_ThirdPersonPlayerController_C_0 CurrentController=0000000000000000
[2026.08.29-07.50.34:364][764]LogProjectAegis: Display: Possession Event=OnUnPossess World=0000017F152EB600 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=0000017EA1EA1400 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=256 Authority=true Local=true OldPawn=0000017EA340C800 OldPawnName=BP_ThirdPersonCharacter_C_0 NewPawn=0000000000000000 NewPawnName=None ControlRotation=R(P=0.52, Y=359.30) ViewTarget=0000017EA1EA1400 ViewTargetName=BP_ThirdPersonPlayerController_C_0 PlayerStateWidget=0000017EB55A4200
[2026.08.29-07.50.34:364][764]LogProjectAegis: Display: Event=EndPlay EntryPoint=EndPlay World=0000017F152EB600 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Character=0000017EA340C800 CharacterName=BP_ThirdPersonCharacter_C_0 CharacterPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_0 RespawnGeneration=0 InitializationState=1 InitializedGeneration=-1 CurrentController=0000000000000000 CurrentControllerName=None HasAuthority=true IsLocallyController=false AegisPlayerState=0000000000000000 PlayerId=-1 TeamId=-1 Score=0.0 IsPlayerDataReady=false BoundPlayerState=0000000000000000 InitializedPlayerState=0000000000000000 PlayerDataReadyDelegateHandleIsValid=false PlayerStateDelegateBindCount=1 PlayerStateDelegateUnbindCount=1 GameplayInitializationCount=1 SetupPlayerInputCount=1 InputComponent=0000000000000000 ViewTarget=0000000000000000 FollowCamera=0000017E9B50C000
[2026.08.29-07.50.34:367][764]LogAegisCore: Display: Event=RespawnTimerScheduled World=0000017F152EB600 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 HasBegunPlay=true GameMode=0000017EB55A6C00 Controller=0000017EA1EA1400 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=256 Authority=true Local=true CurrentPawn=0000000000000000 CurrentPawnName=None CurrentPawnClass=None CurrentPawnPath=None SubjectPawn=0000000000000000 SubjectPawnName=None SubjectPawnClass=None SubjectPawnPath=None PlayerState=0000017EB55A7E00 TeamId=0 Score=356.0 PlayerDataReady=true RespawnGeneration=0 TimerHandleValid=true TimerActive=true ControlRotation=R(P=0.52, Y=359.30) ViewTarget=0000017EA1EA1400 ViewTargetName=BP_ThirdPersonPlayerController_C_0
[2026.08.29-07.50.34:369][764]LogProjectAegis: Display: Event=PlayerStateDelegatesUnbound EntryPoint=ClearBindings World=0000017F1BD77000 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=3 Character=0000017E8F8D3200 CharacterName=BP_ThirdPersonCharacter_C_1 CharacterPath=/Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_1 RespawnGeneration=0 InitializationState=3 InitializedGeneration=0 CurrentController=0000000000000000 CurrentControllerName=None HasAuthority=false IsLocallyController=false AegisPlayerState=0000017F196EEA00 PlayerId=256 TeamId=0 Score=356.0 IsPlayerDataReady=true BoundPlayerState=0000000000000000 InitializedPlayerState=0000017F196EEA00 PlayerDataReadyDelegateHandleIsValid=false PlayerStateDelegateBindCount=1 PlayerStateDelegateUnbindCount=1 GameplayInitializationCount=1 SetupPlayerInputCount=0 InputComponent=0000000000000000 ViewTarget=0000000000000000 FollowCamera=0000017E9DF33000
[2026.08.29-07.50.34:369][764]LogProjectAegis: Display: Event=EndPlay EntryPoint=EndPlay World=0000017F1BD77000 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=3 Character=0000017E8F8D3200 CharacterName=BP_ThirdPersonCharacter_C_1 CharacterPath=/Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_1 RespawnGeneration=0 InitializationState=3 InitializedGeneration=0 CurrentController=0000000000000000 CurrentControllerName=None HasAuthority=false IsLocallyController=false AegisPlayerState=0000017F196EEA00 PlayerId=256 TeamId=0 Score=356.0 IsPlayerDataReady=true BoundPlayerState=0000000000000000 InitializedPlayerState=0000017F196EEA00 PlayerDataReadyDelegateHandleIsValid=false PlayerStateDelegateBindCount=1 PlayerStateDelegateUnbindCount=1 GameplayInitializationCount=1 SetupPlayerInputCount=0 InputComponent=0000000000000000 ViewTarget=0000000000000000 FollowCamera=0000017E9DF33000
[2026.08.29-07.50.36:384][838]LogAegisCore: Display: Event=RespawnTimerFired World=0000017F152EB600 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 HasBegunPlay=true GameMode=0000017EB55A6C00 Controller=0000017EA1EA1400 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=256 Authority=true Local=true CurrentPawn=0000000000000000 CurrentPawnName=None CurrentPawnClass=None CurrentPawnPath=None SubjectPawn=0000000000000000 SubjectPawnName=None SubjectPawnClass=None SubjectPawnPath=None PlayerState=0000017EB55A7E00 TeamId=0 Score=356.0 PlayerDataReady=true RespawnGeneration=0 TimerHandleValid=false TimerActive=false ControlRotation=R(P=0.52, Y=359.30) ViewTarget=0000017EA1EA1400 ViewTargetName=BP_ThirdPersonPlayerController_C_0
[2026.08.29-07.50.36:387][838]LogAegisCore: Display: Event=DeferredSpawnCreated World=0000017F152EB600 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 HasBegunPlay=true GameMode=0000017EB55A6C00 Controller=0000017EA1EA1400 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=256 Authority=true Local=true CurrentPawn=0000000000000000 CurrentPawnName=None CurrentPawnClass=None CurrentPawnPath=None SubjectPawn=0000017F120B2800 SubjectPawnName=BP_ThirdPersonCharacter_C_2 SubjectPawnClass=BP_ThirdPersonCharacter_C SubjectPawnPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_2 PlayerState=0000017EB55A7E00 TeamId=0 Score=356.0 PlayerDataReady=true RespawnGeneration=1 TimerHandleValid=false TimerActive=false ControlRotation=R(P=0.52, Y=359.30) ViewTarget=0000017EA1EA1400 ViewTargetName=BP_ThirdPersonPlayerController_C_0
[2026.08.29-07.50.36:387][838]LogProjectAegis: Display: Event=InitializationStateChanged. Character=0000017F120B2800 RespawnGeneration=1 OldState=0 NewState=1
[2026.08.29-07.50.36:387][838]LogProjectAegis: Display: Event=SpawnDataAssigned EntryPoint=DeferredSpawn World=0000017F152EB600 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Character=0000017F120B2800 CharacterName=BP_ThirdPersonCharacter_C_2 CharacterPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_2 RespawnGeneration=1 InitializationState=1 InitializedGeneration=-1 CurrentController=0000000000000000 CurrentControllerName=None HasAuthority=true IsLocallyController=false AegisPlayerState=0000000000000000 PlayerId=-1 TeamId=-1 Score=0.0 IsPlayerDataReady=false BoundPlayerState=0000000000000000 InitializedPlayerState=0000000000000000 PlayerDataReadyDelegateHandleIsValid=false PlayerStateDelegateBindCount=0 PlayerStateDelegateUnbindCount=0 GameplayInitializationCount=0 SetupPlayerInputCount=0 InputComponent=0000000000000000 ViewTarget=0000000000000000 FollowCamera=0000017F15E99C00
[2026.08.29-07.50.36:387][838]LogAegisCore: Display: Event=SpawnDataAssigned World=0000017F152EB600 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 HasBegunPlay=true GameMode=0000017EB55A6C00 Controller=0000017EA1EA1400 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=256 Authority=true Local=true CurrentPawn=0000000000000000 CurrentPawnName=None CurrentPawnClass=None CurrentPawnPath=None SubjectPawn=0000017F120B2800 SubjectPawnName=BP_ThirdPersonCharacter_C_2 SubjectPawnClass=BP_ThirdPersonCharacter_C SubjectPawnPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_2 PlayerState=0000017EB55A7E00 TeamId=0 Score=356.0 PlayerDataReady=true RespawnGeneration=1 TimerHandleValid=false TimerActive=false ControlRotation=R(P=0.52, Y=359.30) ViewTarget=0000017EA1EA1400 ViewTargetName=BP_ThirdPersonPlayerController_C_0
[2026.08.29-07.50.36:387][838]LogProjectAegis: Display: Event=BeginPlay EntryPoint=BeginPlay World=0000017F152EB600 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Character=0000017F120B2800 CharacterName=BP_ThirdPersonCharacter_C_2 CharacterPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_2 RespawnGeneration=1 InitializationState=1 InitializedGeneration=-1 CurrentController=0000000000000000 CurrentControllerName=None HasAuthority=true IsLocallyController=false AegisPlayerState=0000000000000000 PlayerId=-1 TeamId=-1 Score=0.0 IsPlayerDataReady=false BoundPlayerState=0000000000000000 InitializedPlayerState=0000000000000000 PlayerDataReadyDelegateHandleIsValid=false PlayerStateDelegateBindCount=0 PlayerStateDelegateUnbindCount=0 GameplayInitializationCount=0 SetupPlayerInputCount=0 InputComponent=0000000000000000 ViewTarget=0000000000000000 FollowCamera=0000017F15E99C00
[2026.08.29-07.50.36:387][838]LogAegisCore: Display: Event=FinishSpawningCompleted World=0000017F152EB600 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 HasBegunPlay=true GameMode=0000017EB55A6C00 Controller=0000017EA1EA1400 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=256 Authority=true Local=true CurrentPawn=0000000000000000 CurrentPawnName=None CurrentPawnClass=None CurrentPawnPath=None SubjectPawn=0000017F120B2800 SubjectPawnName=BP_ThirdPersonCharacter_C_2 SubjectPawnClass=BP_ThirdPersonCharacter_C SubjectPawnPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_2 PlayerState=0000017EB55A7E00 TeamId=0 Score=356.0 PlayerDataReady=true RespawnGeneration=1 TimerHandleValid=false TimerActive=false ControlRotation=R(P=0.52, Y=359.30) ViewTarget=0000017EA1EA1400 ViewTargetName=BP_ThirdPersonPlayerController_C_0
[2026.08.29-07.50.36:387][838]LogProjectAegis: Display: Event=PlayerStateDelegatesBound EntryPoint=RefreshBindings World=0000017F152EB600 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Character=0000017F120B2800 CharacterName=BP_ThirdPersonCharacter_C_2 CharacterPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_2 RespawnGeneration=1 InitializationState=1 InitializedGeneration=-1 CurrentController=0000017EA1EA1400 CurrentControllerName=BP_ThirdPersonPlayerController_C_0 HasAuthority=true IsLocallyController=true AegisPlayerState=0000017EB55A7E00 PlayerId=256 TeamId=0 Score=356.0 IsPlayerDataReady=true BoundPlayerState=0000017EB55A7E00 InitializedPlayerState=0000000000000000 PlayerDataReadyDelegateHandleIsValid=true PlayerStateDelegateBindCount=1 PlayerStateDelegateUnbindCount=0 GameplayInitializationCount=0 SetupPlayerInputCount=0 InputComponent=0000000000000000 ViewTarget=0000017EA1EA1400 FollowCamera=0000017F15E99C00
[2026.08.29-07.50.36:387][838]LogProjectAegis: Display: Event=InitializationStateChanged. Character=0000017F120B2800 RespawnGeneration=1 OldState=1 NewState=2
[2026.08.29-07.50.36:387][838]LogProjectAegis: Display: Event=InitializationStateChanged. Character=0000017F120B2800 RespawnGeneration=1 OldState=2 NewState=3
[2026.08.29-07.50.36:387][838]LogProjectAegis: Display: Event=GameplayInitialized EntryPoint=OnPlayerStateChanged World=0000017F152EB600 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Character=0000017F120B2800 CharacterName=BP_ThirdPersonCharacter_C_2 CharacterPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_2 RespawnGeneration=1 InitializationState=3 InitializedGeneration=1 CurrentController=0000017EA1EA1400 CurrentControllerName=BP_ThirdPersonPlayerController_C_0 HasAuthority=true IsLocallyController=true AegisPlayerState=0000017EB55A7E00 PlayerId=256 TeamId=0 Score=356.0 IsPlayerDataReady=true BoundPlayerState=0000017EB55A7E00 InitializedPlayerState=0000017EB55A7E00 PlayerDataReadyDelegateHandleIsValid=true PlayerStateDelegateBindCount=1 PlayerStateDelegateUnbindCount=0 GameplayInitializationCount=1 SetupPlayerInputCount=0 InputComponent=0000000000000000 ViewTarget=0000017EA1EA1400 FollowCamera=0000017F15E99C00
[2026.08.29-07.50.36:387][838]LogProjectAegis: Display: Character PossessedBy. Character=0000017F120B2800 NewController=0000017EA1EA1400
[2026.08.29-07.50.36:387][838]LogProjectAegis: Display: Character SetupPlayerInputComponent. Character=0000017F120B2800 RespawnGeneration=1 InitializationState=3 InputComponent=0000017F15342A00 SetupPlayerInputCount=1 Controller=0000017EA1EA1400 NetMode=2 Authority=true IsLocal=true
[2026.08.29-07.50.36:387][838]LogProjectAegis: Display: Character PawnClientRestart. Character=0000017F120B2800 InputComponent=0000017F15342A00
[2026.08.29-07.50.36:388][838]LogProjectAegis: Display: Possession Event=OnPossess World=0000017F152EB600 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=0000017EA1EA1400 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=256 Authority=true Local=true OldPawn=0000017F120B2800 OldPawnName=BP_ThirdPersonCharacter_C_2 NewPawn=0000017F120B2800 NewPawnName=BP_ThirdPersonCharacter_C_2 ControlRotation=R(0) ViewTarget=0000017F120B2800 ViewTargetName=BP_ThirdPersonCharacter_C_2 PlayerStateWidget=0000017EB55A4200
[2026.08.29-07.50.36:388][838]LogAegisCore: Display: Event=RestartPlayerCompleted World=0000017F152EB600 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 HasBegunPlay=true GameMode=0000017EB55A6C00 Controller=0000017EA1EA1400 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=256 Authority=true Local=true CurrentPawn=0000017F120B2800 CurrentPawnName=BP_ThirdPersonCharacter_C_2 CurrentPawnClass=BP_ThirdPersonCharacter_C CurrentPawnPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_2 SubjectPawn=0000017F120B2800 SubjectPawnName=BP_ThirdPersonCharacter_C_2 SubjectPawnClass=BP_ThirdPersonCharacter_C SubjectPawnPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_2 PlayerState=0000017EB55A7E00 TeamId=0 Score=356.0 PlayerDataReady=true RespawnGeneration=1 TimerHandleValid=false TimerActive=false ControlRotation=R(0) ViewTarget=0000017F120B2800 ViewTargetName=BP_ThirdPersonCharacter_C_2
[2026.08.29-07.50.36:391][838]LogProjectAegis: Display: Event=PlayerStateDelegatesBound EntryPoint=RefreshBindings World=0000017F1BD77000 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=3 Character=0000017F12C43200 CharacterName=BP_ThirdPersonCharacter_C_2 CharacterPath=/Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_2 RespawnGeneration=1 InitializationState=0 InitializedGeneration=-1 CurrentController=0000000000000000 CurrentControllerName=None HasAuthority=false IsLocallyController=false AegisPlayerState=0000017F196EEA00 PlayerId=256 TeamId=0 Score=356.0 IsPlayerDataReady=true BoundPlayerState=0000017F196EEA00 InitializedPlayerState=0000000000000000 PlayerDataReadyDelegateHandleIsValid=true PlayerStateDelegateBindCount=1 PlayerStateDelegateUnbindCount=0 GameplayInitializationCount=0 SetupPlayerInputCount=0 InputComponent=0000000000000000 ViewTarget=0000000000000000 FollowCamera=0000017F15E93C00
[2026.08.29-07.50.36:392][838]LogProjectAegis: Display: Event=InitializationStateChanged. Character=0000017F12C43200 RespawnGeneration=1 OldState=0 NewState=1
[2026.08.29-07.50.36:392][838]LogProjectAegis: Display: Event=PlayerStateReplicated EntryPoint=OnRep_PlayerState World=0000017F1BD77000 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=3 Character=0000017F12C43200 CharacterName=BP_ThirdPersonCharacter_C_2 CharacterPath=/Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_2 RespawnGeneration=1 InitializationState=1 InitializedGeneration=-1 CurrentController=0000000000000000 CurrentControllerName=None HasAuthority=false IsLocallyController=false AegisPlayerState=0000017F196EEA00 PlayerId=256 TeamId=0 Score=356.0 IsPlayerDataReady=true BoundPlayerState=0000017F196EEA00 InitializedPlayerState=0000000000000000 PlayerDataReadyDelegateHandleIsValid=true PlayerStateDelegateBindCount=1 PlayerStateDelegateUnbindCount=0 GameplayInitializationCount=0 SetupPlayerInputCount=0 InputComponent=0000000000000000 ViewTarget=0000000000000000 FollowCamera=0000017F15E93C00
[2026.08.29-07.50.36:392][838]LogProjectAegis: Display: Event=SpawnDataReplicated EntryPoint=OnRep_RespawnGeneration World=0000017F1BD77000 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=3 Character=0000017F12C43200 CharacterName=BP_ThirdPersonCharacter_C_2 CharacterPath=/Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_2 RespawnGeneration=1 InitializationState=1 InitializedGeneration=-1 CurrentController=0000000000000000 CurrentControllerName=None HasAuthority=false IsLocallyController=false AegisPlayerState=0000017F196EEA00 PlayerId=256 TeamId=0 Score=356.0 IsPlayerDataReady=true BoundPlayerState=0000017F196EEA00 InitializedPlayerState=0000000000000000 PlayerDataReadyDelegateHandleIsValid=true PlayerStateDelegateBindCount=1 PlayerStateDelegateUnbindCount=0 GameplayInitializationCount=0 SetupPlayerInputCount=0 InputComponent=0000000000000000 ViewTarget=0000000000000000 FollowCamera=0000017F15E93C00
[2026.08.29-07.50.36:392][838]LogProjectAegis: Display: Event=InitializationStateChanged. Character=0000017F12C43200 RespawnGeneration=1 OldState=1 NewState=2
[2026.08.29-07.50.36:392][838]LogProjectAegis: Display: Event=InitializationStateChanged. Character=0000017F12C43200 RespawnGeneration=1 OldState=2 NewState=3
[2026.08.29-07.50.36:392][838]LogProjectAegis: Display: Event=GameplayInitialized EntryPoint=BeginPlay World=0000017F1BD77000 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=3 Character=0000017F12C43200 CharacterName=BP_ThirdPersonCharacter_C_2 CharacterPath=/Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_2 RespawnGeneration=1 InitializationState=3 InitializedGeneration=1 CurrentController=0000000000000000 CurrentControllerName=None HasAuthority=false IsLocallyController=false AegisPlayerState=0000017F196EEA00 PlayerId=256 TeamId=0 Score=356.0 IsPlayerDataReady=true BoundPlayerState=0000017F196EEA00 InitializedPlayerState=0000017F196EEA00 PlayerDataReadyDelegateHandleIsValid=true PlayerStateDelegateBindCount=1 PlayerStateDelegateUnbindCount=0 GameplayInitializationCount=1 SetupPlayerInputCount=0 InputComponent=0000000000000000 ViewTarget=0000000000000000 FollowCamera=0000017F15E93C00
[2026.08.29-07.50.36:392][838]LogProjectAegis: Display: Event=BeginPlay EntryPoint=BeginPlay World=0000017F1BD77000 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=3 Character=0000017F12C43200 CharacterName=BP_ThirdPersonCharacter_C_2 CharacterPath=/Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_2 RespawnGeneration=1 InitializationState=3 InitializedGeneration=1 CurrentController=0000000000000000 CurrentControllerName=None HasAuthority=false IsLocallyController=false AegisPlayerState=0000017F196EEA00 PlayerId=256 TeamId=0 Score=356.0 IsPlayerDataReady=true BoundPlayerState=0000017F196EEA00 InitializedPlayerState=0000017F196EEA00 PlayerDataReadyDelegateHandleIsValid=true PlayerStateDelegateBindCount=1 PlayerStateDelegateUnbindCount=0 GameplayInitializationCount=1 SetupPlayerInputCount=0 InputComponent=0000000000000000 ViewTarget=0000000000000000 FollowCamera=0000017F15E93C00
```
- 每次重生都经过输入请求、`Server RPC`、独立 `Timer`、`RestartPlayer()`、`Deferred Spawn` 和新 `Pawn` 的控制关系建立。
- 新 `Character` 的 `RespawnGeneration` 在 `FinishSpawning()` 前写入，并通过多个生命周期入口收敛到一次 `Gameplay` 初始化。
- `Character` 重生前后的 `PlayerState`、`TeamId` 和 `Score` 均得到保留，每个本地 `PlayerController` 的 `Widget` 始终只创建一次。

## 验证或作品证据

<video controls playsinline preload="metadata" aria-label="Spawn、重生与可重入初始化" style="display: block; width: 100%; border-radius: 12px;">
  <source src="/media/ue/day13/day13-spawn-respawn-initialization.mp4" type="video/mp4" />
  当前浏览器不支持视频播放，
  <a href="/media/ue/day13/day13-spawn-respawn-initialization.mp4">请打开视频文件</a>。
</video>

- 视频展示了两人单进程 `Listen Server PIE` 中，主机玩家和远程玩家分别按 `R` 发起服务器权威延迟重生的过程。
- 重生后的移动、跳跃和相机均正常，输入组件能够重新建立；退出 `PIE` 时 `Timer` 与 `Delegate` 正常清理，没有相关 `Warning`、`Error`、崩溃或断言。

## 下一步

进入 Week 2 Day 14，进行 Gameplay Framework 周整合与职责审查。
