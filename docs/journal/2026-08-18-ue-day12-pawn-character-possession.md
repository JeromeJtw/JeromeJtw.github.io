---
title: "UE Day 12：Pawn、Character 与 Possession：从 Character 切换到 Observer Pawn"
description: "通过服务器权威 Possession 实验理解 Pawn、Character、PlayerController 与客户端输入重建。"
date: 2026-08-18
domain: ue
type: journal
series: ue-client-roadmap
tags:
  - Unreal Engine 5
  - C++
  - Project Aegis
  - PlayerController
  - Pawn
  - Character
  - Possession
  - Enhanced Input
status: published
outline: deep
---

# Pawn、Character 与 Possession：从 Character 切换到 Observer Pawn

## 背景与目标

### 背景

在 `UE` 工程中，`Pawn` 和 `Character` 承担不同的角色，为了以后能在实际生产项目中根据不同的用途选择 `Pawn` 和 `Character`，需要正确区分其职责。另外，也需要理解 `PlayerController` 通过 `Possession` 与 `Pawn` 建立控制关系的链路。

### 目标

通过 `Tab` 键让 `PlayerController` 在当前 `Character` 与运行时生成的 `Observer Pawn` 之间切换控制关系，理解 `Pawn`、`Character` 的差异，以及 `PlayerController` 通过 `Possession` 与 `Pawn` 建立关系的流程，掌握 `PossessedBy()`、`UnPossessed()` 各自的职责。

## 关键概念

### Pawn 与 Character 的继承关系和能力边界

- `ACharacter` 继承自 `APawn`。
- `APawn` 通常表达自由观察、载具、飞船、炮台、无人机等可被控制的对象；`ACharacter` 专门面向“胶囊体站立角色”。
- `ACharacter` 组合了 `Capsule`、`Skeletal Mesh` 和 `UCharacterMovementComponent`，`CharacterMovement` 不只是让角色移动，还提供行走、下落、跳跃、网络预测、服务器校验和客户端纠正。

### Controller 和 Pawn 建立关系的流程

`Possession` 表示 `Controller` 当前控制哪个 `Pawn`，流程如下。

```text
本地按键
→ 本地 PlayerController
→ Server RPC
→ 服务器 Possess(NewPawn)
 → 旧 Pawn UnPossessed
 → 新 Pawn PossessedBy
 → 更新服务器上的权威控制关系
→ 服务器调用 ClientRestart，并复制 Controller / Pawn 关系
→ 拥有者客户端通过 ClientRestart、OnRep_Pawn、OnRep_Controller 等入口协调本地关系
→ PawnClientRestart / SetupPlayerInputComponent 重建当前 Pawn 的输入
```

- `ClientRestart()` 与相关复制属性的到达顺序不能作为固定契约，客户端逻辑必须允许这些入口以不同顺序协调到同一最终状态。
- 在正常的 `Possession` 控制关系切换中，`PossessedBy()`、`UnPossessed()` 属于服务器或 `Standalone` 的权威回调；客户端应通过复制属性及对应的 `OnRep`、`ClientRestart()`、`PawnClientRestart()` 等入口观察控制关系。退出或销毁期间的清理调用不能被当作客户端权威切换入口。
- `Possess()` 改变的是 `Controller` 与 `Pawn` 的控制关系，不负责自动销毁旧 `Pawn`。销毁需要自己完成。

### Possess()、UnPossess()、PossessedBy()、UnPossessed()

- `Possess()` 和 `UnPossess()` 属于 `Controller`，负责发起和管理控制关系。
- `PossessedBy()` 和 `UnPossessed()` 属于 `Pawn`，用于响应自身控制关系的变化。
- `AController::Possess(APawn*)` 通常由服务器或 `Standalone` 调用，用于让 `Controller` 接管目标 `Pawn`。它会进入 `Controller` 的 `OnPossess()` 流程，解除旧 `Pawn` 的控制关系，再建立 `Controller` 与新 `Pawn` 的关系。
- `AController::UnPossess()` 由 `Controller` 主动解除当前 `Pawn`，内部进入 `OnUnPossess()` 流程，并清理双方的控制关系。
- `APawn::PossessedBy(AController*)` 在 `Pawn` 被权威 `Controller` 接管时收到的回调。基类实现会建立 `Owner`、`Controller` 和 `PlayerState` 等关联；重写时通常应该先调用 `Super::PossessedBy()`，再执行项目自己的权威初始化。
- `APawn::UnPossessed()` 在 `Pawn` 失去 `Controller` 时收到的回调。适合停止移动输入、清理与旧 `Controller` 相关的状态，但它不表示 `Pawn` 已被销毁。
- `Controller` 决定“控制哪个 Pawn”，`Pawn` 响应 “谁正在控制自己”。在网络游戏中，权威控制关系通常由服务器建立；拥有者客户端主要通过 `Pawn`、`Controller` 等属性的网络复制以及 `OnRep_Controller()`、`PawnClientRestart()` 等入口观察结果并重建本地输入，不能假定服务器回调会以相同形式在客户端执行。

### 注意事项

- `PlayerController` 代表一个玩家的控制通道，负责接收玩家输入并执行 `Possess`；`AIController` 则用于 `AI` 控制。`Pawn` 是玩家或 `AI` 在世界中的具体身体、移动、碰撞、动画和表现。
- 网络游戏中的权威 `Possession` 关系通常由服务器建立。客户端本地改变控制关系不能建立服务器认可的权威结果，还会造成自身输入或显示状态与服务器及其他客户端不一致。
- `Controller` 不会随着 `Pawn` 的销毁而销毁。在一次 `Gameplay` 中 `Pawn` 可能被销毁或替换，所以 `Pawn` 的 `InputComponent` 会按当前 `Possession` 流程和 `Pawn` 生命周期创建、销毁或重建；`Controller` 持有的本地 `UI` 不应该随着 `Pawn` 的切换而重复创建。

## 实践过程

### Observer Pawn 的实现

