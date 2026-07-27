---
title: "UE Day 08：World、Level 与 PIE 多 World 启动链"
description: "通过单人 Standalone 与双人 Listen Server PIE 日志，验证 World 初始化、客户端临时 World Travel、GameInstance 跨 World 关联和 GWorld 上下文风险。"
date: 2026-07-26
domain: ue
type: journal
series: ue-client-roadmap
tags:
  - Unreal Engine 5
  - C++
  - Project Aegis
  - World
  - PIE
status: published
outline: deep
---

# UE Day 08：World、Level 与 PIE 多 World 启动链

## 背景与目标

### 背景

- 在 `UE` 中，存在不同的 `World`，比如 `PIE World`、`Editor World`、`Game World`，需要了解清楚这些 `World` 的职责区分以及对应的启动链，为后续的复杂 `UE` 工程打好基础。
- 普通 `Actor` 或 `GameMode` 只能观察其所属的 `World`，且网络 `Client` 通常不存在权威 `GameMode`，所以无法通过 `Actor`、`GameMode` 来统一观察 `PIE World`、`Editor World`、`Game World`，因此就在模块的 `StartupModule()` 中注册委托，`ShutdownModule()` 中注销对应的委托来完成 `World` 的生命周期日志记录。

### 目标

- 通过 `World` 的 `FWorldDelegates::OnPostWorldInitialization` 回调和 `FWorldDelegates::OnWorldCleanup` 回调进行日志记录，然后进行单人 `Standalone` 和双人 `Listen Server PIE` 实验，观察 `World` 身份、启动与清理过程。
- 掌握为什么在使用 `GetWorld()`，不能仅仅判断是否非空就行，还得了解其 `WorldType`、`GameInstance`、`PIEInstanceId`、`NetMode`，通过这些来确认 `World` 的身份。
- 学会如何区分不同的 `World`；以及 `World` 已经初始化不代表 `Gameplay` 已经 `BeginPlay`。
- 本次不新增 `Gameplay` 功能，不实现跨 `World` 服务，也不长期缓存 `GWorld` 或静态 `UWorld*`。

## 关键概念

### PIE 中如何识别具体 World

- 在 `PIE` 中，同一时刻，不同的有效 `World` 实例可以通过不同地址进行区分；但每次 `PIE` 或地图 `Travel` 都可能更换 `World` 对象。`World` 地址只能表示当前生命周期内的具体对象；`World` 销毁后，地址可能被后续对象重新使用，因此不能将它作为跨 `PIE` 或跨 `Travel` 的稳定身份。
- `UWorld::WorldType` 是 `World` 的类型，有 `EWorldType::Editor`、`EWorldType::PIE`、`EWorldType::Game`；其中 `Editor` 表示编辑器关卡 `World`，`PIE` 表示 `Editor` 内的 `Standalone`、`Listen Server`、`Client PIE World`，`Game` 表示打包游戏、独立游戏进程等真正的 `Game World`。仅仅通过 `WorldType` 不能区分 `Listen Server World` 和 `Client World`，还要依赖 `NetMode`。
- `UWorld::GetPathName()` 可以获取 `World` 的完整路径，可以用于辅助区分 `Editor`、`PIE`、`Game` 以及不同运行时 `World`。`PIE World` 的路径往往是以 `UEDPIE_数字_` 为前缀的，其中数字是 `PIE` 的实例号。
- `UWorld::GetNetMode()` 可以获取 `World` 的 `NetMode`，用于判断 `World` 当前是 `Standalone`、`Listen Server`、`Dedicated Server`，还是 `Client`。
- 从 `UWorld::GetPackage()` 取得 `UPackage` 后，可以调用 `UPackage::GetPIEInstanceID()` 获取 `PIE` 实例号，表示 `PIE` 运行上下文编号，不是 `UWorld` 的唯一生命周期身份。
- `UWorld::GetGameInstance()` 获取的是 `UWorld` 的 `GameInstance`，其说明 `World` 当前关联到哪次游戏实例，同一个 `GameInstance` 可能先后关联不同的 `World`。适合协调跨 `World` 服务，但不是网络共享状态，也不应该成为什么都往里放的万能全局单例。
- `UWorld::IsGameWorld()` 用于判断是不是承载游戏运行的 `World`。
- `UWorld::HasBegunPlay()` 用于判断 `Gameplay` 是否已经进入 `BeginPlay()`，`World` 已经初始化，不代表一定为 `true`。

`GetWorld() != nullptr` 只说明取得了一个 `World` 指针，不能证明它属于目标运行上下文，也不能证明 `Gameplay` 已经开始。实际诊断需要结合 `World` 地址、完整路径、`WorldType`、`NetMode`、`PIEInstanceId`、`GameInstance`、`IsGameWorld()` 和 `HasBegunPlay()`。

