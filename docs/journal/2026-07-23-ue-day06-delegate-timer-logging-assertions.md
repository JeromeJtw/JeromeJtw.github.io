---
title: "UE Day 06：Delegate、Timer、日志与断言"
description: "通过 Project Aegis 实验理解 UE 的原生与动态委托、World Timer、调试控制台命令以及 check、verify、ensure 的使用边界。"
date: 2026-07-23
domain: ue
type: journal
series: ue-client-roadmap
tags:
  - Unreal Engine 5
  - C++
  - Project Aegis
  - Delegate
  - Timer
  - Debugging
status: published
outline: deep
---

# UE Day 06：Delegate、Timer、日志与断言

## 背景与目标

### 背景

`Delegate`、`Timer`、断言都是 `UE` 的基础机制，需要掌握，为后续的复杂功能打好基础。

### 目标

- 掌握原生单播、原生多播和动态多播的使用方法及其使用边界。
- 掌握 `Timer` 的使用方法以及 `Timer` 的工作原理，以及其生命周期的清理方式。
- 掌握 `verify`、`check`、`ensure` 使用场景及其作用。
- 掌握如何在 `UE` 工程中添加控制台命令进行调试。

## 关键概念

### Delegate

委托是 `UE` 提供的回调与事件机制。有监听者和被监听者，被监听者的变化通知监听者，从而监听者可以做出相应的响应。类似设计模式的观察者模式。

| 类型 | 监听者数量 | 返回值 | 是否依赖反射 | 是否支持蓝图 | 绑定与解绑 |
|---|---:|---|---|---|---|
| 原生单播 | 1 个 | 可以定义明确的返回值 | 不依赖 | 不支持 | `BindUObject()` 和 `Unbind()` |
| 原生多播 | 多个 | 不提供返回值 | 不依赖 | 不支持 | `AddUObject()` 和 `RemoveAll(this)` |
| 动态多播 | 多个 | 不提供返回值 | 依赖 | 支持，需配合 `UPROPERTY(BlueprintAssignable)` | `AddDynamic()` 和 `RemoveDynamic()` |

- 多播委托允许多个监听者，监听者的执行顺序和返回值合并方式没有通用语义，因此 `UE` 的多播委托不提供返回值。

#### 动态多播为什么需要 `UFUNCTION()`

- 动态委托保存的是 `UObject` 和反射函数信息，让委托进入 `UE` 的反射或序列化体系。调用时需要经过 `UE` 的反射调用链，因此比纯 `C++` 委托更慢。
- 如果蓝图绑定事件，需要使用 `BlueprintAssignable`。
- `AddDynamic()` 通过函数的反射信息绑定回调，因此回调必须使用 `UFUNCTION()`，让 `UHT` 为它生成反射注册信息。

#### Delegate 的生命周期边界

- 监听对象被真正销毁后，动态委托不会像普通裸函数指针一样继续调用已销毁的 `UObject`。尽管如此，还需要在 `EndPlay()` 中解绑。原因如下。
- `EndPlay()` 不等于对象已经立即销毁，对象可能仍然存在，但已经退出 `Gameplay`
- 可以防止重复绑定。
- 可以明确 “绑定只在 `BeginPlay()` 到 `EndPlay()` 之间有效” 的生命周期契约。

### Timer

`Timer` 是 `UE` 中的定时器，依赖 `World` 中的 `FTimerManager`。`Timer` 的更新和调度都是通过 `World` 的 `FTimerManager` 来完成的。

#### Timer 与 Actor Tick 的关系

是通过 `World` 的 `FTimerManager` 来完成的，不依赖 `Actor` 的 `Tick`，所以即便 `Actor` 的 `Tick` 关闭 `Timer` 仍能执行。

#### `FTimerHandle` 的作用

- `FTimerHandle` 是已注册 `Timer` 的身份和控制句柄。
- 查询 `Timer` 是否 `Active`。
- 暂停或恢复 `Timer`。
- 清除 `Timer`。
- 区分不同的 `Timer`。

#### Timer 的生命周期清理

| 场景 | 退出时 `WasActive` | 结果 |
|---|---|---|
| Timer 已自然到期 | false | 执行 `Timer` 回调，退出时不再等待回调，`ClearTimer()` 完成 `Handle` 清理 |
| Timer 到期前退出 PIE | true | `Timer` 还在等待，`ClearTimer()` 将其取消，之后不再进入回调 |

- 为了防止 `Actor` 退出 `Gameplay` 生命周期之后，仍然收到延迟回调，需要在 `EndPlay()` 中调用 `ClearTimer()`，同时使 `FTimerHandle` 失效，完成注册与清理的生命周期配对。

### 调试控制台命令

调试控制台命令可以在程序运行期间主动触发诊断逻辑，用于查询当前运行状态或验证特定流程，而不需要为了临时排查问题修改正常的 `Gameplay` 逻辑。

#### World 上下文

`Editor` 中可能同时存在 `Editor World`、`PIE World` 等不同的 `World`。调试命令如果需要查询 `Actor` 或运行时状态，应明确限定当前 `World`，避免读取其他 `World` 中的同名对象或错误状态。

#### 参数与过滤

调试命令应该校验参数数量和格式，拒绝存在歧义的调用。名称过滤可以缩小查询范围，减少无关日志，使调试结果更容易阅读和复核。