- 新增了 `AAegisObserverPawn`，并保留原有 `Character`，后续会在原有的 `Character` 和 `AAegisObserverPawn` 之间进行切换。
- `AAegisObserverPawn` 使用 `USphereComponent`、`UCameraComponent` 和 `UFloatingPawnMovement`，并开启 `Actor` 与移动复制。
- 相机采用 `Controller` 的 `ControlRotation`。
- 在 `SetupPlayerInputComponent()` 中绑定移动、视角和鼠标视角输入。

```cpp
AAegisObserverPawn::AAegisObserverPawn()
{
	PrimaryActorTick.bCanEverTick = false;

	bReplicates = true;
	SetReplicateMovement(true);

	bUseControllerRotationPitch = false;
	bUseControllerRotationYaw = false;
	bUseControllerRotationRoll = false;

	CollisionComponent = CreateDefaultSubobject<USphereComponent>(TEXT("CollisionComponent"));
	SetRootComponent(CollisionComponent);

	CollisionComponent->InitSphereRadius(34.0f);
	CollisionComponent->SetCollisionProfileName(TEXT("Pawn"));

	CameraComponent = CreateDefaultSubobject<UCameraComponent>(TEXT("CameraComponent"));
	CameraComponent->SetupAttachment(CollisionComponent);
	CameraComponent->bUsePawnControlRotation = true;

	MovementComponent = CreateDefaultSubobject<UFloatingPawnMovement>(TEXT("MovementComponent"));
	MovementComponent->SetUpdatedComponent(CollisionComponent);
}

void AAegisObserverPawn::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	UEnhancedInputComponent* EnhancedInputComponent = Cast<UEnhancedInputComponent>(PlayerInputComponent);

	if (!EnhancedInputComponent)
	{
		UE_LOG(
			LogProjectAegis,
			Error,
			TEXT("ObserverPawn SetupPlayerInputComponent failed: EnhancedInputComponent is invalid. Pawn=%p PawnName=%s"),
			this,
			*GetNameSafe(this)
		);
		return;
	}

	int32 BoundActionCount = 0;
	if (IsValid(MoveAction))
	{
		EnhancedInputComponent->BindAction(MoveAction, ETriggerEvent::Triggered, this, &AAegisObserverPawn::Move);
		++BoundActionCount;
	}
	else
	{
		UE_LOG(
			LogProjectAegis,
			Warning,
			TEXT("ObserverPawn MoveAction is invalid. Pawn=%p PawnName=%s"),
			this,
			*GetNameSafe(this)
		);
	}

	if (IsValid(LookAction))
	{
		EnhancedInputComponent->BindAction(LookAction, ETriggerEvent::Triggered, this, &AAegisObserverPawn::Look);
		++BoundActionCount;
	}
	else
	{
		UE_LOG(
			LogProjectAegis,
			Warning,
			TEXT("ObserverPawn LookAction is invalid. Pawn=%p PawnName=%s"),
			this,
			* GetNameSafe(this)
		);
	}

	if (IsValid(MouseLookAction))
	{
		EnhancedInputComponent->BindAction(MouseLookAction, ETriggerEvent::Triggered, this, &AAegisObserverPawn::Look);
		++BoundActionCount;
	}
	else
	{
		UE_LOG(
			LogProjectAegis,
			Warning,
			TEXT("ObserverPawn MouseLookAction is invalid. Pawn=%p PawnName=%s"),
			this,
			* GetNameSafe(this)
		);
	}

	UE_LOG(
		LogProjectAegis,
		Display,
		TEXT("ObserverPawn SetupPlayerInputComponent. Pawn=%p PawnName=%s InputComponent=%p Controller=%p BoundActionCount=%d NetMode=%d Authority=%s Local=%s"),
		this,
		*GetNameSafe(this),
		PlayerInputComponent,
		GetController(),
		BoundActionCount,
		static_cast<uint8>(GetNetMode()),
		HasAuthority() ? TEXT("true") : TEXT("false"),
		IsLocallyControlled() ? TEXT("true") : TEXT("false")
	);
}

void AAegisObserverPawn::Move(const FInputActionValue& Value)
{
	if (!IsValid(GetController()))
	{
		return;
	}

	const FVector2D MovementVector = Value.Get<FVector2D>();
	const FRotator ControlRotation = GetController()->GetControlRotation();
	const FRotationMatrix RotationMatrix(ControlRotation);

	const FVector ForwardDirection = RotationMatrix.GetUnitAxis(EAxis::X);

	const FVector RightDirection = RotationMatrix.GetUnitAxis(EAxis::Y);

	AddMovementInput(ForwardDirection, MovementVector.Y);
	AddMovementInput(RightDirection, MovementVector.X);
}

void AAegisObserverPawn::Look(const FInputActionValue& Value)
{
	const FVector2D LookAxisVector = Value.Get<FVector2D>();

	AddControllerYawInput(LookAxisVector.X);
	AddControllerPitchInput(LookAxisVector.Y);
}
```

- `SetReplicateMovement(true)` 开启了 `Actor` 移动复制，但 `UFloatingPawnMovement` 不具备 `UCharacterMovementComponent` 的完整网络预测、服务器移动校验和客户端纠正流程，本次实验验证的是服务器权威 `Possession` 与拥有者客户端的观察操作，不把 `Observer Pawn` 的完整多人网络移动系统作为验收目标。

### PlayerController 中的权威切换

- 设计的完整调用链如下所示。

```text
Tab
→ HandleToggleObserverPawn()
→ ServerToggleObserverPawn()
→ 服务器 Spawn / Possess
```

- 从 `Character` 切换，保存原 `Pawn` 的弱引用，以当前 `Pawn` 位置和 `ControlRotation` 生成 `Observer Pawn`，执行 `Possess()`，确认成功后保留原 `Character`。
- 返回 `Character`：验证返回目标仍然有效且未被其他 `Controller` 控制，保存观察期间的视角，重新 `Possess()` 原 `Character`，成功后销毁 `Observer Pawn` 并重置弱引用。
- 本实验把 `Spawn` 或 `Possess` 失败时尽量保留或恢复已有的有效控制关系作为失败路径契约，避免主动让 `Controller` 丢失当前可控 `Pawn`；这不表示 `UE` 强制每个 `Controller` 始终拥有 `Pawn`。

