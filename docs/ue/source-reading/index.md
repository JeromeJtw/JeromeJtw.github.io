---
title: Lyra / GAS 源码阅读
description: 从调用入口、数据流和项目落点理解源码。
---

# Lyra / GAS 源码阅读

本栏目用于记录 Lyra、Gameplay Ability System 和 UE 引擎源码的调用链阅读。

## 阅读方法

1. 从 Project Aegis 中遇到的具体问题出发；
2. 找到公开入口和关键类型；
3. 沿真实调用关系阅读，而不是只按类名猜测；
4. 记录所有权、生命周期、线程和网络边界；
5. 将结论映射回项目实验；
6. 标注引擎版本与源码路径。

## 计划主题

- 模块加载与 UBT/UHT；
- UObject、反射、CDO 与 GC；
- Gameplay Framework；
- Ability 激活、Effect、Tag 与预测；
- Lyra Experience、Pawn Data 和组件化玩法；
- 网络移动与复制；
- 资源管理和异步加载。
