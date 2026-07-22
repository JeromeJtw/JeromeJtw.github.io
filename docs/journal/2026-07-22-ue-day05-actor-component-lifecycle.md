---
title: "UE Day 05：Actor 与 Component 生命周期"
description: "通过实验理解 Actor 和 Component 的生命周期边界，以及构造函数，BeginPlay 执行顺序、EndPlay 执行顺序、Tick 效果，以及主动 Destroy、地图 Travel 和退出 PIE 的不同结束路径，还有SpawnActor 的作用等。"
date: 2026-07-22
domain: ue
type: journal
series: ue-client-roadmap
tags:
  - Unreal Engine 5
  - C++
  - Actor
  - Component
  - lifecycle
status: published
outline: deep
---

# UE Day 05：Actor 与 Component 生命周期

## 背景与目标

### 背景

`Actor` 和 `Component` 是 `UE` 工程中非常基础的内容，需要理解清楚各自的生命周期边界，为以后做复杂功能打下基础。

### 目标

- 通过构建实验类 `AAegisLifecycleProbe` 和 `UHealthComponent`，对 `Actor` 和 `Component` 的生命周期边界，以及各自构造函数，`BeginPlay()` 执行顺序，`EndPlay()` 执行顺序，`Tick()` 效果，以及主动 `Destroy`、地图 `Travel` 和退出 `PIE` 的不同结束路径，还有`SpawnActor()`的作用有清晰的认识。
- 理解 `USceneComponent` 的作用。

## 关键概念

### Actor 构造函数

- 构造函数适合承担的职责是设置默认值、创建默认子对象、设置根组件、默认 `Tick` 标志。
- `World` 可能为空。如果当前构造的是 `CDO`，`CDO` 不是关卡中的实际 `Actor`，通常是没有运行时 `Gameplay World` 的。

### OnConstruction

- 复制（编辑器操作）、移动、通过编辑器修改属性、`Spawn`、`Actor` 实例被放置到编辑器中、重新编译蓝图等操作，都可能触发 `OnConstruction()`；具体执行次数会受到操作流程和编辑器的设置影响。
- 适合根据当前实例属性重新构造可重复的结果、调整组件、生成预览、更新材质、尺寸或附件关系。
- 因为可能反复执行，所以逻辑应尽量具有幂等性。不要在这里无条件：累加状态；永久注册重复委托；创建无法清理的全局对象；执行只应该发生一次的 `Gameplay` 行为。

### Component 与 Actor 的初始化顺序

- 当 `Component` 作为 `Actor` 的组件时，`Component` 先执行 `InitializeComponent()`。
- 当 `Actor` 所有的 `Component` 执行完 `InitializeComponent()` 后，执行 `Actor` 的 `PostInitializeComponents()` 可以处理组件之间的关系。
- 执行完 `Actor` 的 `PostInitializeComponents()` 后，就是 `Component` 的 `BeginPlay()`，然后是 `Actor` 的 `BeginPlay()`。
- `InitializeComponent()` 负责单个组件的初始化；`PostInitializeComponents()` 表示 `Actor` 的组件初始化流程已经完成；随后 `Component` 和 `Actor` 进入 `Gameplay` 生命周期。

### Tick

- `UE` 中的 `Tick()` 用于执行逐帧逻辑，类似其他引擎的 `Update()`；但只有对象具备 `Tick` 能力、`Tick` 已经启用并处于有效的 `World` 生命周期中才会执行。
- `Tick` 可以通过 `Tick Interval`、`Tick Group`、暂停策略和运行时开关控制执行频率与时机。

### SpawnActor

- `SpawnActor()` 是 `World` 根据目标 `Class`、`Location`、`Rotation`、`FActorSpawnParameters` 创建新 `Actor`。
- 本次实验没有指定 `Template`，因此新 `Actor` 从对应 `Class`/`CDO` 的默认状态初始化，不会复制来源 `Actor` 的实例属性；随后再应用 `Spawn Transform` 和 `Construction` 流程。
- 本次使用的是已经开始 `Gameplay` 的 `PIE World`，并且不是延迟 `Spawn`。`SpawnActor()` 返回前，新 `Actor` 已同步完成构造、`OnConstruction()`、组件初始化和 `BeginPlay()`，所以新 `Actor` 的 `BeginPlay()` 日志早于写在 `SpawnActor()` 返回后的 `RuntimeSpawn` 日志。