### Client 临时 World 与 World Travel

在双人单进程 `Listen Server PIE` 中，`Client` 在进入服务器最终关卡前，会先拥有一个临时的 `Untitled World`，用于连接服务器和等待目标地图，服务器连接成功，且服务器确认了目标地图后，临时的 `World` 会进入 `Cleanup`，这个是正常的 `Travel` 流程，不是错误、崩溃或一次额外的 `Client` 游戏实例。
`UEngine::LoadMap()` 会创建并加载一个新的 `Client World`，用于 `Client` 的最终 `World`。这个新的 `World` 和临时 `World` 地址不一样，是两个不同的 `UWorld` 对象，完整路径也不同，但是新 `World` 会通过 `FWorldContext::OwningGameInstance` 重新关联原来的 `GameInstance`，且 `WorldContext.SetCurrentWorld(NewWorld)` 将新 `World` 设置成当前 `World`，新 `World` 和临时 `World` 拥有相同的 `PIEInstanceId`。
`GameInstance` 归属于一次 `PIE` 游戏实例，其生命周期可以跨越 `World Travel`，但是不代表旧 `World` 中的 `Actor`、`Level`、`Timer` 或裸 `World` 指针也能继续使用，这些对象仍受各自 `World` 生命周期约束。

### 从 World 初始化到 BeginPlay

从 `World` 的初始化到 `BeginPlay`，再到 `EndPlay`，最后 `OnWorldCleanup` 的时间线如下。

```text
OnPostWorldInitialization
        ↓
World 已完成基础初始化，可读取身份信息
        ↓
InitializeActorsForPlay
        ↓
World / Level / Actor 进入 BeginPlay
        ↓
Gameplay 运行
        ↓
EndPlay / BeginTearingDown
        ↓
OnWorldCleanup
```

- `FWorldDelegates::OnPostWorldInitialization` 回调只能说明 `World` 已经完成初始化，此时可以观察 `WorldType`、`NetMode`、地图路径、`GameInstance`、`PersistentLevel` 等信息。但不能以此断定所有 `Actor` 已经完成 `Play` 初始化，也不能断定 `BeginPlay()` 已经开始。
- `HasBegunPlay()` 是判断 `Gameplay` 是否真正开始的重要状态。`GameInstance` 非空和 `HasBegunPlay() == true` 是两个不同的问题。`PIE World` 在 `OnPostWorldInitialization` 时通常已经关联 `GameInstance` 和 `PersistentLevel`，但 `HasBegunPlay()` 仍可能是 `false`，需要等待后续 `Gameplay` 初始化阶段。
- `Editor World` 可以在模块级日志中记录，但它是编辑器上下文，不是正在运行的 `Gameplay` 实例。
- `FWorldDelegates::OnWorldCleanup` 回调表示 `World` 正在进行资源清理阶段。`Gameplay` 的 `EndPlay` 已经发生或正在完成，不能再向该 `World` 注册需要长期运行的 `Gameplay` 回调。需要把它和 `FWorldDelegates::OnPostWorldInitialization` 看成一对“建立观察—清理观察”的生命周期边界。
- `World` 生命周期回调只能证明当前阶段的状态，不能越过状态门槛推断后续阶段已经完成。

## 实践过程

在 `FProjectAegisModule` 的 `StartupModule()` 中注册回调，在 `ShutdownModule()` 中注销回调，之所以这样选择，是因为模块级记录可以观察 `Editor World`（冷启动的时候）和 `PIE World` 的生命周期，而 `Actor` 和 `GameMode` 只能观察对应所属 `World` 的生命周期。代码如下。
在回调中只使用传入的 `UWorld*`，不长期缓存 `GWorld` 或静态 `World` 指针。记录的字段包括：`World` 地址、名称、完整路径、`WorldType`、`NetMode`、`PIEInstanceId`、`IsGameWorld()`、`HasBegunPlay()`、`GameInstance`、`PersistentLevel`，还有 `Cleanup` 阶段的 `SessionEnded` 和 `CleanupResources`，只有这些字段组合起来，才能区分是什么 `World`，处于哪个运行上下文、当前处于哪个生命周期阶段。
通过 `EWorldType::Editor`、`EWorldType::PIE`、`EWorldType::Game` 进行过滤是为了减少无关日志，方便分析。

```cpp
	virtual void StartupModule() override
	{
		FDefaultGameModuleImpl::StartupModule();
    //...

		PostWorldInitializationHandle = FWorldDelegates::OnPostWorldInitialization.AddRaw(this, &FProjectAegisModule::HandlePostWorldInitialization);
		WorldCleanupHandle = FWorldDelegates::OnWorldCleanup.AddRaw(this, &FProjectAegisModule::HandleWorldCleanup);
	}
```

