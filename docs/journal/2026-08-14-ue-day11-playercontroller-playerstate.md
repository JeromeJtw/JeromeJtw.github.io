---
title: "UE Day 11：PlayerController 与 PlayerState 的玩家边界"
description: "通过两人 Listen Server、本地 UI 和跨 Pawn 销毁实验，验证 PlayerController 的机器边界与 PlayerState 的复制和生命周期职责。"
date: 2026-08-14
domain: ue
type: journal
series: ue-client-roadmap
tags:
  - Unreal Engine 5
  - C++
  - Project Aegis
  - PlayerController
  - PlayerState
  - Replication
status: published
outline: deep
---

# UE Day 11：PlayerController 与 PlayerState 的玩家边界

## 背景与目标

### 背景

在 `UE` 工程中，`PlayerController` 和 `PlayerState` 承担不同的 `Gameplay` 职责，需要正确区分玩家控制通道、玩家身份状态，为了以后能在实际的生产项目中熟练应用 `PlayerController` 和 `PlayerState`，所以学习这部分内容。另外，在 `UE` 工程中 `Pawn` 和 `Character` 是 `Gameplay Framework` 中被 `Controller` 控制的世界实体，且 `Pawn` 和 `Character` 可能在一局游戏中被销毁或替换，而玩家的控制通道和身份状态可能仍需继续存在，因此三者具有不同的职责和生命周期边界，需要掌握清楚。

### 目标

通过实验，能掌握 `Controller` 在服务器和客户端的 `Authority/Local` 组合、本地 `UI` 创建边界、`PlayerState` 的复制，以及 `Pawn` 销毁后玩家状态仍然保留等特性。

## 关键概念

### PlayerController 的机器边界

在单进程 `Listen Server` 模式运行时，服务器上有所有已登录玩家的 `PlayerController`，包括在主机上的玩家的 `PlayerController` 和其他所有远程客户端玩家的 `PlayerController`。它们的区别在 `Authority` 和 `LocalController`，具体区别见下一小节内容。

普通远程客户端通常只有自己的 `PlayerController`，没有其他玩家的 `Controller` 副本。客户端要观察其他玩家的共享状态，比如队伍、分数等，应该通过对应的 `PlayerState`，不能依赖其他玩家的 `Controller`。

### Authority 与 Local Controller

`PlayerController` 的 `HasAuthority()` 回答的是当前 `Controller` 实例是否具有网络权威；`IsLocalPlayerController()` 回答的是 `Controller` 是否属于当前机器的本地玩家。

在单进程 `Listen Server` 模式运行时，服务器上主机玩家的 `PlayerController` 的 `HasAuthority()` 返回 `true`，`IsLocalPlayerController()` 返回 `true`。服务器上远程客户端玩家的 `PlayerController` 的 `HasAuthority()` 返回 `true`，`IsLocalPlayerController()` 返回 `false`。远程客户端玩家的 `PlayerController` 的 `HasAuthority()` 返回 `false`，`IsLocalPlayerController()` 返回 `true`。

需要特别注意的是通过 `PlayerController` 创建本地 `UI` 时应该根据 `Local` 边界创建，而不能只检查 `Authority`。如果只检查 `HasAuthority()` 会让 `Listen Server` 主机创建 `UI`，也可能让服务器上的远程玩家 `Controller` 尝试创建 `UI`，远程客户端自己的 `Controller` 因为 `HasAuthority()` 返回 `false`，反而无法创建本地 `UI`。

### PlayerState 的职责和生命周期

`PlayerState` 保存玩家身份和需要复制的玩家状态，比如玩家Id、所在队伍、分数等；`UE` 的 `APlayerState` 已经提供了 `Score`，如果有需要可以不用重复声明同义属性。玩家身份和玩家状态都是服务器权威写入，客户端通过 `PlayerState` 副本观察。

`Pawn` 是 `UE Gameplay Framework` 中可以被 `Controller` 控制的世界实体，`PlayerController` 负责“做决定、下达控制意图”，`Pawn` 负责在 `World` 中承载身体、位置、碰撞和实际行为。`APawn` 继承自 `AActor`，`ACharacter` 是 `APawn` 的派生类，`Pawn` 比较通用，比如车辆、飞船、炮台、无人机等，`Character` 则专门面向“胶囊体站立角色”；所有 `Character` 都是 `Pawn`，但不是所有 `Pawn` 都是 `Character`。