### EndPlay 与 Destroyed

- 显式调用 `Destroy()` 或延迟销毁 `SetLifeSpan()`，销毁路径是 `Destroyed() → Actor EndPlay(Destroyed) → Component EndPlay(Destroyed)`。
- 退出 `PIE` 是 `Actor EndPlay(EndPlayInEditor) → Component EndPlay(EndPlayInEditor)`。
- 地图 `Travel` 是 `Actor EndPlay(LevelTransition) → Component EndPlay(LevelTransition)`。

### USceneComponent

- `UE` 中 `Actor` 的位置、旋转和缩放实际由 `RootComponent` 承载。其中 `RootComponent` 为 `USceneComponent`。

## 实践过程

![Actor Lifecycle实验](/img/Day0501.png)

### 构建生命周期实验类

- 增加 `AAegisLifecycleProbe`，该类继承自 `AActor`，用于观察 `Actor` 的生命周期边界。
- 增加 `UHealthComponent`，该类继承自 `UActorComponent`，用于观察 `Component` 的生命周期边界。
- `UHealthComponent` 作为 `AAegisLifecycleProbe` 的默认子对象，用于观察 `Component` 和 `Actor` 在 `InitializeComponent()`、`PostInitializeComponents()`、`BeginPlay()` 和 `EndPlay()` 中的执行关系。

```cpp
AAegisLifecycleProbe::AAegisLifecycleProbe()
{
	// Actor 具备 Tick 能力，但默认不启动。
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = false;

	// Actor 的 Transform 由场景根组件承载。
	USceneComponent* SceneRoot = CreateDefaultSubobject<USceneComponent>(TEXT("SceneRoot"));
	SetRootComponent(SceneRoot);

	HealthComponent = CreateDefaultSubobject<UHealthComponent>(TEXT("HealthComponent"));

	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("LifecycleProbe Constructor: Actor=%p Class=%s IsClassDefaultObject=%s World=%p HealthComponent=%p"),
		this,
		*GetNameSafe(GetClass()),
		HasAnyFlags(RF_ClassDefaultObject) ? TEXT("true") : TEXT("false"),
		GetWorld(),
		HealthComponent.Get());
}
```

```cpp
UHealthComponent::UHealthComponent()
{
	// 该组件需要在注册后进入 InitializeComponent()。
	bWantsInitializeComponent = true;

	// HealthComponent 不需要每帧更新。
	PrimaryComponentTick.bCanEverTick = false;
	PrimaryComponentTick.bStartWithTickEnabled = false;
}
```
- `USceneComponent` 作为 `RootComponent` 用于承载 `Actor` 的移动、旋转和缩放。
- `UHealthComponent` 将 `bWantsInitializeComponent` 设置为 `true` 是为了组件在注册之后进入到 `InitializeComponent()`，便于证明 `Component` 的 `InitializeComponent()` 执行完之后才会执行 `Actor` 的 `PostInitializeComponents()`。

### 验证编辑器中的 Construction

- 通过实验证明，在 `AAegisLifecycleProbe` 放进编辑器中时，移动、复制时，都有可能执行 `OnConstruction()`。
- 下面就是在移动 `AAegisLifecycleProbe` 时的日志。