#### 只读边界

用于状态查询的调试命令应该只观察和输出数据，不应意外修改 `Gameplay` 等状态。状态查询和状态修改最好使用不同的命令或接口，避免调试操作改变被观察的结果。

#### UE 中常用控制台命令委托

| 回调类型 | 自动注册对象 |
|---|---|
| `FConsoleCommandDelegate` | `FAutoConsoleCommand` |
| `FConsoleCommandWithArgsDelegate` | `FAutoConsoleCommand` |
| `FConsoleCommandWithWorldDelegate` | `FAutoConsoleCommandWithWorld` |
| `FConsoleCommandWithWorldAndArgsDelegate` | `FAutoConsoleCommandWithWorldAndArgs` |

### 断言

| 类型 | 适用场景 | 失败后的行为 | 求值与报告边界 |
|---|---|---|---|
| `check` | 程序绝对不允许出现的内部不变量 | 检查启用时失败通常中断程序 | 检查关闭的构建中表达式可能不求值，不能放置必要副作用 |
| `verify` | 需要保留表达式求值，同时希望在开发构建中进行断言检查 | 检查启用时具有断言失败效果；检查关闭时不触发断言，但表达式仍会执行 | 适合表达式本身必须执行的场景 |
| `ensure` | 预期可能失败但希望流程继续的异常状态 | 失败会报告问题，但流程继续执行 | 通常在同一调用点只报告一次 |
| `ensureAlways` | 需要持续报告每次失败的异常状态 | 每次失败都报告问题，但流程继续执行 | 不抑制同一调用点的后续失败报告 |

- 断言用于发现违反程序预期的状态，不等于普通输入校验和错误处理。

#### 为什么不能在 `check` 中放置必要副作用

`check` 主要用于验证内部不变量。检查关闭的构建中，`check` 表达式可能不会执行，因此不能把程序必须完成的操作放入 `check` 表达式。

#### `ensure` 与错误处理的边界

`ensure` 用于报告不符合预期的状态，不是普通输入校验，也不是完整的错误恢复机制。即使 `ensure` 失败后流程继续，后续代码仍然需要根据失败结果处理状态，不能假定对象或数据一定有效。

### 元数据说明符

| 元数据 | 作用 |
|---|---|
| `AllowPrivateAccess = "true"` | 允许蓝图访问 C++ 私有属性，不改变 C++ 访问权限 |
| `DisplayName = "..."` | 修改编辑器显示名称 |
| `ToolTip = "..."` | 修改编辑器悬停提示 |
| `EditCondition = "bEnabled"` | 根据布尔条件控制属性是否可编辑 |
| `EditConditionHides` | 条件不满足时隐藏属性 |
| `InlineEditConditionToggle` | 将布尔条件以内联开关形式显示 |
| `ClampMin = "0"` | 限制编辑器中允许输入的最小值，不替代运行时代码校验 |
| `ClampMax = "100"` | 限制编辑器中允许输入的最大值，不替代运行时代码校验 |
| `UIMin = "0"` | 限制编辑器滑块的最小值 |
| `UIMax = "100"` | 限制编辑器滑块的最大值 |
| `Multiple = "10"` | 要求数值是指定数值的倍数 |
| `Units = "cm"` | 指定数值的单位，并允许编辑器进行单位显示转换 |
| `ForceUnits = "cm"` | 强制使用指定单位，不进行本地化单位转换 |
| `ArrayClamp = "ArrayProperty"` | 将整数限制在数组长度范围内 |
| `EditFixedOrder` | 阻止数组元素被拖动重新排序 |
| `AllowPreserveRatio` | 向向量编辑器提供保持比例的操作 |
| `AllowedClasses = "Texture2D"` | 限制资源选择器中的允许类型 |
| `DisallowedClasses = "Material"` | 限制资源选择器中的禁止类型 |
| `ExactClass` | 只允许精确类型，不允许派生类 |
| `MustImplement = "InterfaceName"` | 要求选择的类实现某个接口 |
| `ObjectMustImplement = "InterfaceName"` | 要求选择的对象实现某个接口 |
| `MetaClass = "BaseClass"` | 限制可选择的类元类型 |
| `MetaStruct = "BaseStruct"` | 限制可选择的结构体元类型 |
| `MakeEditWidget` | 允许在视口中直接编辑向量或变换 |
| `Bitmask` | 将整数显示为位掩码 |
| `BitmaskEnum = "EFlags"` | 使用枚举解释位掩码 |
| `Untracked` | 软对象路径不参与自动资产跟踪、烘焙或重定向处理 |

### 蓝图访问说明符

| 说明符 | 蓝图访问能力 | 典型用途 |
|---|---|---|
| `BlueprintReadWrite` | 蓝图可读、可写 | 允许蓝图直接修改属性 |
| `BlueprintReadOnly` | 蓝图可读、不可写 | 运行时状态、只读观察值 |
| `BlueprintGetter = FunctionName` | 指定蓝图读取属性时使用的函数 | 需要自定义读取逻辑 |
| `BlueprintSetter = FunctionName` | 指定蓝图写入属性时使用的函数 | 需要校验或封装写入逻辑 |
| `BlueprintAssignable`（多播委托属性） | 蓝图可以绑定委托 | 多播委托事件 |
| `BlueprintCallable`（多播委托属性） | 蓝图可以调用委托 | 允许蓝图执行委托 |
| `BlueprintAuthorityOnly`（多播委托属性） | 在蓝图中只接受带 `BlueprintAuthorityOnly` 的事件 | 权威侧事件绑定 |
| `BlueprintPure`（函数） | 没有执行引脚，直接读取或计算结果 | `GetCurrentHealth()`、`GetMaxHealth()`、距离计算 |
| `BlueprintCallable`（函数） | 有执行引脚，调用时机由执行流控制 | `ApplyHealthChange()`、`StartRecovery()`、修改状态 |