```cpp
void AProjectAegisPlayerController::ServerToggleObserverPawn_Implementation()
{
	if (!HasAuthority())
	{
		UE_LOG(
			LogProjectAegis,
			Warning,
			TEXT("ServerToggleObserverPawn ignored on non-authority Controller=%p"),
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
			TEXT("ServerToggleObserverPawn ignored because World is invalid or gameplay has not begun. Controller=%p"),
			this
		);
		return;
	}

	APawn* CurrentPawn = GetPawn();

	if (!IsValid(CurrentPawn))
	{
		UE_LOG(
			LogProjectAegis,
			Warning,
			TEXT("ServerToggleObserverPawn failed because current Pawn is invalid. Controller=%p"),
			this
		);
		return;
	}
	AAegisObserverPawn* CurrentObserverPawn = Cast<AAegisObserverPawn>(CurrentPawn);

	if (CurrentObserverPawn != nullptr)
	{
		if (!ReturnPawn.IsValid())
		{
			UE_LOG(
				LogProjectAegis,
				Warning,
				TEXT("Return Pawn is invalid. Controller=%p CurrentObserverPawn=%p"),
				this,
				CurrentObserverPawn
			);
			return;
		}

		APawn* ReturnTarget = ReturnPawn.Get();

		if (!IsValid(ReturnTarget) || ReturnTarget->IsActorBeingDestroyed())
		{
			UE_LOG(
				LogProjectAegis,
				Warning,
				TEXT("Return Pawn is no longer usable. Controller=%p ReturnTarget=%p"),
				this,
				ReturnTarget
			);
			return;
		}

		AController* ExistingController = ReturnTarget->GetController();
		if (ExistingController != nullptr && ExistingController != this)
		{
			UE_LOG(
				LogProjectAegis,
				Warning,
				TEXT("Return Pawn is controlled by another Controller. Controller=%p ReturnTarget=%p ReturnTargetName=%s ExistingController=%p ExistingControllerName=%s"),
				this,
				ReturnTarget,
				*GetNameSafe(ReturnTarget),
				ExistingController,
				*GetNameSafe(ExistingController)
			);
			return;
		}

		const FRotator ObserverControlRotation = GetControlRotation();

		Possess(ReturnTarget);

		if (GetPawn() != ReturnTarget)
		{
			UE_LOG(
				LogProjectAegis,
				Warning,
				TEXT("Return Character Possess failed. Controller=%p ReturnTarget=%p CurrentPawn=%p"),
				this,
				ReturnTarget,
				GetPawn().Get()
			);

			if (GetPawn() == nullptr && IsValid(CurrentObserverPawn))
			{
				Possess(CurrentObserverPawn);
			}

			return;
		}

		SetControlRotation(ObserverControlRotation);

		LogPossessionEvent(TEXT("ObserverDestroyed"), CurrentObserverPawn, ReturnTarget);
		if (IsValid(CurrentObserverPawn))
		{
			CurrentObserverPawn->Destroy();
		}
		ReturnPawn.Reset();
	}
	else
	{
		if (!ObserverPawnClass)
		{
			UE_LOG(
				LogProjectAegis,
				Warning,
				TEXT("ObserverPawnClass is invalid. Controller=%p CurrentPawn=%p"),
				this,
				CurrentPawn
			);
			return;
		}

		const FRotator SavedControlRotation = GetControlRotation();
		const FTransform SpawnTransform(SavedControlRotation, CurrentPawn->GetActorLocation());

		FActorSpawnParameters SpawnParameters;
		SpawnParameters.Owner = this;
		SpawnParameters.Instigator = CurrentPawn;
		SpawnParameters.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;

		AAegisObserverPawn* SpawnedObserverPawn = World->SpawnActor<AAegisObserverPawn>(ObserverPawnClass, SpawnTransform, SpawnParameters);

		if (!IsValid(SpawnedObserverPawn))
		{
			UE_LOG(
				LogProjectAegis,
				Warning,
				TEXT("Observer Pawn Spawn failed. Controller=%p CurrentPawn=%p"),
				this,
				CurrentPawn
			);
			return;
		}
		LogPossessionEvent(TEXT("SpawnObserver"), CurrentPawn, SpawnedObserverPawn);
		ReturnPawn = CurrentPawn;

		Possess(SpawnedObserverPawn);

		if (GetPawn() != SpawnedObserverPawn)
		{
			UE_LOG(
				LogProjectAegis,
				Warning,
				TEXT("Observer Pawn Possess Failed. Controller=%p SpawnedPawn=%p CurrentPawn=%p"),
				this,
				SpawnedObserverPawn,
				GetPawn().Get()
			);

			if (GetPawn() == nullptr && IsValid(CurrentPawn))
			{
				Possess(CurrentPawn);

				if (GetPawn() != CurrentPawn)
				{
					UE_LOG(
						LogProjectAegis,
						Warning,
						TEXT("Original Pawn recovery failed. Controller=%p OriginalPawn=%p CurrentPawn=%p"),
						this,
						CurrentPawn,
						GetPawn().Get()
					);
				}
			}

			if (IsValid(SpawnedObserverPawn) && SpawnedObserverPawn->GetController() != this)
			{
				SpawnedObserverPawn->Destroy();
			}

			ReturnPawn.Reset();
			return;
		}

		SetControlRotation(SavedControlRotation);
		LogPossessionEvent(TEXT("ObserverPossessCompleted"), CurrentPawn, SpawnedObserverPawn);
		return;
	}
}

void AProjectAegisPlayerController::HandleToggleObserverPawn()
{
	if (!IsLocalPlayerController())
	{
		return;
	}
	LogPossessionEvent(TEXT("ToggleRequested"), GetPawn().Get(), GetPawn().Get());
	ServerToggleObserverPawn();
}

void AProjectAegisPlayerController::OnPossess(APawn* InPawn)
{
	APawn* PreviousPawn = GetPawn();

	Super::OnPossess(InPawn);
	LogPossessionEvent(TEXT("OnPossess"), PreviousPawn, InPawn);
}

void AProjectAegisPlayerController::OnUnPossess()
{
	APawn* PreviousPawn = GetPawn();

	Super::OnUnPossess();
	LogPossessionEvent(TEXT("OnUnPossess"), PreviousPawn, GetPawn().Get());
}

void AProjectAegisPlayerController::LogPossessionEvent(const TCHAR* EventName, APawn* PreviousPawn, APawn* NewPawn) const
{
	const UWorld* World = GetWorld();
	const AProjectAegisPlayerState* AegisPlayerState = GetPlayerState<AProjectAegisPlayerState>();
	const AActor* ViewTarget = GetViewTarget();

	const int32 PlayerId = AegisPlayerState ? AegisPlayerState->GetPlayerId() : INDEX_NONE;

	const int32 WorldType = World ? static_cast<int32>(World->WorldType) : INDEX_NONE;

	UE_LOG(
		LogProjectAegis,
		Display,
		TEXT("Possession Event=%s World=%p WorldName=%s WorldPath=%s WorldType=%d NetMode=%d Controller=%p ControllerName=%s PlayerId=%d Authority=%s Local=%s OldPawn=%p OldPawnName=%s NewPawn=%p NewPawnName=%s ControlRotation=%s ViewTarget=%p ViewTargetName=%s PlayerStateWidget=%p"),
		EventName,
		World,
		* GetNameSafe(World),
		*GetPathNameSafe(World),
		WorldType,
		static_cast<uint8>(GetNetMode()),
		this,
		*GetNameSafe(this),
		PlayerId,
		HasAuthority() ? TEXT("true") : TEXT("false"),
		IsLocalPlayerController() ? TEXT("true") : TEXT("false"),
		PreviousPawn,
		*GetNameSafe(PreviousPawn),
		NewPawn,
		*GetNameSafe(NewPawn),
		*GetControlRotation().ToCompactString(),
		ViewTarget,
		*GetNameSafe(ViewTarget),
		PlayerStateWidget.Get()
	);
}
```