```text
> Saved\Logs\ProjectAegis.log:2061:[2026.07.21-12.17.04:479][412]LogAegisCore: Display: LifecycleProbe OnConstruction: Actor=000001BC6FD9E100 Name=AegisLifecycleProbe_UAID_002B67DB26476FF002_1926854471 World=000001BBDC491C00 Transform=Rotation: Pitch 0.000000 Yaw 0.000000 Roll -0.000000
  Saved\Logs\ProjectAegis.log:2062:Translation: 1030.000000 -510.000000 0.000000
  Saved\Logs\ProjectAegis.log:2063:Scale3D: 1.000000 1.000000 1.000000
> Saved\Logs\ProjectAegis.log:2065:[2026.07.21-12.17.04:481][412]LogAegisCore: Display: LifecycleProbe OnConstruction: Actor=000001BC6FD9E100 Name=AegisLifecycleProbe_UAID_002B67DB26476FF002_1926854471 World=000001BBDC491C00 Transform=Rotation: Pitch 0.000000 Yaw 0.000000 Roll -0.000000
  Saved\Logs\ProjectAegis.log:2066:Translation: 1030.000000 -510.000000 0.000000
  Saved\Logs\ProjectAegis.log:2067:Scale3D: 1.000000 1.000000 1.000000
> Saved\Logs\ProjectAegis.log:2073:[2026.07.21-12.17.33:676][263]LogAegisCore: Display: LifecycleProbe OnConstruction: Actor=000001BC6FD9E100 Name=AegisLifecycleProbe_UAID_002B67DB26476FF002_1926854471 World=000001BBDC491C00 Transform=Rotation: Pitch 0.000000 Yaw 0.000000 Roll -0.000000
  Saved\Logs\ProjectAegis.log:2074:Translation: 1360.000000 -510.000000 0.000000
  Saved\Logs\ProjectAegis.log:2075:Scale3D: 1.000000 1.000000 1.000000
```

### 验证 Gameplay 初始化与 Tick

```cpp
void AAegisLifecycleProbe::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);

	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("LifecycleProbe Tick: Actor=%p Name=%s DeltaTime=%.4f EnableSingleTick=%s TickEnabledBeforeDisable=%s"),
		this,
		*GetNameSafe(this),
		DeltaTime,
		bEnableSingleTick ? TEXT("true") : TEXT("false"),
		IsActorTickEnabled() ? TEXT("true") : TEXT("false"));
	SetActorTickEnabled(false);
}
```

``` cpp
PrimaryActorTick.bCanEverTick = true;
PrimaryActorTick.bStartWithTickEnabled = false;
```

- 为了减少每帧开销和日志噪声，`Actor` 保留 `Tick` 能力，但默认不启用 `Tick`；通过实例属性 `bEnableSingleTick` 在 `BeginPlay()` 中决定是否开启。

```cpp
void AAegisLifecycleProbe::BeginPlay()
{
	Super::BeginPlay();

	SetActorTickEnabled(bEnableSingleTick);

	if (AutoDestroyDelay > 0.0f)
	{
		SetLifeSpan(AutoDestroyDelay);
	}

	const bool bHealthComponentHasBegunPlay = IsValid(HealthComponent.Get()) && HealthComponent->HasBegunPlay();

	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("LifecycleProbe BeginPlay: Actor=%p Name=%s World=%p ActorHasBegunPlay=%s HealthComponent=%p HealthComponentHasBegunPlay=%s EnableSingleTick=%s TickEnabled=%s SpawnRuntimeProbe=%s AutoDestroyDelay=%.2f"),
		this,
		*GetNameSafe(this),
		GetWorld(),
		HasActorBegunPlay() ? TEXT("true") : TEXT("false"),
		HealthComponent.Get(),
		bHealthComponentHasBegunPlay ? TEXT("true") : TEXT("false"),
		bEnableSingleTick ? TEXT("true") : TEXT("false"),
		IsActorTickEnabled() ? TEXT("true") : TEXT("false"),
		bSpawnRuntimeProbe ? TEXT("true") : TEXT("false"),
		AutoDestroyDelay);

	if (bSpawnRuntimeProbe)
	{
		// 在 Spawn 前关闭本实例的开关，明确该请求只是消费一次。
		bSpawnRuntimeProbe = false;

		UWorld* World = GetWorld();
		if (IsValid(World))
		{
			const FVector SpawnLocation = GetActorLocation() + GetActorForwardVector() * 200.0f;

			FActorSpawnParameters SpawnParameters;
			SpawnParameters.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;

			AAegisLifecycleProbe* SpawnedProbe = World->SpawnActor<AAegisLifecycleProbe>(
				GetClass(),
				SpawnLocation,
				GetActorRotation(),
				SpawnParameters);

			UE_LOG(
				LogAegisCore,
				Display,
				TEXT("LifecycleProbe RuntimeSpawn: SourceActor=%p SpawnedActor=%p SpawnedName=%s"),
				this,
				SpawnedProbe,
				*GetNameSafe(SpawnedProbe));
		}
	}
}
```