### 编辑器可见性和编辑权限

| 说明符 | Details 面板可见 | 是否可编辑 | 作用范围 |
|---|---:|---:|---|
| `EditAnywhere` | 是 | 是 | 默认对象和实例都可以编辑 |
| `EditDefaultsOnly` | 是 | 是 | 只能编辑 Class Defaults，不能编辑实例 |
| `EditInstanceOnly` | 是 | 是 | 只能编辑实例，不能编辑 Class Defaults |
| `VisibleAnywhere` | 是 | 否 | 默认对象和实例都可见，但只读 |
| `VisibleDefaultsOnly` | 是 | 否 | 只在 Class Defaults 中可见，只读 |
| `VisibleInstanceOnly` | 是 | 否 | 只在实例中可见，只读 |

## 实践过程

![委托、Timer、断言实验](/img/Day0601.png)

### HealthComponent 与 Delegate

```cpp
DECLARE_DELEGATE_ThreeParams(
	FOnHealthChangedNativeSingleSignature,
	UHealthComponent*,
	float,
	float);

DECLARE_MULTICAST_DELEGATE_ThreeParams(
	FOnHealthChangedNativeMulticastSignature,
	UHealthComponent*,
	float,
	float);

DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(
	FOnHealthChangedSignature,
	UHealthComponent*, HealthComponent,
	float, OldHealth,
	float, NewHealth);
```

- 增加原生单播 `FOnHealthChangedNativeSingleSignature`、原生多播 `FOnHealthChangedNativeMulticastSignature` 和动态多播 `FOnHealthChangedSignature`。

```cpp
bool UHealthComponent::ApplyHealthChange(float DeltaHealth)
{
	if (!FMath::IsFinite(DeltaHealth))
	{
		return false;
	}

	const float OldHealth = CurrentHealth;
	const float SafeMaxHealth = FMath::Max(0.0f, MaxHealth);
	const float NewHealth = FMath::Clamp(
			OldHealth + DeltaHealth,
			0.0f,
			SafeMaxHealth);

	if (FMath::IsNearlyEqual(OldHealth, NewHealth))
	{
		return false;
	}

	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("UHealthComponent::ApplyHealthChange HealthComponent=%p DeltaHealth=%.1f"),
		this,
		DeltaHealth);

	CurrentHealth = NewHealth;
	OnHealthChangedNativeSingle.ExecuteIfBound(this, OldHealth, CurrentHealth);
	OnHealthChangedNativeMulticast.Broadcast(this, OldHealth, CurrentHealth);
	OnHealthChanged.Broadcast(this, OldHealth, CurrentHealth);
	return true;
}
```

- `ApplyHealthChange()` 先验证输入、Clamp 和判断是否发生变化。如果值没有变化就不广播，避免加入无意义的语义。
- 先写入新的 `Health`，再广播三类 `Delegate`。保证 `Health` 的状态一致性，避免在 `Actor` 中的回调中获取的 `Health` 和广播的不一致。

```cpp
void AAegisLifecycleProbe::BeginPlay()
{
	Super::BeginPlay();

	SetActorTickEnabled(bEnableSingleTick);

	if (IsValid(HealthComponent.Get()))
	{
		if (bEnableNativeDelegateProbe)
		{
			HealthComponent->OnHealthChangedNativeSingle.BindUObject(this, &AAegisLifecycleProbe::HandleNativeSingleHealthChanged);

			HealthComponent->OnHealthChangedNativeMulticast.AddUObject(this, &AAegisLifecycleProbe::HandleNativeMulticastHealthChanged);
		}

		if (bEnableHealthDelegateProbe)
		{
			HealthComponent->OnHealthChanged.AddDynamic(this, &AAegisLifecycleProbe::HandleHealthChanged);
		}

		const bool bShouldApplyHealthChange = bEnableNativeDelegateProbe || bEnableHealthDelegateProbe || bEnableHealthRecoveryTimer;

		if (bShouldApplyHealthChange && !FMath::IsNearlyZero(HealthProbeDelta))
		{
			HealthComponent->ApplyHealthChange(HealthProbeDelta);
		}
    // ....
  }
  // ....
}
```

```cpp
void AAegisLifecycleProbe::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
  // ...
	if (IsValid(HealthComponent.Get()))
	{
		if (bEnableNativeDelegateProbe)
		{
			HealthComponent->OnHealthChangedNativeSingle.Unbind();
			HealthComponent->OnHealthChangedNativeMulticast.RemoveAll(this);
		}

		HealthComponent->OnHealthChanged.RemoveDynamic(this, &AAegisLifecycleProbe::HandleHealthChanged);
	}

	Super::EndPlay(EndPlayReason);
}
```