在 `UE` 中 `Pawn` 会被销毁和替换，而 `Controller` 和 `PlayerState` 可以继续代表同一个玩家，不会随着 `Pawn` 的销毁而销毁，但是不代表 `Controller` 和 `PlayerState` 可以跨断线、跨游戏进程永久存在；`PlayerState` 替换或无缝切换时可能需要通过 `CopyProperties()` 转移状态。

### PlayerState 的复制到达与本地初始化

当本地初始化依赖 `PlayerState` 时，客户端不能假定 `Controller` 的 `BeginPlay()` 时 `PlayerState` 已经复制到达。`BeginPlay()` 和 `OnRep_PlayerState()` 应共同尝试进入同一个可重入初始化入口，该入口检查本地 `Controller`、`PlayerState` 有效性和当前 `PlayerState` 实例是否已初始化，不能使用 `HasAuthority()` 拦截远程客户端的本地初始化。`OnRep_PlayerState()` 重写时需要先调用 `Super::OnRep_PlayerState()`，再执行项目初始化。`PlayerState` 实例被替换时，应按对象身份重新处理，不能用永久布尔值跳过。

## 实践过程

### 项目关键类图

![GameMode、GameState、PlayerController 与 PlayerState 类图](/img/Day1103.png)

### 在 OnPostLogin 中初始化玩家状态

```cpp
void AProjectAegisGameMode::OnPostLogin(AController* NewPlayer)
{
	if (!HasAuthority())
	{
		Super::OnPostLogin(NewPlayer);
		UE_LOG(LogAegisCore,
			Warning,
			TEXT("AProjectAegisGameMode::OnPostLogin ignored on non-authority. GameMode=%p NetMode=%d NewPlayer=%p"),
			this,
			static_cast<uint8>(GetNetMode()),
			NewPlayer);
		return;
	}

	APlayerController* PlayerController = Cast<APlayerController>(NewPlayer);
	if (PlayerController == nullptr)
	{
		UE_LOG(LogAegisCore,
			Error,
			TEXT("AProjectAegisGameMode::OnPostLogin PlayerController is nullptr. GameMode=%p NetMode=%d HasAuthority=%s"),
			this,
			static_cast<uint8>(GetNetMode()),
			HasAuthority() ? TEXT("true") : TEXT("false"));
		Super::OnPostLogin(NewPlayer);
		return;
	}

	AProjectAegisPlayerState* PlayerState = PlayerController->GetPlayerState<AProjectAegisPlayerState>();
	if (!IsValid(PlayerState))
	{
		Super::OnPostLogin(NewPlayer);
		UE_LOG(LogAegisCore,
			Error,
			TEXT("AProjectAegisGameMode::OnPostLogin PlayerState is nullptr. GameMode=%p PlayerController=%p NetMode=%d HasAuthority=%s"),
			this,
			PlayerController,
			static_cast<uint8>(GetNetMode()),
			HasAuthority() ? TEXT("true") : TEXT("false"));
		return;
	}

	const int32 TeamId = NextTeamId % 2;
	const float Score = 100.0f + PlayerState->GetPlayerId();
	++NextTeamId;
	PlayerState->SetScore(Score);
	PlayerState->SetTeamId(TeamId);

	UE_LOG(LogAegisCore,
		Display,
		TEXT("GameMode OnPostLogin. GameMode=%p Controller=%p PlayerState=%p PlayerId=%d TeamId=%d Score=%.1f Pawn=%p NetMode=%d HasAuthority=%s IsLocalPlayerController=%s"),
		this,
		PlayerController,
		PlayerState,
		PlayerState->GetPlayerId(),
		TeamId,
		Score,
		PlayerState->GetPawn(),
		static_cast<uint8>(GetNetMode()),
		HasAuthority() ? TEXT("true") : TEXT("false"),
		PlayerController->IsLocalPlayerController() ? TEXT("true") : TEXT("false"));

	Super::OnPostLogin(NewPlayer);
}
```