```cpp
	virtual void ShutdownModule() override
	{
		if (PostWorldInitializationHandle.IsValid())
		{
			FWorldDelegates::OnPostWorldInitialization.Remove(PostWorldInitializationHandle);
			PostWorldInitializationHandle.Reset();
		}

		if (WorldCleanupHandle.IsValid())
		{
			FWorldDelegates::OnWorldCleanup.Remove(WorldCleanupHandle);
			WorldCleanupHandle.Reset();
		}

    // ...
		FDefaultGameModuleImpl::ShutdownModule();
	}
```

```cpp
	void HandlePostWorldInitialization(UWorld* World, const UWorld::InitializationValues)
	{
		if (World == nullptr)
		{
			return;
		}

		if (!ShouldLogWorld(World))
		{
			return;
		}

		const UGameInstance* GameInstance = World->GetGameInstance();
		const ULevel* PersistentLevel = World->PersistentLevel;
		UPackage* WorldPackage = World->GetPackage();
		const int32 PIEInstanceId = WorldPackage != nullptr ? WorldPackage->GetPIEInstanceID() : INDEX_NONE;

		UE_LOG(
			LogAegisCore,
			Display,
			TEXT("Aegis World Lifecycle PostInit: World=%p Name=%s Path=%s WorldType=%s NetMode=%s PIEInstanceId=%d IsGameWorld=%s HasBegunPlay=%s GameInstance=%p GameInstanceName=%s PersistentLevel=%p PersistentLevelName=%s"),
			World,
			*GetNameSafe(World),
			*World->GetPathName(),
			LexToString(World->WorldType),
			*ToString(World->GetNetMode()),
			PIEInstanceId,
			World->IsGameWorld() ? TEXT("true") : TEXT("false"),
			World->HasBegunPlay() ? TEXT("true") : TEXT("false"),
			GameInstance,
			*GetNameSafe(GameInstance),
			PersistentLevel,
			*GetNameSafe(PersistentLevel));
	}
```

```cpp
	void HandleWorldCleanup(UWorld* World, bool bSessionEnded, bool bCleanupResources)
	{
		if (World == nullptr)
		{
			return;
		}

		if (!ShouldLogWorld(World))
		{
			return;
		}

		UPackage* WorldPackage = World->GetPackage();
		const int32 PIEInstanceId = WorldPackage != nullptr ? WorldPackage->GetPIEInstanceID() : INDEX_NONE;

		UE_LOG(
			LogAegisCore,
			Display,
			TEXT("Aegis World Lifecycle Cleanup: World=%p Name=%s Path=%s WorldType=%s NetMode=%s PIEInstanceId=%d IsGameWorld=%s HasBegunPlay=%s SessionEnded=%s CleanupResources=%s"),
			World,
			*GetNameSafe(World),
			*World->GetPathName(),
			LexToString(World->WorldType),
			*ToString(World->GetNetMode()),
			PIEInstanceId,
			World->IsGameWorld() ? TEXT("true") : TEXT("false"),
			World->HasBegunPlay() ? TEXT("true") : TEXT("false"),
			bSessionEnded ? TEXT("true") : TEXT("false"),
			bCleanupResources ? TEXT("true") : TEXT("false"));
	}
```

1 人的 `Standalone PIE` 模式日志如下。
```text
[2026.07.26-08.55.45:313][  0]LogProjectAegis: ProjectAegis module StartupModule
[2026.07.26-08.55.45:314][  0]LogAegisCore: ProjectAegis module uses AegisCore log category
[2026.07.26-08.55.48:370][  0]LogAegisCore: Display: Aegis World Lifecycle PostInit: World=00000260135CB600 Name=Untitled Path=/Temp/Untitled_0.Untitled WorldType=Editor NetMode=Standalone PIEInstanceId=-1 IsGameWorld=false HasBegunPlay=false GameInstance=0000000000000000 GameInstanceName=None PersistentLevel=0000026067667800 PersistentLevelName=PersistentLevel
[2026.07.26-08.55.50:490][  0]LogAegisCore: Display: Aegis World Lifecycle Cleanup: World=00000260135CB600 Name=Untitled Path=/Temp/Untitled_0.Untitled WorldType=Editor NetMode=Standalone PIEInstanceId=-1 IsGameWorld=false HasBegunPlay=false SessionEnded=true CleanupResources=true
[2026.07.26-08.55.51:304][  0]LogAegisCore: Display: Aegis World Lifecycle PostInit: World=0000026092F57000 Name=Lvl_ThirdPerson Path=/Game/ThirdPerson/Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=Editor NetMode=Standalone PIEInstanceId=-1 IsGameWorld=false HasBegunPlay=false GameInstance=0000000000000000 GameInstanceName=None PersistentLevel=0000026093F05400 PersistentLevelName=PersistentLevel
[2026.07.26-08.56.13:121][541]LogAegisCore: Display: Aegis World Lifecycle PostInit: World=000002611BDD0000 Name=Lvl_ThirdPerson Path=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=PIE NetMode=Standalone PIEInstanceId=0 IsGameWorld=true HasBegunPlay=false GameInstance=000002609655E880 GameInstanceName=GameInstance_0 PersistentLevel=00000260A4AAC000 PersistentLevelName=PersistentLevel
[2026.07.26-08.56.31:168][791]LogAegisCore: Display: Aegis World Lifecycle Cleanup: World=000002611BDD0000 Name=Lvl_ThirdPerson Path=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=PIE NetMode=Standalone PIEInstanceId=0 IsGameWorld=true HasBegunPlay=false SessionEnded=true CleanupResources=true
```