- 头文件声明的是
```cpp
UFUNCTION(Server, Reliable)
void ServerToggleObserverPawn();
```

- `cpp` 实现的是
```cpp
void AProjectAegisPlayerController::ServerToggleObserverPawn_Implementation()
```

- 这是 `Unreal RPC` 的固定写法，头文件中声明的是“网络调用入口”，`cpp` 中实现的是“到达服务器后真正执行的逻辑”。
- `UHT` 识别到 `Server` 说明符后，会为这个函数生成网络调用所需的包装代码。调用方应该调用 `ServerToggleObserverPawn()`。其行为取决于调用位置，拥有该 `PlayerController` 的客户端调用时，`UE` 将 `RPC` 序列化并发送到服务器。服务器收到 `RPC` 后，在服务器上的对应 `PlayerController` 实例中调用 `AProjectAegisPlayerController::ServerToggleObserverPawn_Implementation()`。
- 不要在普通业务代码中直接调用 `_Implementation()`。直接调用会绕过 `RPC` 的网络路由，使代码只在当前对象实例上，无法表达“由客户端请求服务器执行”的语义。这里把 `RPC` 放在 `PlayerController` 上也符合网络所有权规则：客户端拥有自己的 `PlayerController`，因此能够通过它向服务器发送 `Server RPC`。函数名中的 `Server` 只是项目命名惯例，真正让它成为服务器 `RPC` 的是 `UFUNCTION(Server, Reliable)`，其中 `Server` 表示在服务器执行，`Reliable` 表示可靠传输；`_Implementation` 则是 `UHT` 为这种 `RPC` 约定的实现后缀。

### 输入与相机恢复

- `Mapping Context` 由 `PlayerController` 管理，不随 `Pawn` 切换销毁。
- 当前 `Pawn` 通过 `PawnClientRestart()` 和 `SetupPlayerInputComponent()` 重建输入。
- `bAutoManageActiveCameraTarget` 根据当前 `Pawn` 管理 `ViewTarget`。
- `OnPossess()` 会使用新 `Pawn` 的 `Actor Rotation` 更新 `ControlRotation`，因此切换前保存视角，确认 `Possess` 成功后恢复。

### 资源配置

- 新建蓝图类 `BP_AegisObserverPawn`。
- 在 `IMC_Default` 中建立 `Tab` 和 `IA_ToggleObserverPawn` 的映射。
- 在 `BP_ThirdPersonPlayerController` 中配置 `Observer Pawn` 类和切换 `Input Action`。

### 两人 Listen Server PIE 实验日志