服务器在玩家登录时通过有效的 `PlayerState` 写入 `TeamId` 和 `Score`。

### 为本地 Controller 创建状态界面

```cpp
void AProjectAegisPlayerController::BeginPlay()
{
	Super::BeginPlay();

	UE_LOG(LogProjectAegis,
		Display,
		TEXT("AProjectAegisPlayerController BeginPlay. Controller=%p PlayerState=%p Pawn=%p NetMode=%d HasAuthority=%s IsLocalPlayerController=%s"),
		this,
		GetPlayerState<AProjectAegisPlayerState>(),
		GetPawn<APawn>(),
		static_cast<uint8>(GetNetMode()),
		HasAuthority() ? TEXT("true") : TEXT("false"),
		IsLocalPlayerController() ? TEXT("true") : TEXT("false"));

  // 省略与本节无关的移动端触控 UI 初始化逻辑.

	if (IsLocalPlayerController() && IsValid(PlayerStateWidgetClass) && PlayerStateWidget == nullptr)
	{
		PlayerStateWidget = CreateWidget<UUserWidget>(this, PlayerStateWidgetClass);
		if (PlayerStateWidget)
		{
			PlayerStateWidget->AddToPlayerScreen(0);
			UE_LOG(
				LogProjectAegis,
				Display,
				TEXT("CreateWidget PlayerStateWidget Success. Controller=%p Widget=%p PlayerState=%p NetMode=%d IsLocalPlayerController=%s"),
				this,
				PlayerStateWidget.Get(),
				GetPlayerState<AProjectAegisPlayerState>(),
				static_cast<uint8>(GetNetMode()),
				IsLocalPlayerController() ? TEXT("true") : TEXT("false")
			);
		}
		else
		{
			UE_LOG(LogProjectAegis, Error, TEXT("Could not spawn PlayerStateWidget."));
		}
	}
}
```

本次 `Widget` 在 `BeginPlay()` 中按 `IsLocalPlayerController()` 创建，即使当时 `PlayerState` 为空也能创建；`OnRep_PlayerState()` 在属性复制到达后观察玩家状态。

### 两人 Listen Server 复制实现

本次使用两人单进程 `Listen Server PIE`，得到如下日志。