- Actor 在 `BeginPlay()` 绑定，在 `EndPlay()` 解绑。
- 避免重复绑定，且遵循 “绑定只在 `BeginPlay()` 到 `EndPlay()` 之间有效” 的生命周期契约。

```text
LogAegisCore: Display: LifecycleProbe Constructor: Actor=000001E2A156FA00 Class=AegisLifecycleProbe IsClassDefaultObject=false World=0000000000000000 HealthComponent=000001E1EF489300
LogAegisCore: Display: HealthComponent InitializeComponent: Component=000001E1EF489300 Owner=AegisLifecycleProbe_UAID_002B67DB2647C1F002_1488041903 OwnerAddress=000001E2A156FA00 MaxHealth=100.0 CurrentHealth=100.0
LogAegisCore: Display: LifecycleProbe PostInitializeComponents: Actor=000001E2A156FA00 Name=AegisLifecycleProbe_UAID_002B67DB2647C1F002_1488041903 World=000001E266AC2A00 HealthComponent=000001E1EF489300 Registered=true Initialized=true
LogAegisCore: Display: HealthComponent BeginPlay: Component=000001E1EF489300 Owner=AegisLifecycleProbe_UAID_002B67DB2647C1F002_1488041903 OwnerAddress=000001E2A156FA00 MaxHealth=100.0 CurrentHealth=100.0
LogAegisCore: Display: UHealthComponent::ApplyHealthChange HealthComponent=000001E1EF489300 DeltaHealth=-10.0
LogAegisCore: Display: LifecycleProbe HandleNativeSingleHealthChanged: Actor=000001E2A156FA00 Name=AegisLifecycleProbe_UAID_002B67DB2647C1F002_1488041903 World=000001E266AC2A00 InHealthComponent=000001E1EF489300 OldHealth=100.0 NewHealth=90.0 Delta=-10.0
LogAegisCore: Display: LifecycleProbe HandleNativeMulticastHealthChanged: Actor=000001E2A156FA00 Name=AegisLifecycleProbe_UAID_002B67DB2647C1F002_1488041903 World=000001E266AC2A00 InHealthComponent=000001E1EF489300 OldHealth=100.0 NewHealth=90.0 Delta=-10.0
LogAegisCore: Display: LifecycleProbe HealthChanged: Actor=000001E2A156FA00 Name=AegisLifecycleProbe_UAID_002B67DB2647C1F002_1488041903 World=000001E266AC2A00 InHealthComponent=000001E1EF489300 OldHealth=100.0 NewHealth=90.0 Delta=-10.0
LogAegisCore: Display: LifecycleProbe BeginPlay: Actor=000001E2A156FA00 Name=AegisLifecycleProbe_UAID_002B67DB2647C1F002_1488041903 World=000001E266AC2A00 ActorHasBegunPlay=true HealthComponent=000001E1EF489300 HealthComponentHasBegunPlay=true EnableSingleTick=false TickEnabled=false SpawnRuntimeProbe=false AutoDestroyDelay=0.00
LogAegisCore: Display: LifecycleProbe EndPlay: Actor=000001E2A156FA00 Name=AegisLifecycleProbe_UAID_002B67DB2647C1F002_1488041903 World=000001E266AC2A00 Reason=EEndPlayReason::EndPlayInEditor ActorHasBegunPlayBeforeSuper=true HealthComponent=000001E1EF489300 HealthComponentHasBegunPlayBeforeSuper=true TickEnabled=false
LogAegisCore: Display: HealthComponent EndPlay: Component=000001E1EF489300 Owner=AegisLifecycleProbe_UAID_002B67DB2647C1F002_1488041903 OwnerAddress=000001E2A156FA00 Reason=EEndPlayReason::EndPlayInEditor MaxHealth=100.0 CurrentHealth=90.0
```

- 通过上面的日志可以看到，`Health` 变化之后，绑定的原生单播 `HandleNativeSingleHealthChanged`、原生多播 `HandleNativeMulticastHealthChanged`、动态多播 `HealthChanged` 都收到了回调。

### World Timer 与生命周期清理

```cpp
void AAegisLifecycleProbe::BeginPlay()
{
	Super::BeginPlay();

	SetActorTickEnabled(bEnableSingleTick);

	if (IsValid(HealthComponent.Get()))
	{
    // ...
		const bool bShouldApplyHealthChange = bEnableNativeDelegateProbe || bEnableHealthDelegateProbe || bEnableHealthRecoveryTimer;

		if (bShouldApplyHealthChange && !FMath::IsNearlyZero(HealthProbeDelta))
		{
			HealthComponent->ApplyHealthChange(HealthProbeDelta);
		}

		if (bEnableHealthRecoveryTimer && HealthRecoveryDelay > 0.0f)
		{
			if (UWorld* World = GetWorld())
			{
				World->GetTimerManager().SetTimer(HealthRecoveryTimerHandle, this, &AAegisLifecycleProbe::HandleHealthRecoveryTimerElapsed, HealthRecoveryDelay, false);

				UE_LOG(
					LogAegisCore,
					Display,
					TEXT("LifecycleProbe HealthRecoveryTimer Scheduled: Actor=%p Name=%s World=%p Delay=%.2f RecoveryAmount=%.1f TickEnabled=%s"),
					this,
					*GetNameSafe(this),
					World,
					HealthRecoveryDelay,
					HealthRecoveryAmount,
					IsActorTickEnabled() ? TEXT("true") : TEXT("false"));
			}
		}
	}
}
```

