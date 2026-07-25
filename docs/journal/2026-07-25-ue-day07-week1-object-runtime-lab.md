---
title: "UE Day 07：Week 1 对象运行模型实验室整合与验证"
description: "将 Week 1 分散的 UObject、GC、Actor 生命周期、Delegate、Timer 和调试实验整合为可发现、可复现、可恢复验证的 LifecycleLab。"
date: 2026-07-25
domain: ue
type: journal
series: ue-client-roadmap
tags:
  - Unreal Engine 5
  - C++
  - Project Aegis
  - Lifecycle
  - Engineering Validation
status: published
outline: deep
---

# UE Day 07：Week 1 对象运行模型实验室整合与验证

## 背景与目标

Day 01 至 Day 06 分别完成了模块与构建工具、反射与 CDO、对象引用与 GC、Actor 与 ActorComponent 生命周期、Delegate、World Timer、控制台命令和断言实验。这些实验已经能够独立运行，但入口、操作方式和验证证据分散在工程代码、第三人称地图、日志和学习记录中。

Day 07 不再增加新的基础机制，而是把前六天的实验整理为一个可展示的 Week 1 里程碑。目标包括：

- 创建独立的 `Lvl_LifecycleLab`，集中展示 Week 1 对象运行模型实验。
- 保留不同实验的职责和生命周期边界，不使用统一管理 Actor 强行耦合所有流程。
- 通过 README、地图分区和控制台命令，让实验入口可以被发现和复现。
- 从 GitHub 全新克隆工程，验证构建、地图、实验和原始第三人称功能。
- 形成里程碑视频，并使用 `v0.1.0` 标签固定已经验收的工程状态。

## LifecycleLab 整合结果

![LifecycleLab Editor 总览](/img/Day0701.png)

实验地图路径为：

```text
/Game/Aegis/Labs/Lvl_LifecycleLab
```

LifecycleLab 将实验组织在同一张地图中，但不同实验仍然使用独立入口。

| 实验区域 | 执行环境 | 主要内容 |
|---|---|---|
| GC Editor | Editor | 强引用、裸指针观察、弱引用、Root 和 Soft Reference |
| Lifecycle PIE | PIE World | Actor/Component 生命周期、Runtime Spawn、单次 Tick、Delegate 和 World Timer |
| Console | PIE World | `aegis.Lifecycle.Dump` 和断言安全入口 |
| Week 1 Reference | Editor | 实验说明、操作顺序和当前里程碑边界 |

### 统一地图不等于统一管理 Actor

GC 实验依赖 `CallInEditor` 按钮，生命周期实验同时覆盖 Editor 和 PIE，Timer 依赖运行中的 World，控制台命令则需要明确的 PIE World。这些功能可以在同一张地图中展示，但并不依赖同一个 Actor 或同一个执行时机。

如果新增一个统一实验管理 Actor，让它在一个按钮或一次 `BeginPlay()` 中执行所有实验，会把互相独立的功能耦合在一起，也会模糊 Editor World 和 PIE World 的边界。因此，LifecycleLab 只负责提供统一的空间入口，不负责把所有实验收敛成一条执行链。

## 验证链路

### 全新克隆恢复验证

本次没有只在原开发目录中验证，而是从 GitHub 创建全新克隆，避免主工程已有的 `Binaries`、`Intermediate`、`Saved` 或未提交状态影响结论。

| 验证项 | 结果 |
|---|---|
| Git LFS 完整性 | 通过 |
| Development Editor 干净构建 | `ExitCode: 0`，`Result: Succeeded` |
| LifecycleLab 加载与 Map Check | 正常，0 错误、0 警告 |
| GC 编辑器实验 | 通过 |
| Lifecycle、Delegate 与 Timer | 通过 |
| Lifecycle Dump | 通过 |
| 断言安全入口 | 通过 |
| 原始第三人称移动、跳跃与相机 | 通过 |
| Editor 正常关闭 | 通过 |
| 关闭后 Git/LFS 状态 | 干净 |

### 对象运行模型证据

GC 实验中，强引用对象在 GC 后仍然有效；裸指针观察对象和弱引用对象进入回收流程，安全观察结果变为无效。Root 对象在 `AddToRoot()` 后存活，在 `RemoveFromRoot()` 后被回收。Soft Reference 在显式加载前只保存资产路径，加载完成后才得到有效对象。

Lifecycle 综合实验覆盖组件初始化、Actor 初始化、组件与 Actor 的 `BeginPlay()`、运行时同步 Spawn、一次 Tick、Health 变化、三类 Delegate、World Timer 和 `EndPlay()` 清理。Timer 在 Actor Tick 关闭后仍然能够触发，说明它由当前 World 的 `FTimerManager` 调度，不依赖 Actor 自己的 Tick。

`aegis.Lifecycle.Dump` 只读取当前 PIE World 中的实验 Actor。Timer 完成后，Dump 显示 Health 已恢复到 100、Actor Tick 已关闭、Timer 不再 Active，证明运行结果与清理状态一致。

断言实验只执行安全入口：`safe` 验证 `check`、`verify` 和 `ensure` 的正常条件，两次 `ensure` 验证失败后流程继续，以及普通 `ensure` 在同一调用点通常只完整报告一次。没有执行会故意中断 Editor 的断言命令。

## 验证或作品证据

<video controls playsinline preload="metadata" aria-label="Week 1 UE C++ 对象运行模型实验室" style="display: block; width: 100%; border-radius: 12px;">
  <source src="/media/ue/day07/Day07_Week1_Object_Runtime_Lab_20260725.mp4" type="video/mp4" />
  当前浏览器不支持视频播放，
  <a href="/media/ue/day07/Day07_Week1_Object_Runtime_Lab_20260725.mp4">请打开视频文件</a>。
</video>

该视频展示了 LifecycleLab 与 Outliner 分区、GC 编辑器实验、Lifecycle/Delegate/Timer 综合 PIE、只读 Dump、断言安全入口，以及原始 `Lvl_ThirdPerson` 的移动、跳跃和相机回归。

最终附注标签为：

```text
v0.1.0
Week 1: UE C++ 对象运行模型实验室
```

## 当前里程碑边界

`v0.1.0` 证明的是 Week 1 对象运行模型实验已经具备可运行、可解释、可复现、可恢复和可展示的证据，不代表 Project Aegis 已经成为完整 Gameplay 项目。

当前尚未进入正式 Gameplay Framework、战斗、动画、GAS、AI、网络同步、性能基线、Cook、Package 或 Shipping 构建验证。这些内容仍需要在后续阶段分别实现和验收。

## 下一步

进入 Week 2 Gameplay Framework，学习并验证 GameMode、GameState、Controller、PlayerState、Pawn、Possess、Subsystem 和 World 生命周期的职责边界。