```text
[2026.08.18-10.05.32:443][323]LogProjectAegis: Display: Character PossessedBy. Character=000002A61E29B400 NewController=000002A61E29F000
[2026.08.18-10.05.32:445][323]LogProjectAegis: Display: Character SetupPlayerInputComponent.
[2026.08.18-10.05.32:445][323]LogProjectAegis: Display: Character PawnClientRestart. Character=000002A61E29B400 InputComponent=000002A61E3BB280
[2026.08.18-10.05.32:447][323]LogProjectAegis: Display: Possession Event=OnPossess World=000002A6819E8C00 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=000002A61E29F000 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=256 Authority=true Local=true OldPawn=000002A61E29B400 OldPawnName=BP_ThirdPersonCharacter_C_0 NewPawn=000002A61E29B400 NewPawnName=BP_ThirdPersonCharacter_C_0 ControlRotation=R(0) ViewTarget=000002A61E29B400 ViewTargetName=BP_ThirdPersonCharacter_C_0 PlayerStateWidget=0000000000000000
[2026.08.18-10.05.32:457][323]LogProjectAegis: Display: AProjectAegisPlayerController BeginPlay. Controller=000002A61E29F000 PlayerState=000002A7782A0C00 Pawn=000002A61E29B400 NetMode=2 HasAuthority=true IsLocalPlayerController=true
[2026.08.18-10.05.32:462][323]LogProjectAegis: Display: CreateWidget PlayerStateWidget Success. Controller=000002A61E29F000 Widget=000002A7782AC600 PlayerState=000002A7782A0C00 NetMode=2 IsLocalPlayerController=true
[2026.08.18-10.05.32:949][327]LogProjectAegis: Display: Character PossessedBy. Character=000002A680460A00 NewController=000002A67FEC3C00
[2026.08.18-10.05.32:949][327]LogProjectAegis: Display: Possession Event=OnPossess World=000002A6819E8C00 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=000002A67FEC3C00 ControllerName=BP_ThirdPersonPlayerController_C_1 PlayerId=257 Authority=true Local=false OldPawn=000002A680460A00 OldPawnName=BP_ThirdPersonCharacter_C_1 NewPawn=000002A680460A00 NewPawnName=BP_ThirdPersonCharacter_C_1 ControlRotation=R(0) ViewTarget=000002A680460A00 ViewTargetName=BP_ThirdPersonCharacter_C_1 PlayerStateWidget=0000000000000000
[2026.08.18-10.05.33:420][328]LogProjectAegis: Display: CreateWidget PlayerStateWidget Success. Controller=000002A68046C800 Widget=000002A79D56B400 PlayerState=0000000000000000 NetMode=3 IsLocalPlayerController=true
[2026.08.18-10.06.36:130][731]LogProjectAegis: Display: Possession Event=ToggleRequested World=000002A6819E8C00 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=000002A61E29F000 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=256 Authority=true Local=true OldPawn=000002A61E29B400 OldPawnName=BP_ThirdPersonCharacter_C_0 NewPawn=000002A61E29B400 NewPawnName=BP_ThirdPersonCharacter_C_0 ControlRotation=R(P=319.40, Y=111.13) ViewTarget=000002A61E29B400 ViewTargetName=BP_ThirdPersonCharacter_C_0 PlayerStateWidget=000002A7782AC600
[2026.08.18-10.06.36:131][731]LogProjectAegis: Display: Possession Event=SpawnObserver World=000002A6819E8C00 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=000002A61E29F000 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=256 Authority=true Local=true OldPawn=000002A61E29B400 OldPawnName=BP_ThirdPersonCharacter_C_0 NewPawn=000002A73681DE00 NewPawnName=BP_AegisObserverPawn_C_0 ControlRotation=R(P=319.40, Y=111.13) ViewTarget=000002A61E29B400 ViewTargetName=BP_ThirdPersonCharacter_C_0 PlayerStateWidget=000002A7782AC600
[2026.08.18-10.06.36:131][731]LogProjectAegis: Display: Character UnPossessed. Character=000002A61E29B400 CharacterName=BP_ThirdPersonCharacter_C_0 OldController=000002A61E29F000 OldControllerName=BP_ThirdPersonPlayerController_C_0 CurrentController=0000000000000000
[2026.08.18-10.06.36:131][731]LogProjectAegis: Display: Possession Event=OnUnPossess World=000002A6819E8C00 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=000002A61E29F000 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=256 Authority=true Local=true OldPawn=000002A61E29B400 OldPawnName=BP_ThirdPersonCharacter_C_0 NewPawn=0000000000000000 NewPawnName=None ControlRotation=R(P=319.40, Y=111.13) ViewTarget=000002A61E29F000 ViewTargetName=BP_ThirdPersonPlayerController_C_0 PlayerStateWidget=000002A7782AC600
[2026.08.18-10.06.36:131][731]LogProjectAegis: Display: ObserverPawn PossessedBy. Pawn=000002A73681DE00 Name=BP_AegisObserverPawn_C_0 Controller=000002A61E29F000 World=000002A6819E8C00 NetMode=2 Authority=true
[2026.08.18-10.06.36:131][731]LogProjectAegis: Display: ObserverPawn SetupPlayerInputComponent. Pawn=000002A73681DE00 PawnName=BP_AegisObserverPawn_C_0 InputComponent=000002A714F9CCC0 Controller=000002A61E29F000 BoundActionCount=3 NetMode=2 Authority=true Local=true
[2026.08.18-10.06.36:131][731]LogProjectAegis: Display: ObserverPawn PawnClientRestart. Pawn=000002A73681DE00 InputComponent=000002A714F9CCC0 Controller=000002A61E29F000 NetMode=2
[2026.08.18-10.06.36:131][731]LogProjectAegis: Display: Possession Event=OnPossess World=000002A6819E8C00 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=000002A61E29F000 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=256 Authority=true Local=true OldPawn=000002A61E29B400 OldPawnName=BP_ThirdPersonCharacter_C_0 NewPawn=000002A73681DE00 NewPawnName=BP_AegisObserverPawn_C_0 ControlRotation=R(P=319.40, Y=111.13) ViewTarget=000002A73681DE00 ViewTargetName=BP_AegisObserverPawn_C_0 PlayerStateWidget=000002A7782AC600
[2026.08.18-10.06.36:131][731]LogProjectAegis: Display: Possession Event=ObserverPossessCompleted World=000002A6819E8C00 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=000002A61E29F000 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=256 Authority=true Local=true OldPawn=000002A61E29B400 OldPawnName=BP_ThirdPersonCharacter_C_0 NewPawn=000002A73681DE00 NewPawnName=BP_AegisObserverPawn_C_0 ControlRotation=R(P=319.40, Y=111.13) ViewTarget=000002A73681DE00 ViewTargetName=BP_AegisObserverPawn_C_0 PlayerStateWidget=000002A7782AC600
[2026.08.18-10.09.30:208][554]LogProjectAegis: Display: Possession Event=ToggleRequested World=000002A6819E8C00 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=000002A61E29F000 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=256 Authority=true Local=true OldPawn=000002A73681DE00 OldPawnName=BP_AegisObserverPawn_C_0 NewPawn=000002A73681DE00 NewPawnName=BP_AegisObserverPawn_C_0 ControlRotation=R(P=354.40, Y=112.35) ViewTarget=000002A73681DE00 ViewTargetName=BP_AegisObserverPawn_C_0 PlayerStateWidget=000002A7782AC600
[2026.08.18-10.09.30:208][554]LogProjectAegis: Display: ObserverPawn Unpossessed. Pawn=000002A73681DE00 Name=BP_AegisObserverPawn_C_0 OldController=000002A61E29F000 OldControllerName=BP_ThirdPersonPlayerController_C_0 CurrentController=0000000000000000
[2026.08.18-10.09.30:208][554]LogProjectAegis: Display: Possession Event=OnUnPossess World=000002A6819E8C00 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=000002A61E29F000 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=256 Authority=true Local=true OldPawn=000002A73681DE00 OldPawnName=BP_AegisObserverPawn_C_0 NewPawn=0000000000000000 NewPawnName=None ControlRotation=R(P=354.40, Y=112.35) ViewTarget=000002A61E29F000 ViewTargetName=BP_ThirdPersonPlayerController_C_0 PlayerStateWidget=000002A7782AC600
[2026.08.18-10.09.30:208][554]LogProjectAegis: Display: Character PossessedBy. Character=000002A61E29B400 NewController=000002A61E29F000
[2026.08.18-10.09.30:208][554]LogProjectAegis: Display: Character SetupPlayerInputComponent.
[2026.08.18-10.09.30:208][554]LogProjectAegis: Display: Character PawnClientRestart. Character=000002A61E29B400 InputComponent=000002A67B8FEA80
[2026.08.18-10.09.30:208][554]LogProjectAegis: Display: Possession Event=OnPossess World=000002A6819E8C00 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=000002A61E29F000 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=256 Authority=true Local=true OldPawn=000002A73681DE00 OldPawnName=BP_AegisObserverPawn_C_0 NewPawn=000002A61E29B400 NewPawnName=BP_ThirdPersonCharacter_C_0 ControlRotation=R(Y=-174.40) ViewTarget=000002A61E29B400 ViewTargetName=BP_ThirdPersonCharacter_C_0 PlayerStateWidget=000002A7782AC600
[2026.08.18-10.09.30:208][554]LogProjectAegis: Display: Possession Event=ObserverDestroyed World=000002A6819E8C00 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=000002A61E29F000 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=256 Authority=true Local=true OldPawn=000002A73681DE00 OldPawnName=BP_AegisObserverPawn_C_0 NewPawn=000002A61E29B400 NewPawnName=BP_ThirdPersonCharacter_C_0 ControlRotation=R(P=354.40, Y=112.35) ViewTarget=000002A61E29B400 ViewTargetName=BP_ThirdPersonCharacter_C_0 PlayerStateWidget=000002A7782AC600
[2026.08.18-10.09.52:182][860]LogProjectAegis: Display: Possession Event=ToggleRequested World=000002A7563B1C00 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=3 Controller=000002A68046C800 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=257 Authority=false Local=true OldPawn=000002A680466400 OldPawnName=BP_ThirdPersonCharacter_C_0 NewPawn=000002A680466400 NewPawnName=BP_ThirdPersonCharacter_C_0 ControlRotation=R(P=318.92, Y=187.10) ViewTarget=000002A680466400 ViewTargetName=BP_ThirdPersonCharacter_C_0 PlayerStateWidget=000002A79D56B400
[2026.08.18-10.09.52:247][861]LogProjectAegis: Display: Possession Event=SpawnObserver World=000002A6819E8C00 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=000002A67FEC3C00 ControllerName=BP_ThirdPersonPlayerController_C_1 PlayerId=257 Authority=true Local=false OldPawn=000002A680460A00 OldPawnName=BP_ThirdPersonCharacter_C_1 NewPawn=000002A680438400 NewPawnName=BP_AegisObserverPawn_C_1 ControlRotation=R(P=318.93, Y=187.10) ViewTarget=000002A680460A00 ViewTargetName=BP_ThirdPersonCharacter_C_1 PlayerStateWidget=0000000000000000
[2026.08.18-10.09.52:247][861]LogProjectAegis: Display: Character UnPossessed. Character=000002A680460A00 CharacterName=BP_ThirdPersonCharacter_C_1 OldController=000002A67FEC3C00 OldControllerName=BP_ThirdPersonPlayerController_C_1 CurrentController=0000000000000000
[2026.08.18-10.09.52:247][861]LogProjectAegis: Display: Possession Event=OnUnPossess World=000002A6819E8C00 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=000002A67FEC3C00 ControllerName=BP_ThirdPersonPlayerController_C_1 PlayerId=257 Authority=true Local=false OldPawn=000002A680460A00 OldPawnName=BP_ThirdPersonCharacter_C_1 NewPawn=0000000000000000 NewPawnName=None ControlRotation=R(P=318.93, Y=187.10) ViewTarget=000002A67FEC3C00 ViewTargetName=BP_ThirdPersonPlayerController_C_1 PlayerStateWidget=0000000000000000
[2026.08.18-10.09.52:247][861]LogProjectAegis: Display: ObserverPawn PossessedBy. Pawn=000002A680438400 Name=BP_AegisObserverPawn_C_1 Controller=000002A67FEC3C00 World=000002A6819E8C00 NetMode=2 Authority=true
[2026.08.18-10.09.52:247][861]LogProjectAegis: Display: Possession Event=OnPossess World=000002A6819E8C00 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=000002A67FEC3C00 ControllerName=BP_ThirdPersonPlayerController_C_1 PlayerId=257 Authority=true Local=false OldPawn=000002A680460A00 OldPawnName=BP_ThirdPersonCharacter_C_1 NewPawn=000002A680438400 NewPawnName=BP_AegisObserverPawn_C_1 ControlRotation=R(P=318.93, Y=187.10) ViewTarget=000002A680438400 ViewTargetName=BP_AegisObserverPawn_C_1 PlayerStateWidget=0000000000000000
[2026.08.18-10.09.52:247][861]LogProjectAegis: Display: Possession Event=ObserverPossessCompleted World=000002A6819E8C00 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=000002A67FEC3C00 ControllerName=BP_ThirdPersonPlayerController_C_1 PlayerId=257 Authority=true Local=false OldPawn=000002A680460A00 OldPawnName=BP_ThirdPersonCharacter_C_1 NewPawn=000002A680438400 NewPawnName=BP_AegisObserverPawn_C_1 ControlRotation=R(P=318.93, Y=187.10) ViewTarget=000002A680438400 ViewTargetName=BP_AegisObserverPawn_C_1 PlayerStateWidget=0000000000000000
[2026.08.18-10.09.52:249][861]LogProjectAegis: Display: Character OnRep_Controller. Character=000002A680466400 Controller=0000000000000000
[2026.08.18-10.09.52:249][861]LogProjectAegis: Display: ObserverPawn OnRep_Controller. Pawn=000002A68043C600 Controller=000002A68046C800 NetMode=3 Authority=false
[2026.08.18-10.09.52:316][862]LogProjectAegis: Display: ObserverPawn OnRep_Controller. Pawn=000002A68043C600 Controller=000002A68046C800 NetMode=3 Authority=false
[2026.08.18-10.09.52:316][862]LogProjectAegis: Display: ObserverPawn SetupPlayerInputComponent. Pawn=000002A68043C600 PawnName=BP_AegisObserverPawn_C_1 InputComponent=000002A71933EA80 Controller=000002A68046C800 BoundActionCount=3 NetMode=3 Authority=false Local=true
[2026.08.18-10.09.52:316][862]LogProjectAegis: Display: ObserverPawn PawnClientRestart. Pawn=000002A68043C600 InputComponent=000002A71933EA80 Controller=000002A68046C800 NetMode=3
[2026.08.18-10.10.08:147][248]LogProjectAegis: Display: Possession Event=ToggleRequested World=000002A7563B1C00 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=3 Controller=000002A68046C800 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=257 Authority=false Local=true OldPawn=000002A68043C600 OldPawnName=BP_AegisObserverPawn_C_1 NewPawn=000002A68043C600 NewPawnName=BP_AegisObserverPawn_C_1 ControlRotation=R(P=339.05, Y=158.40) ViewTarget=000002A68043C600 ViewTargetName=BP_AegisObserverPawn_C_1 PlayerStateWidget=000002A79D56B400
[2026.08.18-10.10.08:176][249]LogProjectAegis: Display: ObserverPawn Unpossessed. Pawn=000002A680438400 Name=BP_AegisObserverPawn_C_1 OldController=000002A67FEC3C00 OldControllerName=BP_ThirdPersonPlayerController_C_1 CurrentController=0000000000000000
[2026.08.18-10.10.08:176][249]LogProjectAegis: Display: Possession Event=OnUnPossess World=000002A6819E8C00 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=000002A67FEC3C00 ControllerName=BP_ThirdPersonPlayerController_C_1 PlayerId=257 Authority=true Local=false OldPawn=000002A680438400 OldPawnName=BP_AegisObserverPawn_C_1 NewPawn=0000000000000000 NewPawnName=None ControlRotation=R(P=318.93, Y=187.10) ViewTarget=000002A67FEC3C00 ViewTargetName=BP_ThirdPersonPlayerController_C_1 PlayerStateWidget=0000000000000000
[2026.08.18-10.10.08:176][249]LogProjectAegis: Display: Character PossessedBy. Character=000002A680460A00 NewController=000002A67FEC3C00
[2026.08.18-10.10.08:177][249]LogProjectAegis: Display: Possession Event=OnPossess World=000002A6819E8C00 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=000002A67FEC3C00 ControllerName=BP_ThirdPersonPlayerController_C_1 PlayerId=257 Authority=true Local=false OldPawn=000002A680438400 OldPawnName=BP_AegisObserverPawn_C_1 NewPawn=000002A680460A00 NewPawnName=BP_ThirdPersonCharacter_C_1 ControlRotation=R(Y=-101.33) ViewTarget=000002A680460A00 ViewTargetName=BP_ThirdPersonCharacter_C_1 PlayerStateWidget=0000000000000000
[2026.08.18-10.10.08:177][249]LogProjectAegis: Display: Possession Event=ObserverDestroyed World=000002A6819E8C00 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=000002A67FEC3C00 ControllerName=BP_ThirdPersonPlayerController_C_1 PlayerId=257 Authority=true Local=false OldPawn=000002A680438400 OldPawnName=BP_AegisObserverPawn_C_1 NewPawn=000002A680460A00 NewPawnName=BP_ThirdPersonCharacter_C_1 ControlRotation=R(P=318.93, Y=187.10) ViewTarget=000002A680460A00 ViewTargetName=BP_ThirdPersonCharacter_C_1 PlayerStateWidget=0000000000000000
[2026.08.18-10.10.08:178][249]LogProjectAegis: Display: Character OnRep_Controller. Character=000002A680466400 Controller=000002A68046C800
[2026.08.18-10.10.08:179][249]LogProjectAegis: Display: Character PawnClientRestart. Character=000002A680466400 InputComponent=000002A689AA0E00
[2026.08.18-10.10.26:958][578]LogProjectAegis: Display: Character UnPossessed. Character=000002A680466400 CharacterName=BP_ThirdPersonCharacter_C_0 OldController=000002A68046C800 OldControllerName=BP_ThirdPersonPlayerController_C_0 CurrentController=0000000000000000
[2026.08.18-10.10.26:958][578]LogProjectAegis: Display: Possession Event=OnUnPossess World=000002A7563B1C00 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=3 Controller=000002A68046C800 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=257 Authority=false Local=true OldPawn=000002A680466400 OldPawnName=BP_ThirdPersonCharacter_C_0 NewPawn=0000000000000000 NewPawnName=None ControlRotation=R(P=348.85, Y=142.12) ViewTarget=000002A68046C800 ViewTargetName=BP_ThirdPersonPlayerController_C_0 PlayerStateWidget=000002A79D56B400
[2026.08.18-10.10.26:962][578]LogProjectAegis: Display: Character UnPossessed. Character=000002A61E29B400 CharacterName=BP_ThirdPersonCharacter_C_0 OldController=000002A61E29F000 OldControllerName=BP_ThirdPersonPlayerController_C_0 CurrentController=0000000000000000
[2026.08.18-10.10.26:962][578]LogProjectAegis: Display: Possession Event=OnUnPossess World=000002A6819E8C00 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=000002A61E29F000 ControllerName=BP_ThirdPersonPlayerController_C_0 PlayerId=256 Authority=true Local=true OldPawn=000002A61E29B400 OldPawnName=BP_ThirdPersonCharacter_C_0 NewPawn=0000000000000000 NewPawnName=None ControlRotation=R(P=354.40, Y=112.35) ViewTarget=000002A61E29F000 ViewTargetName=BP_ThirdPersonPlayerController_C_0 PlayerStateWidget=000002A7782AC600
[2026.08.18-10.10.26:964][578]LogProjectAegis: Display: Character UnPossessed. Character=000002A680460A00 CharacterName=BP_ThirdPersonCharacter_C_1 OldController=000002A67FEC3C00 OldControllerName=BP_ThirdPersonPlayerController_C_1 CurrentController=0000000000000000
[2026.08.18-10.10.26:964][578]LogProjectAegis: Display: Possession Event=OnUnPossess World=000002A6819E8C00 WorldName=Lvl_ThirdPerson WorldPath=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=3 NetMode=2 Controller=000002A67FEC3C00 ControllerName=BP_ThirdPersonPlayerController_C_1 PlayerId=257 Authority=true Local=false OldPawn=000002A680460A00 OldPawnName=BP_ThirdPersonCharacter_C_1 NewPawn=0000000000000000 NewPawnName=None ControlRotation=R(P=348.85, Y=142.12) ViewTarget=000002A67FEC3C00 ViewTargetName=BP_ThirdPersonPlayerController_C_1 PlayerStateWidget=0000000000000000
```