```cpp
void UHealthComponent::BeginPlay()
{
	Super::BeginPlay();

	const AActor* Owner = GetOwner();

	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("HealthComponent BeginPlay: Component=%p Owner=%s OwnerAddress=%p MaxHealth=%.1f CurrentHealth=%.1f"),
		this,
		*GetNameSafe(Owner),
		Owner,
		MaxHealth,
		CurrentHealth);
}
```

- 通过日志分析可以得到，`Component` 先执行 `BeginPlay()`，再是 `Actor` 的 `BeginPlay()`。
- `Actor` 的 `Super::BeginPlay()` 会触发 `Component` 的 `BeginPlay()`，而且在 `Actor` 的 `BeginPlay()` 打印日志的逻辑在 `Super::BeginPlay()` 后面。

```text
Saved\Logs\ProjectAegis.log:2134:[2026.07.21-12.32.09:634][763]LogAegisCore: Display: HealthComponent InitializeComponent: Component=000001FB02557800 Owner=AegisLifecycleProbe_UAID_002B67DB264770F002_1722265647 OwnerAddress=000001FA159F7800 MaxHealth=100.0 CurrentHealth=100.0
Saved\Logs\ProjectAegis.log:2135:[2026.07.21-12.32.09:634][763]LogAegisCore: Display: LifecycleProbe PostInitializeComponents: Actor=000001FA159F7800 Name=AegisLifecycleProbe_UAID_002B67DB264770F002_1722265647 World=000001FA59D76200 HealthComponent=000001FB02557800 Registered=true Initialized=true
Saved\Logs\ProjectAegis.log:2142:[2026.07.21-12.32.09:641][763]LogAegisCore: Display: HealthComponent BeginPlay: Component=000001FB02557800 Owner=AegisLifecycleProbe_UAID_002B67DB264770F002_1722265647 OwnerAddress=000001FA159F7800 MaxHealth=100.0 CurrentHealth=100.0
Saved\Logs\ProjectAegis.log:2143:[2026.07.21-12.32.09:641][763]LogAegisCore: Display: LifecycleProbe BeginPlay: Actor=000001FA159F7800 Name=AegisLifecycleProbe_UAID_002B67DB264770F002_1722265647 World=000001FA59D76200 ActorHasBegunPlay=true HealthComponent=000001FB02557800 HealthComponentHasBegunPlay=true EnableSingleTick=false TickEnabled=false SpawnRuntimeProbe=false AutoDestroyDelay=0.00
```

```text
Saved\Logs\ProjectAegis.log:2237:[2026.07.21-12.37.33:785][256]LogAegisCore: Display: LifecycleProbe BeginPlay: Actor=000001FAEA3D1E00 Name=AegisLifecycleProbe_UAID_002B67DB264770F002_1722265647 World=000001FAEA0AB600 ActorHasBegunPlay=true HealthComponent=000001F971162500 HealthComponentHasBegunPlay=true EnableSingleTick=true TickEnabled=true SpawnRuntimeProbe=false AutoDestroyDelay=0.00
Saved\Logs\ProjectAegis.log:2240:[2026.07.21-12.37.33:788][256]LogAegisCore: Display: LifecycleProbe Tick: Actor=000001FAEA3D1E00 Name=AegisLifecycleProbe_UAID_002B67DB264770F002_1722265647 DeltaTime=0.0502 EnableSingleTick=true TickEnabledBeforeDisable=true
Saved\Logs\ProjectAegis.log:2246:[2026.07.21-12.37.37:668][478]LogAegisCore: Display: LifecycleProbe EndPlay: Actor=000001FAEA3D1E00 Name=AegisLifecycleProbe_UAID_002B67DB264770F002_1722265647 World=000001FAEA0AB600 Reason=EEndPlayReason::EndPlayInEditor ActorHasBegunPlayBeforeSuper=true HealthComponent=000001F971162500 HealthComponentHasBegunPlayBeforeSuper=true TickEnabled=false
```