```cpp
void AAegisLifecycleProbe::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	const FString EndPlayReasonString = UEnum::GetValueAsString(EndPlayReason);
	const bool bHealthComponentHasBegunPlay = IsValid(HealthComponent.Get()) && HealthComponent->HasBegunPlay();

	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("LifecycleProbe EndPlay: Actor=%p Name=%s World=%p Reason=%s ActorHasBegunPlayBeforeSuper=%s HealthComponent=%p HealthComponentHasBegunPlayBeforeSuper=%s TickEnabled=%s"),
		this,
		*GetNameSafe(this),
		GetWorld(),
		*EndPlayReasonString,
		HasActorBegunPlay() ? TEXT("true") : TEXT("false"),
		HealthComponent.Get(),
		bHealthComponentHasBegunPlay ? TEXT("true") : TEXT("false"),
		IsActorTickEnabled() ? TEXT("true") : TEXT("false"));

	if (UWorld* World = GetWorld())
	{
		FTimerManager& TimerManager = World->GetTimerManager();
		const bool bWasTimerActive = TimerManager.IsTimerActive(HealthRecoveryTimerHandle);
		TimerManager.ClearTimer(HealthRecoveryTimerHandle);

		UE_LOG(
			LogAegisCore,
			Display,
			TEXT("LifecycleProbe HealthRecoveryTimer Cleared: Actor=%p Name=%s World=%p WasActive=%s"),
			this,
			*GetNameSafe(this),
			World,
			bWasTimerActive ? TEXT("true") : TEXT("false"));
	}
	else
	{
		HealthRecoveryTimerHandle.Invalidate();
	}
  // ...
	Super::EndPlay(EndPlayReason);
}
```

```text
LogAegisCore: Display: LifecycleProbe Constructor: Actor=0000028A7E76B400 Class=AegisLifecycleProbe IsClassDefaultObject=false World=0000000000000000 HealthComponent=0000028A80724F80
LogAegisCore: Display: HealthComponent InitializeComponent: Component=0000028A80724F80 Owner=AegisLifecycleProbe_UAID_002B67DB2647CCF002_2065700839 OwnerAddress=0000028A7E76B400 MaxHealth=100.0 CurrentHealth=100.0
LogAegisCore: Display: LifecycleProbe PostInitializeComponents: Actor=0000028A7E76B400 Name=AegisLifecycleProbe_UAID_002B67DB2647CCF002_2065700839 World=0000028A6F550E00 HealthComponent=0000028A80724F80 Registered=true Initialized=true
LogAegisCore: Display: HealthComponent BeginPlay: Component=0000028A80724F80 Owner=AegisLifecycleProbe_UAID_002B67DB2647CCF002_2065700839 OwnerAddress=0000028A7E76B400 MaxHealth=100.0 CurrentHealth=100.0
LogAegisCore: Display: UHealthComponent::ApplyHealthChange HealthComponent=0000028A80724F80 DeltaHealth=-10.0
LogAegisCore: Display: LifecycleProbe HealthRecoveryTimer Scheduled: Actor=0000028A7E76B400 Name=AegisLifecycleProbe_UAID_002B67DB2647CCF002_2065700839 World=0000028A6F550E00 Delay=1.00 RecoveryAmount=10.0 TickEnabled=false
LogAegisCore: Display: LifecycleProbe BeginPlay: Actor=0000028A7E76B400 Name=AegisLifecycleProbe_UAID_002B67DB2647CCF002_2065700839 World=0000028A6F550E00 ActorHasBegunPlay=true HealthComponent=0000028A80724F80 HealthComponentHasBegunPlay=true EnableSingleTick=false TickEnabled=false SpawnRuntimeProbe=false AutoDestroyDelay=0.00
LogAegisCore: Display: LifecycleProbe HealthRecoveryTimer Fired: Actor=0000028A7E76B400 Name=AegisLifecycleProbe_UAID_002B67DB2647CCF002_2065700839 World=0000028A6F550E00 HealthComponent=0000028A80724F80 RecoveryAmount=10.0 TickEnabled=false
LogAegisCore: Display: UHealthComponent::ApplyHealthChange HealthComponent=0000028A80724F80 DeltaHealth=10.0
LogAegisCore: Display: LifecycleProbe HealthRecoveryTimer Completed: Actor=0000028A7E76B400 HealthBefore=90.0 HealthAfter=100.0 Applied=true
LogAegisCore: Display: LifecycleProbe EndPlay: Actor=0000028A7E76B400 Name=AegisLifecycleProbe_UAID_002B67DB2647CCF002_2065700839 World=0000028A6F550E00 Reason=EEndPlayReason::EndPlayInEditor ActorHasBegunPlayBeforeSuper=true HealthComponent=0000028A80724F80 HealthComponentHasBegunPlayBeforeSuper=true TickEnabled=false
LogAegisCore: Display: LifecycleProbe HealthRecoveryTimer Cleared: Actor=0000028A7E76B400 Name=AegisLifecycleProbe_UAID_002B67DB2647CCF002_2065700839 World=0000028A6F550E00 WasActive=false
LogAegisCore: Display: HealthComponent EndPlay: Component=0000028A80724F80 Owner=AegisLifecycleProbe_UAID_002B67DB2647CCF002_2065700839 OwnerAddress=0000028A7E76B400 Reason=EEndPlayReason::EndPlayInEditor MaxHealth=100.0 CurrentHealth=100.0


LogAegisCore: Display: LifecycleProbe Constructor: Actor=0000028A1BE06400 Class=AegisLifecycleProbe IsClassDefaultObject=false World=0000000000000000 HealthComponent=00000288DA6B0600
LogAegisCore: Display: HealthComponent InitializeComponent: Component=00000288DA6B0600 Owner=AegisLifecycleProbe_UAID_002B67DB2647CCF002_2065700839 OwnerAddress=0000028A1BE06400 MaxHealth=100.0 CurrentHealth=100.0
LogAegisCore: Display: LifecycleProbe PostInitializeComponents: Actor=0000028A1BE06400 Name=AegisLifecycleProbe_UAID_002B67DB2647CCF002_2065700839 World=0000028A6F55EE00 HealthComponent=00000288DA6B0600 Registered=true Initialized=true
LogAegisCore: Display: HealthComponent BeginPlay: Component=00000288DA6B0600 Owner=AegisLifecycleProbe_UAID_002B67DB2647CCF002_2065700839 OwnerAddress=0000028A1BE06400 MaxHealth=100.0 CurrentHealth=100.0
LogAegisCore: Display: UHealthComponent::ApplyHealthChange HealthComponent=00000288DA6B0600 DeltaHealth=-10.0
LogAegisCore: Display: LifecycleProbe HealthRecoveryTimer Scheduled: Actor=0000028A1BE06400 Name=AegisLifecycleProbe_UAID_002B67DB2647CCF002_2065700839 World=0000028A6F55EE00 Delay=10.00 RecoveryAmount=10.0 TickEnabled=false
LogAegisCore: Display: LifecycleProbe BeginPlay: Actor=0000028A1BE06400 Name=AegisLifecycleProbe_UAID_002B67DB2647CCF002_2065700839 World=0000028A6F55EE00 ActorHasBegunPlay=true HealthComponent=00000288DA6B0600 HealthComponentHasBegunPlay=true EnableSingleTick=false TickEnabled=false SpawnRuntimeProbe=false AutoDestroyDelay=0.00
LogAegisCore: Display: LifecycleProbe EndPlay: Actor=0000028A1BE06400 Name=AegisLifecycleProbe_UAID_002B67DB2647CCF002_2065700839 World=0000028A6F55EE00 Reason=EEndPlayReason::EndPlayInEditor ActorHasBegunPlayBeforeSuper=true HealthComponent=00000288DA6B0600 HealthComponentHasBegunPlayBeforeSuper=true TickEnabled=false
LogAegisCore: Display: LifecycleProbe HealthRecoveryTimer Cleared: Actor=0000028A1BE06400 Name=AegisLifecycleProbe_UAID_002B67DB2647CCF002_2065700839 World=0000028A6F55EE00 WasActive=true
LogAegisCore: Display: HealthComponent EndPlay: Component=00000288DA6B0600 Owner=AegisLifecycleProbe_UAID_002B67DB2647CCF002_2065700839 OwnerAddress=0000028A1BE06400 Reason=EEndPlayReason::EndPlayInEditor MaxHealth=100.0 CurrentHealth=90.0
```