```text
[2026.08.13-08.50.33:439][201]LogAegisCore: Display: AProjectAegisPlayerState TeamId Set: PlayerState=000002AA6EEE3C00 PlayerId=256 TeamId=0 NetMode=2 HasAuthority=true
[2026.08.13-08.50.33:439][201]LogAegisCore: Display: GameMode OnPostLogin. GameMode=000002AA6EEEC000 Controller=000002A9F3431E00 PlayerState=000002AA6EEE3C00 PlayerId=256 TeamId=0 Score=356.0 Pawn=0000000000000000 NetMode=2 HasAuthority=true IsLocalPlayerController=true
[2026.08.13-08.50.33:463][201]LogProjectAegis: Display: AProjectAegisPlayerController BeginPlay. Controller=000002A9F3431E00 PlayerState=000002AA6EEE3C00 Pawn=000002A9F3435000 NetMode=2 HasAuthority=true IsLocalPlayerController=true
[2026.08.13-08.50.33:468][201]LogProjectAegis: Display: CreateWidget PlayerStateWidget Success. Controller=000002A9F3431E00 Widget=000002AA70E3E400 PlayerState=000002AA6EEE3C00 NetMode=2 IsLocalPlayerController=true
[2026.08.13-08.50.33:468][201]LogAegisCore: Display: AProjectAegisPlayerState::BeginPlay PlayerState=000002AA6EEE3C00 PlayerId=256 TeamId=0 Score=356.0 Pawn=000002A9F3435000 NetMode=2 Authority=true
[2026.08.13-08.50.33:872][205]LogAegisCore: Display: AProjectAegisPlayerState::BeginPlay PlayerState=000002AA71450600 PlayerId=0 TeamId=-1 Score=0.0 Pawn=0000000000000000 NetMode=2 Authority=true
[2026.08.13-08.50.33:872][205]LogProjectAegis: Display: AProjectAegisPlayerController BeginPlay. Controller=000002A9DAFD8200 PlayerState=000002AA71450600 Pawn=0000000000000000 NetMode=2 HasAuthority=true IsLocalPlayerController=false
[2026.08.13-08.50.33:880][205]LogAegisCore: Display: AProjectAegisPlayerState TeamId Set: PlayerState=000002AA71450600 PlayerId=257 TeamId=1 NetMode=2 HasAuthority=true
[2026.08.13-08.50.33:880][205]LogAegisCore: Display: GameMode OnPostLogin. GameMode=000002AA6EEEC000 Controller=000002A9DAFD8200 PlayerState=000002AA71450600 PlayerId=257 TeamId=1 Score=357.0 Pawn=0000000000000000 NetMode=2 HasAuthority=true IsLocalPlayerController=false
[2026.08.13-08.50.34:355][206]LogAegisCore: Display: AProjectAegisPlayerState Replication Layout Registered: Property=TeamId
[2026.08.13-08.50.34:360][206]LogProjectAegis: Display: AProjectAegisPlayerController BeginPlay. Controller=000002AA63F56E00 PlayerState=0000000000000000 Pawn=000002AA381D6E00 NetMode=3 HasAuthority=false IsLocalPlayerController=true
[2026.08.13-08.50.34:360][206]LogProjectAegis: Display: CreateWidget PlayerStateWidget Success. Controller=000002AA63F56E00 Widget=000002AA7188C600 PlayerState=0000000000000000 NetMode=3 IsLocalPlayerController=true
[2026.08.13-08.50.34:367][206]LogAegisCore: Display: AProjectAegisPlayerState Replication Layout Registered: Property=TeamId
[2026.08.13-08.50.34:367][206]LogAegisCore: Display: AProjectAegisPlayerState::OnRep_Score PlayerState=000002AA7188A200 PlayerId=257 TeamId=1 Score=357.0 Pawn=0000000000000000 NetMode=3 Authority=false
[2026.08.13-08.50.34:367][206]LogAegisCore: Display: AProjectAegisPlayerState::OnRep_TeamId PlayerState=000002AA7188A200 PlayerId=257 TeamId=1 Score=357.0 Pawn=0000000000000000 NetMode=3 Authority=false
[2026.08.13-08.50.34:367][206]LogAegisCore: Display: AProjectAegisPlayerState::BeginPlay PlayerState=000002AA7188A200 PlayerId=257 TeamId=1 Score=357.0 Pawn=0000000000000000 NetMode=3 Authority=false
[2026.08.13-08.50.34:367][206]LogAegisCore: Display: AProjectAegisPlayerState::OnRep_Score PlayerState=000002AA71886600 PlayerId=256 TeamId=0 Score=356.0 Pawn=0000000000000000 NetMode=3 Authority=false
[2026.08.13-08.50.34:367][206]LogAegisCore: Display: AProjectAegisPlayerState::OnRep_TeamId PlayerState=000002AA71886600 PlayerId=256 TeamId=0 Score=356.0 Pawn=0000000000000000 NetMode=3 Authority=false
[2026.08.13-08.50.34:367][206]LogAegisCore: Display: AProjectAegisPlayerState::BeginPlay PlayerState=000002AA71886600 PlayerId=256 TeamId=0 Score=356.0 Pawn=0000000000000000 NetMode=3 Authority=false
[2026.08.13-08.50.34:371][206]LogProjectAegis: Display: AProjectAegisPlayerController::OnRep_PlayerState Controller=000002AA63F56E00 PlayerState=000002AA7188A200 Pawn=000002AA381D6E00 PlayerId=257 TeamId=1 Score=357.0 NetMode=3 IsLocalPlayerController=true
```

通过观察日志可以得到如下结论。

- `Controller` 进入 `BeginPlay()` 时，`PlayerState` 可能还为空，复制系统随后为 `PlayerState` 属性赋值，并在复制更新后调用 `OnRep_PlayerState()`。
- 服务器在玩家登录时通过有效的 `PlayerState` 写入 `TeamId` 和 `Score`。日志中的 `Pawn=nullptr` 说明此时 `Pawn` 尚未建立，玩家状态初始化不依附于 `Pawn`。
- 日志展示了服务器主机、服务器远程玩家和远程客户端本地玩家三类 `PlayerController` 实例各自的 `HasAuthority()` 与 `IsLocalPlayerController()` 组合，具体边界在“关键概念”中已经详细描述了。