2 人的 `Listen Server PIE` 模式日志如下。
```text
LogAegisCore: Display: Aegis World Lifecycle PostInit: World=000002609BF55400 Name=Lvl_ThirdPerson Path=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=PIE NetMode=Listen Server PIEInstanceId=0 IsGameWorld=true HasBegunPlay=false GameInstance=000002609BE42A80 GameInstanceName=GameInstance_1 PersistentLevel=00000260B09FC000 PersistentLevelName=PersistentLevel
LogAegisCore: Display: Aegis World Lifecycle PostInit: World=000002609BF5EE00 Name=Untitled Path=/Temp/Untitled_1.Untitled WorldType=PIE NetMode=Client PIEInstanceId=1 IsGameWorld=true HasBegunPlay=false GameInstance=0000025F71C30780 GameInstanceName=GameInstance_2 PersistentLevel=00000260B09F5400 PersistentLevelName=PersistentLevel
LogAegisCore: Display: Aegis World Lifecycle Cleanup: World=000002609BF5EE00 Name=Untitled Path=/Temp/Untitled_1.Untitled WorldType=PIE NetMode=Client PIEInstanceId=1 IsGameWorld=true HasBegunPlay=false SessionEnded=true CleanupResources=true
LogAegisCore: Display: Aegis World Lifecycle PostInit: World=00000260A1D79A00 Name=Lvl_ThirdPerson Path=/Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=PIE NetMode=Client PIEInstanceId=1 IsGameWorld=true HasBegunPlay=false GameInstance=0000025F71C30780 GameInstanceName=GameInstance_2 PersistentLevel=000002609BC6A800 PersistentLevelName=PersistentLevel
LogAegisCore: Display: Aegis World Lifecycle Cleanup: World=00000260A1D79A00 Name=Lvl_ThirdPerson Path=/Game/ThirdPerson/UEDPIE_1_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=PIE NetMode=Client PIEInstanceId=1 IsGameWorld=true HasBegunPlay=false SessionEnded=true CleanupResources=true
LogAegisCore: Display: Aegis World Lifecycle Cleanup: World=000002609BF55400 Name=Lvl_ThirdPerson Path=/Game/ThirdPerson/UEDPIE_0_Lvl_ThirdPerson.Lvl_ThirdPerson WorldType=PIE NetMode=Listen Server PIEInstanceId=0 IsGameWorld=true HasBegunPlay=false SessionEnded=true CleanupResources=true
```

## 验证或作品证据

<video controls playsinline preload="metadata" aria-label="World、Level 与 PIE 多 World 启动链" style="display: block; width: 100%; border-radius: 12px;">
  <source src="/media/ue/day08/day08-world-level-pie.mp4" type="video/mp4" />
  当前浏览器不支持视频播放，
  <a href="/media/ue/day08/day08-world-level-pie.mp4">请打开视频文件</a>。
</video>

上面的视频展示 `Standalone PIE` 实验过程及其日志和 `Listen Server PIE` 实验过程及其日志。

## 问题与复盘

### 双人 Listen Server PIE 中 Client 出现两个 PIE World

在双人 `Listen Server PIE` 日志中，`Client` 先出现临时 `Untitled World`，随后又出现最终关卡 `World`，初看以为是出现异常重复创建 `Client` 的 `World`，后面对比地址、路径、`PIEInstanceId` 和 `GameInstance` 后确认：这是同一个 `Client PIE` 上下文发生 `World Travel`。临时 `World` 的 `Cleanup` 是正常切换过程，不是错误。

## 下一步

学习 `GameInstance` 与 `Subsystem`。