- 通过实验可以看到切换时经历了完整的调用链。按下 `Tab` 键后，本地客户端 `PlayerController` 执行 `AProjectAegisPlayerController::HandleToggleObserverPawn()`，再通过 `Server RPC` 请求服务器执行 `AProjectAegisPlayerController::ServerToggleObserverPawn_Implementation()`。如果当前控制的是 `Character`，服务器先通过 `SpawnActor()` 生成 `Observer Pawn`，将原 `Character` 保存到 `ReturnPawn`，再调用 `Possess()`，使原 `Character` 收到 `UnPossessed()`，新 `Observer Pawn` 收到 `PossessedBy()`，并完成服务器上的权威控制关系更新。对于远程玩家，服务器在建立权威控制关系后调用 `ClientRestart()`，同时复制 `Controller` 与 `Pawn` 的关系。拥有者客户端通过 `ClientRestart()`、`OnRep_Pawn()`、`OnRep_Controller()`、`PawnClientRestart()`、`SetupPlayerInputComponent()` 等入口协调本地控制关系并重建输入；这些 `RPC` 与复制回调不能假定以固定顺序到达。返回时，服务器重新 `Possess()` 原 `Character`，确认 `GetPawn() == ReturnTarget` 后才销毁 `Observer Pawn`；拥有者客户端随后根据复制结果恢复 `Character` 的控制关系和输入。