另外还可以看到如下图的 `UI` 效果。

![AEGIS PLAYER STATE效果](/img/Day1101.png)

### Pawn 销毁后的状态保留实验

启动 `Listen Server PIE` 后，先执行五条 `getall` 记录销毁前状态，再执行 `DestroyAll BP_ThirdPersonCharacter_C`，最后重复五条 `getall` 记录销毁后状态，`getall` 命令如下。

```text
getall ProjectAegisPlayerState PlayerId
getall ProjectAegisPlayerState TeamId
getall ProjectAegisPlayerState Score
getall ProjectAegisPlayerState PawnPrivate
getall ProjectAegisPlayerController Pawn
```

可以获得如下日志。

```text
[2026.08.13-09.34.59:108][358]LogAegisCore: Display: AProjectAegisPlayerState TeamId Set: PlayerState=00000166884BA200 PlayerId=256 TeamId=0 NetMode=2 HasAuthority=true
[2026.08.13-09.34.59:108][358]LogAegisCore: Display: GameMode OnPostLogin. GameMode=00000166884B9600 Controller=000001666B860000 PlayerState=00000166884BA200 PlayerId=256 TeamId=0 Score=356.0 Pawn=0000000000000000 NetMode=2 HasAuthority=true IsLocalPlayerController=true
[2026.08.13-09.34.59:156][358]LogProjectAegis: Display: AProjectAegisPlayerController BeginPlay. Controller=000001666B860000 PlayerState=00000166884BA200 Pawn=000001666B86AA00 NetMode=2 HasAuthority=true IsLocalPlayerController=true
[2026.08.13-09.34.59:161][358]LogProjectAegis: Display: CreateWidget PlayerStateWidget Success. Controller=000001666B860000 Widget=00000166884BE400 PlayerState=00000166884BA200 NetMode=2 IsLocalPlayerController=true
[2026.08.13-09.34.59:161][358]LogAegisCore: Display: AProjectAegisPlayerState::BeginPlay PlayerState=00000166884BA200 PlayerId=256 TeamId=0 Score=356.0 Pawn=000001666B86AA00 NetMode=2 Authority=true
[2026.08.13-09.34.59:529][363]LogAegisCore: Display: AProjectAegisPlayerState::BeginPlay PlayerState=000001666C05DE00 PlayerId=0 TeamId=-1 Score=0.0 Pawn=0000000000000000 NetMode=2 Authority=true
[2026.08.13-09.34.59:529][363]LogProjectAegis: Display: AProjectAegisPlayerController BeginPlay. Controller=00000166739E5000 PlayerState=000001666C05DE00 Pawn=0000000000000000 NetMode=2 HasAuthority=true IsLocalPlayerController=false
[2026.08.13-09.34.59:535][363]LogAegisCore: Display: AProjectAegisPlayerState TeamId Set: PlayerState=000001666C05DE00 PlayerId=257 TeamId=1 NetMode=2 HasAuthority=true
[2026.08.13-09.34.59:535][363]LogAegisCore: Display: GameMode OnPostLogin. GameMode=00000166884B9600 Controller=00000166739E5000 PlayerState=000001666C05DE00 PlayerId=257 TeamId=1 Score=357.0 Pawn=0000000000000000 NetMode=2 HasAuthority=true IsLocalPlayerController=false
[2026.08.13-09.34.59:640][364]LogAegisCore: Display: AProjectAegisPlayerState Replication Layout Registered: Property=TeamId
[2026.08.13-09.34.59:646][364]LogProjectAegis: Display: AProjectAegisPlayerController BeginPlay. Controller=00000166739E1E00 PlayerState=0000000000000000 Pawn=0000016673BD1E00 NetMode=3 HasAuthority=false IsLocalPlayerController=true
[2026.08.13-09.34.59:647][364]LogProjectAegis: Display: CreateWidget PlayerStateWidget Success. Controller=00000166739E1E00 Widget=000001657A71A200 PlayerState=0000000000000000 NetMode=3 IsLocalPlayerController=true
[2026.08.13-09.34.59:650][364]LogAegisCore: Display: AProjectAegisPlayerState Replication Layout Registered: Property=TeamId
[2026.08.13-09.34.59:651][364]LogAegisCore: Display: AProjectAegisPlayerState::OnRep_Score PlayerState=000001657A714E00 PlayerId=257 TeamId=1 Score=357.0 Pawn=0000000000000000 NetMode=3 Authority=false
[2026.08.13-09.34.59:651][364]LogAegisCore: Display: AProjectAegisPlayerState::OnRep_TeamId PlayerState=000001657A714E00 PlayerId=257 TeamId=1 Score=357.0 Pawn=0000000000000000 NetMode=3 Authority=false
[2026.08.13-09.34.59:651][364]LogAegisCore: Display: AProjectAegisPlayerState::BeginPlay PlayerState=000001657A714E00 PlayerId=257 TeamId=1 Score=357.0 Pawn=0000000000000000 NetMode=3 Authority=false
[2026.08.13-09.34.59:651][364]LogAegisCore: Display: AProjectAegisPlayerState::OnRep_Score PlayerState=000001657A714200 PlayerId=256 TeamId=0 Score=356.0 Pawn=0000000000000000 NetMode=3 Authority=false
[2026.08.13-09.34.59:651][364]LogAegisCore: Display: AProjectAegisPlayerState::OnRep_TeamId PlayerState=000001657A714200 PlayerId=256 TeamId=0 Score=356.0 Pawn=0000000000000000 NetMode=3 Authority=false
[2026.08.13-09.34.59:651][364]LogAegisCore: Display: AProjectAegisPlayerState::BeginPlay PlayerState=000001657A714200 PlayerId=256 TeamId=0 Score=356.0 Pawn=0000000000000000 NetMode=3 Authority=false
[2026.08.13-09.34.59:655][364]LogProjectAegis: Display: AProjectAegisPlayerController::OnRep_PlayerState Controller=00000166739E1E00 PlayerState=000001657A714E00 Pawn=0000016673BD1E00 PlayerId=257 TeamId=1 Score=357.0 NetMode=3 IsLocalPlayerController=true
[2026.08.13-09.35.15:529][624]Cmd: getall ProjectAegisPlayerState PlayerId
[2026.08.13-09.35.15:533][624]0) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_1.PlayerId = 256
[2026.08.13-09.35.15:533][624]1) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_0.PlayerId = 257
[2026.08.13-09.35.15:533][624]2) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_1.PlayerId = 257
[2026.08.13-09.35.15:533][624]3) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_0.PlayerId = 256
[2026.08.13-09.35.26:524][923]Cmd: getall ProjectAegisPlayerState TeamId
[2026.08.13-09.35.26:529][923]0) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_1.TeamId = 0
[2026.08.13-09.35.26:529][923]1) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_0.TeamId = 1
[2026.08.13-09.35.26:529][923]2) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_1.TeamId = 1
[2026.08.13-09.35.26:529][923]3) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_0.TeamId = 0
[2026.08.13-09.35.41:159][277]Cmd: getall ProjectAegisPlayerState Score
[2026.08.13-09.35.41:162][277]0) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_1.Score = 356.000000
[2026.08.13-09.35.41:162][277]1) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_0.Score = 357.000000
[2026.08.13-09.35.41:162][277]2) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_1.Score = 357.000000
[2026.08.13-09.35.41:162][277]3) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_0.Score = 356.000000
[2026.08.13-09.35.52:981][504]Cmd: getall ProjectAegisPlayerState PawnPrivate
[2026.08.13-09.35.52:987][504]0) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_1.PawnPrivate = /Game/ThirdPerson/Blueprints/BP_ThirdPersonCharacter.BP_ThirdPersonCharacter_C'/Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_1'
[2026.08.13-09.35.52:987][504]1) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_0.PawnPrivate = /Game/ThirdPerson/Blueprints/BP_ThirdPersonCharacter.BP_ThirdPersonCharacter_C'/Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_0'
[2026.08.13-09.35.52:987][504]2) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_1.PawnPrivate = /Game/ThirdPerson/Blueprints/BP_ThirdPersonCharacter.BP_ThirdPersonCharacter_C'/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_1'
[2026.08.13-09.35.52:987][504]3) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_0.PawnPrivate = /Game/ThirdPerson/Blueprints/BP_ThirdPersonCharacter.BP_ThirdPersonCharacter_C'/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_0'
[2026.08.13-09.36.02:446][679]Cmd: getall ProjectAegisPlayerController Pawn
[2026.08.13-09.36.02:452][679]0) BP_ThirdPersonPlayerController_C /Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonPlayerController_C_0.Pawn = /Game/ThirdPerson/Blueprints/BP_ThirdPersonCharacter.BP_ThirdPersonCharacter_C'/Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_0'
[2026.08.13-09.36.02:452][679]1) BP_ThirdPersonPlayerController_C /Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonPlayerController_C_1.Pawn = /Game/ThirdPerson/Blueprints/BP_ThirdPersonCharacter.BP_ThirdPersonCharacter_C'/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_1'
[2026.08.13-09.36.02:452][679]2) BP_ThirdPersonPlayerController_C /Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonPlayerController_C_0.Pawn = /Game/ThirdPerson/Blueprints/BP_ThirdPersonCharacter.BP_ThirdPersonCharacter_C'/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonCharacter_C_0'
[2026.08.13-09.36.15:939][814]Cmd: DestroyAll BP_ThirdPersonCharacter_C
[2026.08.13-09.36.30:337][140]Cmd: getall ProjectAegisPlayerState PlayerId
[2026.08.13-09.36.30:344][140]0) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_1.PlayerId = 256
[2026.08.13-09.36.30:345][140]1) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_0.PlayerId = 257
[2026.08.13-09.36.30:345][140]2) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_1.PlayerId = 257
[2026.08.13-09.36.30:345][140]3) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_0.PlayerId = 256
[2026.08.13-09.36.39:026][259]Cmd: getall ProjectAegisPlayerState TeamId
[2026.08.13-09.36.39:032][259]0) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_1.TeamId = 0
[2026.08.13-09.36.39:032][259]1) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_0.TeamId = 1
[2026.08.13-09.36.39:032][259]2) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_1.TeamId = 1
[2026.08.13-09.36.39:032][259]3) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_0.TeamId = 0
[2026.08.13-09.36.47:291][378]Cmd: getall ProjectAegisPlayerState Score
[2026.08.13-09.36.47:296][378]0) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_1.Score = 356.000000
[2026.08.13-09.36.47:297][378]1) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_0.Score = 357.000000
[2026.08.13-09.36.47:297][378]2) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_1.Score = 357.000000
[2026.08.13-09.36.47:297][378]3) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_0.Score = 356.000000
[2026.08.13-09.36.55:142][498]Cmd: getall ProjectAegisPlayerState PawnPrivate
[2026.08.13-09.36.55:147][498]0) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_1.PawnPrivate = None
[2026.08.13-09.36.55:147][498]1) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_0.PawnPrivate = None
[2026.08.13-09.36.55:147][498]2) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_1.PawnPrivate = None
[2026.08.13-09.36.55:147][498]3) ProjectAegisPlayerState /Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.ProjectAegisPlayerState_0.PawnPrivate = None
[2026.08.13-09.37.02:073][597]Cmd: getall ProjectAegisPlayerController Pawn
[2026.08.13-09.37.02:078][597]0) BP_ThirdPersonPlayerController_C /Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonPlayerController_C_0.Pawn = None
[2026.08.13-09.37.02:078][597]1) BP_ThirdPersonPlayerController_C /Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonPlayerController_C_1.Pawn = None
[2026.08.13-09.37.02:078][597]2) BP_ThirdPersonPlayerController_C /Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson:PersistentLevel.BP_ThirdPersonPlayerController_C_0.Pawn = None
[2026.08.13-09.37.14:307][706]LogAegisCore: Display: GameMode EndPlay. Reason=EEndPlayReason::EndPlayInEditor TimerWasActive=false TimerActiveAfterClear=false TimerHandleValidAfterClear=false
```