- 本轮只出现一条 `Tick` 日志，且 `TickEnabledBeforeDisable=true`；执行完成后由 `SetActorTickEnabled(false)` 关闭，因此验证了单次 `Tick` 行为。


### 验证运行时 Spawn

```text
[2026.07.21-12.42.24:605][227]LogAegisCore: Display: HealthComponent BeginPlay: Component=000001FB02554300 Owner=AegisLifecycleProbe_0 OwnerAddress=000001FA67E85F00 MaxHealth=100.0 CurrentHealth=100.0
[2026.07.21-12.42.24:605][227]LogAegisCore: Display: LifecycleProbe BeginPlay: Actor=000001FA67E85F00 Name=AegisLifecycleProbe_0 World=000001FA57A25400 ActorHasBegunPlay=true HealthComponent=000001FB02554300 HealthComponentHasBegunPlay=true EnableSingleTick=false TickEnabled=false SpawnRuntimeProbe=false AutoDestroyDelay=0.00
[2026.07.21-12.42.24:605][227]LogAegisCore: Display: LifecycleProbe RuntimeSpawn: SourceActor=000001FAEACB5F00 SpawnedActor=000001FA67E85F00 SpawnedName=AegisLifecycleProbe_0
[2026.07.21-12.42.32:119][671]LogAegisCore: Display: LifecycleProbe EndPlay: Actor=000001FAEACB5F00 Name=AegisLifecycleProbe_UAID_002B67DB264770F002_1722265647 World=000001FA57A25400 Reason=EEndPlayReason::EndPlayInEditor ActorHasBegunPlayBeforeSuper=true HealthComponent=000001FB02554600 HealthComponentHasBegunPlayBeforeSuper=true TickEnabled=false
[2026.07.21-12.42.32:119][671]LogAegisCore: Display: HealthComponent EndPlay: Component=000001FB02554600 Owner=AegisLifecycleProbe_UAID_002B67DB264770F002_1722265647 OwnerAddress=000001FAEACB5F00 Reason=EEndPlayReason::EndPlayInEditor MaxHealth=100.0 CurrentHealth=100.0
```

- 通过日志可以看到并没有递归 `Spawn`，因为 `bSpawnRuntimeProbe` 默认为 `false`，`SpawnActor()` 不是从当前实例对象中复制属性值，而是从目标 `Class` 的 `CDO` 默认状态初始化。
- 因为实验 `Spawn` 时，是在一个 `Gameplay` 周期内，且 `RuntimeSpawn` 日志在 `SpawnActor()` 后面，所以先看到新 `Actor` 的 `BeginPlay()`，再看到 `RuntimeSpawn`。

### 对比三种结束路径

- 在 `BeginPlay()` 中通过 `AutoDestroyDelay` 调用 `SetLifeSpan()`；寿命到期后引擎触发 `Destroy()`。通过 `cmd` 命令 `open /Game/ThirdPerson/Lvl_ThirdPerson` 触发地图 `Travel`；`PIE` 通过编辑器的按钮完成。

```text
Saved\Logs\ProjectAegis.log:2449:[2026.07.21-12.47.38:549][324]LogAegisCore: Display: LifecycleProbe Destroyed: Actor=000001FAE9CDA500 Name=AegisLifecycleProbe_UAID_002B67DB264770F002_1722265647 World=000001FAF090E000 IsActorBeingDestroyed=true ActorHasBegunPlayBeforeSuper=true HealthComponent=000001FA57A3E200 HealthComponentHasBegunPlayBeforeSuper=true
Saved\Logs\ProjectAegis.log:2450:[2026.07.21-12.47.38:549][324]LogAegisCore: Display: LifecycleProbe EndPlay: Actor=000001FAE9CDA500 Name=AegisLifecycleProbe_UAID_002B67DB264770F002_1722265647 World=000001FAF090E000 Reason=EEndPlayReason::Destroyed ActorHasBegunPlayBeforeSuper=true HealthComponent=000001FA57A3E200 HealthComponentHasBegunPlayBeforeSuper=true TickEnabled=false
Saved\Logs\ProjectAegis.log:2451:[2026.07.21-12.47.38:549][324]LogAegisCore: Display: HealthComponent EndPlay: Component=000001FA57A3E200 Owner=AegisLifecycleProbe_UAID_002B67DB264770F002_1722265647 OwnerAddress=000001FAE9CDA500 Reason=EEndPlayReason::Destroyed MaxHealth=100.0 CurrentHealth=100.0
```