## 验证或作品证据

<video controls playsinline preload="metadata" aria-label="Pawn、Character 与 Possession：从 Character 切换到 Observer Pawn" style="display: block; width: 100%; border-radius: 12px;">
  <source src="/media/ue/day12/day12-pawn-character-possession.mp4" type="video/mp4" />
  当前浏览器不支持视频播放，
  <a href="/media/ue/day12/day12-pawn-character-possession.mp4">请打开视频文件</a>。
</video>

- 视频展示了两人单进程 `Listen Server PIE` 中，主机玩家和远程玩家分别在原 `Character` 与运行时生成的 `Observer Pawn` 之间完成切换和返回。
- 切换到 `Observer Pawn` 后，原 `Character` 仍然存在但不再响应当前玩家输入；`Observer Pawn` 的移动和视角输入正常。
- 返回原 `Character` 后，移动、跳跃和相机均恢复正常，`Observer Pawn` 被销毁。
- 每个本地 `PlayerController` 的 `Widget` 始终只创建一次，没有因为切换 `Pawn` 而重复创建。
- 实验过程中没有出现相关 `Warning`、`Error`、崩溃、断言或输入重复绑定，退出 `PIE` 正常。

## 问题与复盘

### OldPawn 命名遮蔽导致构建失败

- 现象：首次编译时，`ProjectAegisPlayerController.cpp` 中名为 `OldPawn` 的局部变量和函数参数触发了 `C4458`。
- 原因：`UE 5.8` 的 `AController` 基类已经声明了 `TWeakObjectPtr<APawn> OldPawn`，派生类使用同名标识符会遮蔽基类成员；当前工程将该编译器诊断作为错误处理。
- 修正：将项目代码中的函数参数和局部变量重命名为 `PreviousPawn`，日志文本中的 `OldPawn`、`OldPawnName` 字段保持不变，因为它们表达的是事件中的旧 `Pawn`，而不是 `C++` 标识符。
- 验证：修改后 `ProjectAegisEditor Win64 Development` 增量构建成功，`C4458` 消失，且后续两人 `Listen Server PIE` 实验通过。

## 我的理解

- 本次实验选择 `APawn + UFloatingPawnMovement`，是因为观察对象不需要站立角色的胶囊、骨骼和完整行走状态，而且本次实验不要求实现完整的多人网络移动能力，所以使用 `APawn` 和 `UFloatingPawnMovement` 即可。
- 本地按键由本机玩家的 `PlayerController` 接收，移动和视角输入由当前控制的 `Pawn` 执行，最终权威控制关系由服务器的 `Controller` 改变。远程客户端通过复制结果和客户端回调重建当前 `Pawn` 的输入，不能自行决定权威 `Possession`。
- 原 `Character` 在切换后仍然存在，只是解除控制关系，因此不再响应当前玩家输入。`ReturnPawn` 使用弱引用观察返回目标，不额外保活。只有确认重新 `Possess` 成功后才能销毁 `Observer Pawn`。`UI` 由跨 `Pawn` 存在的 `PlayerController` 持有，所以切换过程中只创建一次。

## 下一步

按照计划学习 `Spawn`、重生与初始化状态。