通过日志我们可以看到 `Pawn` 销毁前后，`PlayerState` 的完整路径及其对应的状态没有变化，比如 `PlayerId`、`TeamId`、`Score`，`PlayerController` 的完整路径也没有变化，和关键概念中的描述一致。`Widget` 没有重新创建。销毁后 `PawnPrivate` 与 `Controller` 的 `Pawn` 均变为 `None`。

### 配置自定义 GameState 与 PlayerState 类型

```cpp
AProjectAegisGameMode::AProjectAegisGameMode()
{
	GameStateClass = AProjectAegisGameState::StaticClass();
	PlayerStateClass = AProjectAegisPlayerState::StaticClass();
}
```

实际生效的 `GameMode` 必须配置正确的 `GameStateClass` 和 `PlayerStateClass`，本项目选择在 `AProjectAegisGameMode` 的 `C++` 构造函数中配置。`GameMode` 蓝图默认值也可以覆盖这些类配置，因此并非只能在 `C++` 构造函数中完成。`GameStateClass = AProjectAegisGameState::StaticClass()`；它告诉引擎：这个 `GameMode` 对应的 `GameState` 必须使用 `AProjectAegisGameState`。如果不设置，`AGameModeBase` 默认通常使用基础 `AGameStateBase`。`PlayerStateClass = AProjectAegisPlayerState::StaticClass()`，它告诉引擎：每个登录玩家应该创建 `AProjectAegisPlayerState`，而不是基础 `APlayerState`。如果不设置，默认创建的通常是 `APlayerState`。