- `EnableSingleTick=false` 和 `TickEnabled=false` 证明 `Tick` 关闭，但是 `Timer` 还是执行。
- 通过上面的代码和日志可以看出来 `Timer` 自然到期然后退出时和 `Timer` 还没有到期退出时 `WasActive` 有不同，自然到期是 `false`，没有到期是 `true`。
- 提前退出时 `WasActive=true`，说明 Timer 当时仍在等待；`ClearTimer()` 将其取消，超过原定延迟后也没有出现 `Fired` 和 `Completed`，证明延迟回调没有继续执行。

### 只读调试控制台命令

```cpp
namespace
{
	void DumpAegisLifecycleProbes(const TArray<FString>& Args, UWorld* World)
	{
		if (!IsValid(World))
		{
			UE_LOG(
				LogAegisCore,
				Warning,
				TEXT("Aegis Lifecycle Dump rejected: invalid World."));
			return;
		}

		if (Args.Num() > 1)
		{
			UE_LOG(
				LogAegisCore,
				Warning,
				TEXT("Aegis Lifecycle Dump usage: aegis.Lifecycle.Dump [NameFilter]"));
			return;
		}

		const FString NameFilter = Args.IsEmpty() ? FString() : Args[0];

		UE_LOG(
			LogAegisCore,
			Display,
			TEXT("Aegis Lifecycle Dump Begin: World=%p WorldName=%s Filter=%s"),
			World,
			*GetNameSafe(World),
			NameFilter.IsEmpty() ? TEXT("<none>") : *NameFilter);

		int32 MatchCount = 0;

		for (TActorIterator<AAegisLifecycleProbe> It(World); It; ++It)
		{
			AAegisLifecycleProbe* Probe = *It;

			if (!IsValid(Probe))
			{
				continue;
			}

			if (!NameFilter.IsEmpty() && !Probe->GetName().Contains(NameFilter, ESearchCase::IgnoreCase))
			{
				continue;
			}

			++MatchCount;
			Probe->LogDebugState();
		}

		UE_LOG(
			LogAegisCore,
			Display,
			TEXT("Aegis Lifecycle Dump Complete: World=%p WorldName=%s MatchCount=%d"),
			World,
			*GetNameSafe(World),
			MatchCount);
	}

	FAutoConsoleCommandWithWorldAndArgs GAegisLifecycleDumpCommand(
		TEXT("aegis.Lifecycle.Dump"),
		TEXT("Logs lifecycle probe state in the current World. Usage: aegis.Lifecycle.Dump [NameFilter]"),
		FConsoleCommandWithWorldAndArgsDelegate::CreateStatic(
			&DumpAegisLifecycleProbes));
}
```

