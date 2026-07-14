---
layout: home

hero:
  name: "JeromeJtw"
  text: "个人知识管理与作品集"
  tagline: "以领域组织知识，以日志记录成长，以项目和作品验证能力。"
  image:
    src: /logo.svg
    alt: JeromeJtw Monogram
  actions:
    - theme: brand
      text: UE 面试展示
      link: /ue/showcase/
    - theme: alt
      text: 浏览知识领域
      link: /ue/
    - theme: alt
      text: 学习日志
      link: /journal/

features:
  - icon: 🧭
    title: 领域优先
    details: UE、AI、并发、摄影与文学拥有独立知识结构，不把不同学科强行塞入同一分类。
  - icon: 🧪
    title: 证据驱动
    details: 技术结论关联代码、日志、Trace、图表、录像或可复现实验，创作内容保留过程与复盘。
  - icon: 🧩
    title: 聚合展示
    details: 全局日志与项目页跨领域聚合，面试时可直接进入聚焦的 UE Showcase。
---

<span class="status-line">当前主线：UE 客户端工程 · Project Aegis</span>

## 知识领域

<div class="portfolio-grid">
  <a class="portfolio-card" href="/ue/">
    <h3>UE 客户端工程</h3>
    <p>构建系统、Gameplay、GAS、AI、网络、资源、测试、性能与源码阅读。</p>
  </a>
  <a class="portfolio-card" href="/ai/">
    <h3>AI / 机器学习与大模型</h3>
    <p>数学基础、机器学习、深度学习、LLM、Agent、RAG 与实验项目。</p>
  </a>
  <a class="portfolio-card" href="/concurrency/">
    <h3>C++ 多线程与并发</h3>
    <p>内存模型、同步原语、锁与无锁结构、任务、协程、调试与性能测试。</p>
  </a>
  <a class="portfolio-card" href="/photography/">
    <h3>摄影</h3>
    <p>曝光、构图、用光、色彩、后期工作流与摄影作品。</p>
  </a>
  <a class="portfolio-card" href="/writing/">
    <h3>文学阅读与写作</h3>
    <p>阅读笔记、叙事、人物、视角、语言、写作练习与作品复盘。</p>
  </a>
  <a class="portfolio-card" href="/projects/">
    <h3>项目与作品</h3>
    <p>跨领域聚合工程项目、实验、摄影作品和文学创作。</p>
  </a>
</div>

## 内容形成方式

```mermaid
flowchart LR
    A["学习与实践"] --> B["本地事实记录"]
    B --> C["领域知识沉淀"]
    C --> D["学习者撰写与复盘"]
    D --> E["项目和作品证据"]
    E --> F["公开展示"]
```

网站只公开经过验证且适合展示的内容。私有凭据、前公司内部信息、许可不明确的资产和大型原始媒体不会进入仓库。