## 验证或作品证据

<video controls playsinline preload="metadata" aria-label="UE Day 11：PlayerController 与 PlayerState 的玩家边界" style="display: block; width: 100%; border-radius: 12px;">
  <source src="/media/ue/day11/day11-playercontroller-playerstate.mp4" type="video/mp4" />
  当前浏览器不支持视频播放，
  <a href="/media/ue/day11/day11-playercontroller-playerstate.mp4">请打开视频文件</a>。
</video>

- 视频展示了两人单进程 `Listen Server PIE` 中三类 `Controller` 的 `Authority` 和 `LocalPlayerController` 组合。
- 每台机器只有本地 `Controller` 创建一次 `Widget`。
- 远程客户端通过 `PlayerState` 的复制回调取得两名玩家的 `TeamId` 和 `Score`。

## 问题与复盘

### TObjectPtr 直接传给 UE_LOG 的 %p 导致构建失败

- 现象：完成编码后的首次编译在 `ProjectAegisPlayerController.cpp` 报出 `C4840` 和 `%p` 参数类型错误。
- 原因：`UE 5.8` 中相关调用和属性使用 `TObjectPtr` 包装，`UE_LOG` 的 `%p` 需要实际指针，而我直接传递了 `TObjectPtr`，期望可变参数调用系统自动完成安全转换。
- 修正：`GetPawn()` 的日志参数改用返回原始指针的 `GetPawn<APawn>()`，`PlayerStateWidget` 改用 `PlayerStateWidget.Get()`。
- 验证：修改之后 `ProjectAegisEditor Win64 Development` 增量构建成功，相关 `C4840` 消失，`Warning` 和 `Error` 均为 0。

## 我的理解

在 `Gameplay Framework` 中，`PlayerController` 是控制通道，并同时存在 `Authority` 与 `Local` 两个互不等价的判断维度。`PlayerState` 承载需要服务器权威写入、跨客户端观察且相对 `Pawn` 更持久的玩家状态。“玩家”不能简单等同于当前的 `Character`。`Pawn/Character` 是玩家当前在 `World` 中的身体，可以被销毁或替换，不应承担队伍、分数和本地 `UI` 的长期生命周期。把分数或队伍放进 `Character` 会随 `Pawn` 销毁而丢失或重置；把本地 `UI` 跟随 `Character` 创建，可能在重生或替换时重复创建并遗留旧绑定。

## 下一步

按照计划学习 `Pawn`、`Character` 与 `Possession`。