```text
Saved\Logs\ProjectAegis.log:2837:[2026.07.21-12.56.50:494][750]LogAegisCore: Display: LifecycleProbe EndPlay: Actor=000001FAEACBE600 Name=AegisLifecycleProbe_UAID_002B67DB264770F002_1722265647 World=000001FB023AD200 Reason=EEndPlayReason::EndPlayInEditor ActorHasBegunPlayBeforeSuper=true HealthComponent=000001FAE7607D00 HealthComponentHasBegunPlayBeforeSuper=true TickEnabled=false
Saved\Logs\ProjectAegis.log:2838:[2026.07.21-12.56.50:494][750]LogAegisCore: Display: HealthComponent EndPlay: Component=000001FAE7607D00 Owner=AegisLifecycleProbe_UAID_002B67DB264770F002_1722265647 OwnerAddress=000001FAEACBE600 Reason=EEndPlayReason::EndPlayInEditor MaxHealth=100.0 CurrentHealth=100.0
```

```text
Saved\Logs\ProjectAegis.log:2802:[2026.07.21-12.56.35:232][439]LogAegisCore: Display: LifecycleProbe EndPlay: Actor=000001FA6720CD00 Name=AegisLifecycleProbe_UAID_002B67DB264770F002_1722265647 World=000001FAF0903800 Reason=EEndPlayReason::LevelTransition ActorHasBegunPlayBeforeSuper=true HealthComponent=000001FAE7605500 HealthComponentHasBegunPlayBeforeSuper=true TickEnabled=false
Saved\Logs\ProjectAegis.log:2803:[2026.07.21-12.56.35:232][439]LogAegisCore: Display: HealthComponent EndPlay: Component=000001FAE7605500 Owner=AegisLifecycleProbe_UAID_002B67DB264770F002_1722265647 OwnerAddress=000001FA6720CD00 Reason=EEndPlayReason::LevelTransition MaxHealth=100.0 CurrentHealth=100.0
```

- 通过日志分析，可以看到主动触发 `Destroy()`，会经过 `Actor` 的 `Destroyed()`，接着是 `Actor` 的 `EndPlay()`，最后是 `Component` 的 `EndPlay()`，且 `EEndPlayReason` 为 `Destroyed`。
- 通过 `PIE` 退出路径是 `Actor` 的 `EndPlay()`，最后是 `Component` 的 `EndPlay()`，且 `EEndPlayReason` 为 `EndPlayInEditor`。
- 通过地图 `Travel` 退出路径是 `Actor` 的 `EndPlay()`，最后是 `Component` 的 `EndPlay()`，且 `EEndPlayReason` 为 `LevelTransition`。

## 验证或作品证据

<video controls playsinline preload="metadata" aria-label="Actor 和 Component 的 Lifecycle 实验" style="display: block; width: 100%; border-radius: 12px;">
  <source src="/media/ue/day05/Day05_Actor_Component_Lifecycle_20260722.mp4" type="video/mp4" />
  当前浏览器不支持视频播放，
  <a href="/media/ue/day05/Day05_Actor_Component_Lifecycle_20260722.mp4">请打开视频文件</a>。
</video>

- 该录屏展示了相关代码和操作流程，还有相关日志。

## 问题与复盘

### Actor 移动后位置回退

```cpp
USceneComponent* SceneRoot = CreateDefaultSubobject<USceneComponent>(TEXT("SceneRoot"));
SetRootComponent(SceneRoot);
```

- 一开始没有这段 `SetRootComponent`，在编辑器内移动 `Actor` 后，`Actor` 会自动回到原位置。
- 通过查阅资料才明白在 `UE` 中承载`Actor` `Transform` 的 `RootComponent` 是 `USceneComponent`，加上上面这段逻辑之后问题解决。

## 下一步

学习 `Delegate`、`Timer`、日志和断言。
