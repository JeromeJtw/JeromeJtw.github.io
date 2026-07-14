---
title: C++ 多线程与并发
description: C++ 内存模型、同步、无锁结构、任务系统与性能调试专项。
---

# C++ 多线程与并发

<span class="status-line">专项规划中 · 与 UE 并发能力交叉验证</span>

本领域用于系统补齐多线程的工程实践，不停留在概念了解。后续实验会明确线程安全、竞态、死锁、生命周期、内存可见性和性能测试边界。

## 计划结构

- C++ 内存模型与 happens-before；
- `std::thread`、RAII 与线程生命周期；
- Mutex、Condition Variable、Semaphore 与 Atomic；
- 锁粒度、死锁、活锁和优先级反转；
- Lock-free 数据结构与 ABA 问题；
- Future、Promise、Task 和协程；
- ThreadSanitizer、日志与并发问题复现；
- 性能基准与可扩展性；
- UE Task Graph、Async、线程池与 Gameplay Thread 边界。
