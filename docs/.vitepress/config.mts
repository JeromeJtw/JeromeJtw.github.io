import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid({
  title: 'JeromeJtw · 知识与作品',
  description: 'JeromeJtw 的跨领域学习、工程项目与创作作品网站。',
  lang: 'zh-CN',
  base: '/',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['drafts/**/*.md'],
  sitemap: {
    hostname: 'https://jeromejtw.github.io/'
  },
  head: [
    ['meta', { name: 'theme-color', content: '#0b1220' }],
    ['meta', { name: 'author', content: 'JeromeJtw' }],
    ['link', { rel: 'icon', href: '/logo.svg', type: 'image/svg+xml' }]
  ],
  markdown: {
    lineNumbers: true
  },
  mermaid: {
    securityLevel: 'strict',
    fontFamily: 'Inter, "Microsoft YaHei", sans-serif'
  },
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'JeromeJtw',
    nav: [
      { text: '首页', link: '/' },
      {
        text: '知识领域',
        items: [
          { text: 'UE 客户端工程', link: '/ue/' },
          { text: 'AI / 机器学习与大模型', link: '/ai/' },
          { text: 'C++ 多线程与并发', link: '/concurrency/' },
          { text: '摄影', link: '/photography/' },
          { text: '文学阅读与写作', link: '/writing/' }
        ]
      },
      { text: '学习日志', link: '/journal/' },
      { text: '项目与作品', link: '/projects/' },
      { text: 'UE 面试展示', link: '/ue/showcase/' },
      { text: '关于我', link: '/about/' }
    ],
    sidebar: {
      '/ue/': [
        {
          text: 'UE 客户端工程',
          items: [
            { text: '领域首页', link: '/ue/' },
            { text: '面试展示', link: '/ue/showcase/' },
            { text: '学习路线与进度', link: '/ue/roadmap/' },
            { text: 'UE 知识体系', link: '/ue/knowledge/' }
          ]
        },
        {
          text: '项目与工程实践',
          items: [
            { text: 'Project Aegis', link: '/ue/project-aegis/' },
            { text: '系统设计', link: '/ue/engineering/design/' },
            { text: 'Bug 与排障', link: '/ue/engineering/debugging/' },
            { text: 'Unreal Insights', link: '/ue/engineering/performance/' },
            { text: '演示视频', link: '/ue/videos/' }
          ]
        },
        {
          text: '深度学习与复盘',
          items: [
            { text: 'Lyra / GAS 源码阅读', link: '/ue/source-reading/' },
            { text: 'UE 面试与项目复盘', link: '/ue/interviews/' }
          ]
        }
      ],
      '/ai/': [
        {
          text: 'AI / 机器学习与大模型',
          items: [{ text: '领域首页', link: '/ai/' }]
        }
      ],
      '/concurrency/': [
        {
          text: 'C++ 多线程与并发',
          items: [{ text: '领域首页', link: '/concurrency/' }]
        }
      ],
      '/photography/': [
        {
          text: '摄影',
          items: [{ text: '领域首页', link: '/photography/' }]
        }
      ],
      '/writing/': [
        {
          text: '文学阅读与写作',
          items: [{ text: '领域首页', link: '/writing/' }]
        }
      ],
      '/journal/': [
        {
          text: '学习日志',
          items: [
            { text: '全部日志', link: '/journal/' },
            { text: 'Day 01 · UE 工程基线', link: '/journal/2026-07-14-ue-day01-engineering-baseline' },
            { text: '博客写作流程', link: '/journal/writing' }
          ]
        }
      ],
      '/projects/': [
        {
          text: '项目与作品',
          items: [{ text: '聚合首页', link: '/projects/' }]
        }
      ],
      '/about/': [
        {
          text: '关于我',
          items: [{ text: '简介与联系方式', link: '/about/' }]
        }
      ]
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/JeromeJtw' }
    ],
    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: '搜索',
            buttonAriaLabel: '搜索'
          },
          modal: {
            noResultsText: '没有找到相关内容',
            resetButtonTitle: '清除查询',
            footer: {
              selectText: '选择',
              navigateText: '切换',
              closeText: '关闭'
            }
          }
        }
      }
    },
    editLink: {
      pattern: 'https://github.com/JeromeJtw/JeromeJtw.github.io/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页'
    },
    outline: {
      label: '本页内容',
      level: [2, 3]
    },
    docFooter: {
      prev: '上一篇',
      next: '下一篇'
    },
    lastUpdated: {
      text: '最后更新'
    },
    returnToTopLabel: '返回顶部',
    sidebarMenuLabel: '目录',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色主题',
    darkModeSwitchTitle: '切换到深色主题',
    footer: {
      message: '持续学习，留下可验证的知识、工程与创作证据。',
      copyright: 'Copyright © 2026 JeromeJtw'
    }
  }
})