```cpp
void AAegisLifecycleProbe::LogDebugState() const
{
	const bool bHealthComponentValid = IsValid(HealthComponent.Get());
	const UWorld* World = GetWorld();

	const bool bRecoveryTimerActive = World != nullptr && World->GetTimerManager().IsTimerActive(HealthRecoveryTimerHandle);

	const float CurrentHealth = bHealthComponentValid ? HealthComponent->GetCurrentHealth() : 0.0f;

	const float MaxHealth = bHealthComponentValid ? HealthComponent->GetMaxHealth() : 0.0f;

	UE_LOG(
		LogAegisCore,
		Display,
		TEXT("Aegis Lifecycle State: Actor=%p Name=%s World=%p WorldName=%s HealthComponent=%p HealthValid=%s CurrentHealth=%.1f MaxHealth=%.1f TickEnabled=%s TimerHandleValid=%s TimerActive=%s"),
		this,
		*GetNameSafe(this),
		World,
		*GetNameSafe(World),
		HealthComponent.Get(),
		bHealthComponentValid ? TEXT("true") : TEXT("false"),
		CurrentHealth,
		MaxHealth,
		IsActorTickEnabled() ? TEXT("true") : TEXT("false"),
		HealthRecoveryTimerHandle.IsValid() ? TEXT("true") : TEXT("false"),
		bRecoveryTimerActive ? TEXT("true") : TEXT("false"));
}
```

```text
LogAegisCore: Display: Aegis Lifecycle Dump Begin: World=00000221EB7EA800 WorldName=Lvl_ThirdPerson Filter=aegislifecycleprobe
LogAegisCore: Display: Aegis Lifecycle State: Actor=00000221C8BD5F00 Name=AegisLifecycleProbe_UAID_002B67DB2647F4F002_1771297879 World=00000221EB7EA800 WorldName=Lvl_ThirdPerson HealthComponent=0000022159D38D00 HealthValid=true CurrentHealth=100.0 MaxHealth=100.0 TickEnabled=false TimerHandleValid=false TimerActive=false
LogAegisCore: Display: Aegis Lifecycle Dump Complete: World=00000221EB7EA800 WorldName=Lvl_ThirdPerson MatchCount=1

LogAegisCore: Display: Aegis Lifecycle Dump Begin: World=00000221EB7EA800 WorldName=Lvl_ThirdPerson Filter=DefinitelyMissing
LogAegisCore: Display: Aegis Lifecycle Dump Complete: World=00000221EB7EA800 WorldName=Lvl_ThirdPerson MatchCount=0

LogAegisCore: Warning: Aegis Lifecycle Dump usage: aegis.Lifecycle.Dump [NameFilter]
```

- 使用 `aegis.Lifecycle.Dump aegislifecycleprobe` 验证忽略大小写的名称匹配，结果为 `MatchCount=1`。
- 使用 `aegis.Lifecycle.Dump DefinitelyMissing` 验证无匹配结果，返回 `MatchCount=0`。
- 使用 `aegis.Lifecycle.Dump one two` 验证参数数量检查，只输出 `usage Warning`，不继续查询状态。

### 断言实验

```cpp
namespace
{
	void RunAegisAssertionProbe(const TArray<FString>& Args)
	{
		if (Args.Num() != 1)
		{
			UE_LOG(
				LogAegisCore,
				Warning,
				TEXT("Aegis Assertion Probe usage: aegis.Assert.Probe <safe|ensure>"));
			return;
		}

		const FString& Mode = Args[0];

		if (Mode.Equals(TEXT("safe"), ESearchCase::IgnoreCase))
		{
			int32 VerifyEvaluationCount = 0;

			// check 表达必须成立的内部不变量，不在表达式中放置必要副作用。
			checkf(VerifyEvaluationCount == 0, TEXT("VerifyEvaluationCount must start at zero."));

			// verify 在关闭检查的构建中仍会求值，因此用计数器观察表达式副作用。
			verifyf(++VerifyEvaluationCount == 1, TEXT("verify expression evaluated an unexpected number of times: %d"), VerifyEvaluationCount);

			const bool bEnsurePassed = ensureMsgf(VerifyEvaluationCount == 1, TEXT("VerifyEvaluationCount should be one after verify. Actual=%d"), VerifyEvaluationCount);

			UE_LOG(
				LogAegisCore,
				Display,
				TEXT("Aegis Assertion Safe Complete: CheckPassed=true VerifyEvaluationCount=%d EnsurePassed=%s DO_CHECK=%d DO_ENSURE=%d"),
				VerifyEvaluationCount,
				bEnsurePassed ? TEXT("true") : TEXT("false"),
				DO_CHECK,
				DO_ENSURE);
			return;
		}

		if (Mode.Equals(TEXT("ensure"), ESearchCase::IgnoreCase))
		{
			static int32 EnsureInvocationCount = 0;
			++EnsureInvocationCount;

			const bool bEnsurePassed = ensureMsgf(
				false,
				TEXT("Intentional Aegis ensure failure. Invocation=%d"),
				EnsureInvocationCount);

			UE_LOG(
				LogAegisCore,
				Display,
				TEXT("Aegis Assertion Ensure Continued: Invocation=%d EnsurePassed=%s Continued=true"),
				EnsureInvocationCount,
				bEnsurePassed ? TEXT("true") : TEXT("false"));
			return;
		}

		UE_LOG(
			LogAegisCore,
			Warning,
			TEXT("Aegis Assertion Probe unknown mode: %s. Usage: aegis.Assert.Probe <safe|ensure>"),
			*Mode);
	}

	FAutoConsoleCommand GAegisAssertionProbeCommand(
		TEXT("aegis.Assert.Probe"),
		TEXT("Run safe or ensure assertion probes. Usage: aegis.Assert.Probe <safe|ensure>"),
		FConsoleCommandWithArgsDelegate::CreateStatic(
			&RunAegisAssertionProbe),
		ECVF_Cheat);
}
```

```text
LogAegisCore: Display: Aegis Assertion Safe Complete: CheckPassed=true VerifyEvaluationCount=1 EnsurePassed=true DO_CHECK=1 DO_ENSURE=1
```

- `aegis.Assert.Probe safe` 命令的结果。

```text
LogAegisCore: Display: Aegis Assertion Ensure Continued: Invocation=1 EnsurePassed=false Continued=true
LogAegisCore: Display: Aegis Assertion Ensure Continued: Invocation=2 EnsurePassed=false Continued=true
```

- 连续执行两次 `aegis.Assert.Probe ensure`，两次都返回 `EnsurePassed=false` 并继续执行；只有第一次输出完整的 `Handled Ensure` 报告和调用栈，第二次没有重复完整报告，符合普通 `ensure` 在同一调用点通常只完整报告一次的行为。

## 验证或作品证据

<video controls playsinline preload="metadata" aria-label="委托、Timer、断言实验" style="display: block; width: 100%; border-radius: 12px;">
  <source src="/media/ue/day06/Day06_Delegate_Timer_Console_Assertions_20260723.mp4" type="video/mp4" />
  当前浏览器不支持视频播放，
  <a href="/media/ue/day06/Day06_Delegate_Timer_Console_Assertions_20260723.mp4">请打开视频文件</a>。
</video>

- 该录屏展示了三类 `Delegate` 的绑定与回调、`Actor Tick` 关闭时的 `World Timer`、`Timer` 提前清理、只读调试控制台命令，以及 `check`、`verify`、`ensure` 的安全实验。

## 问题与复盘

### 误用不存在的 `FAutoConsoleCommandWithArgs`

#### 现象

出现如下编译错误。

```text
[1/4] Compile [x64] AegisAssertionProbe.cpp
D:\StudyUE\ProjectAegis\Source\ProjectAegis\AegisAssertionProbe.cpp(71,2): error C4430: 缺少类型说明符 - 假定为 int。注意: C++ 不支持默认 int
        FAutoConsoleCommandWithArgs GAegisAssertionProbeCommand(
        ^
D:\StudyUE\ProjectAegis\Source\ProjectAegis\AegisAssertionProbe.cpp(71,30): error C2146: 语法错误: 缺少“;”(在标识符“GAegisAssertionProbeCommand”的前面)
        FAutoConsoleCommandWithArgs GAegisAssertionProbeCommand(
```

#### 根因

```cpp
FAutoConsoleCommandWithArgs GAegisAssertionProbeCommand(
	TEXT("aegis.Assert.Probe"),
	TEXT("Run safe or ensure assertion probes. Usage: aegis.Assert.Probe <safe|ensure>"),
	FConsoleCommandWithArgsDelegate::CreateStatic(
		&RunAegisAssertionProbe),
	ECVF_Cheat);
```

- 使用了 `UE 5.8` 不存在的 `FAutoConsoleCommandWithArgs`。

#### 解决方式

```cpp
FAutoConsoleCommand GAegisAssertionProbeCommand(
	TEXT("aegis.Assert.Probe"),
	TEXT("Run safe or ensure assertion probes. Usage: aegis.Assert.Probe <safe|ensure>"),
	FConsoleCommandWithArgsDelegate::CreateStatic(
		&RunAegisAssertionProbe),
	ECVF_Cheat);
```

- 将 `FAutoConsoleCommandWithArgs` 改为 `FAutoConsoleCommand` 即可。

#### 后续经验

| 回调类型 | 自动注册对象 |
|---|---|
| `FConsoleCommandDelegate` | `FAutoConsoleCommand` |
| `FConsoleCommandWithArgsDelegate` | `FAutoConsoleCommand` |
| `FConsoleCommandWithWorldDelegate` | `FAutoConsoleCommandWithWorld` |
| `FConsoleCommandWithWorldAndArgsDelegate` | `FAutoConsoleCommandWithWorldAndArgs` |

## 下一步

周整合与基础面试复盘
