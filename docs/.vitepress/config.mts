import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid({
  title: 'JeromeJtw · UE 客户端工程',
  description: 'UE C++ 学习路线、Project Aegis、系统设计、调试性能与面试复盘。',
  lang: 'zh-CN',
  base: '/ue-learning-portfolio/',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['drafts/**/*.md'],
  sitemap: {
    hostname: 'https://jeromejtw.github.io/ue-learning-portfolio/'
  },
  head: [
    ['meta', { name: 'theme-color', content: '#0b1220' }],
    ['meta', { name: 'author', content: 'JeromeJtw' }],
    ['link', { rel: 'icon', href: '/ue-learning-portfolio/logo.svg', type: 'image/svg+xml' }]
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
    siteTitle: 'UE Learning Portfolio',
    nav: [
      { text: '首页', link: '/' },
      {
        text: '学习',
        items: [
          { text: '学习路线与进度', link: '/roadmap/' },
          { text: '每日学习日志', link: '/daily/' },
          { text: 'UE 知识体系', link: '/knowledge/' }
        ]
      },
      {
        text: '项目',
        items: [
          { text: 'Project Aegis', link: '/project-aegis/' },
          { text: '系统设计文档', link: '/design/' },
          { text: '演示视频', link: '/videos/' }
        ]
      },
      {
        text: '工程专项',
        items: [
          { text: 'Bug 与排障', link: '/debugging/' },
          { text: 'Unreal Insights', link: '/performance/' },
          { text: 'Lyra / GAS 源码阅读', link: '/source-reading/' }
        ]
      },
      {
        text: '求职',
        items: [
          { text: '面试题与项目复盘', link: '/interviews/' },
          { text: '简历与联系方式', link: '/about/' }
        ]
      }
    ],
    sidebar: {
      '/roadmap/': [
        {
          text: '学习路线与进度',
          items: [{ text: '总览', link: '/roadmap/' }]
        }
      ],
      '/daily/': [
        {
          text: '每日学习日志',
          items: [
            { text: '日志索引', link: '/daily/' },
            { text: '如何写学习博客', link: '/guide/writing' }
          ]
        }
      ],
      '/knowledge/': [
        {
          text: 'UE 知识体系',
          items: [{ text: '知识地图', link: '/knowledge/' }]
        }
      ],
      '/project-aegis/': [
        {
          text: 'Project Aegis',
          items: [{ text: '项目总览', link: '/project-aegis/' }]
        }
      ],
      '/design/': [
        {
          text: '系统设计文档',
          items: [{ text: '设计索引', link: '/design/' }]
        }
      ],
      '/debugging/': [
        {
          text: 'Bug 与排障记录',
          items: [{ text: '问题索引', link: '/debugging/' }]
        }
      ],
      '/performance/': [
        {
          text: 'Unreal Insights',
          items: [{ text: '性能案例索引', link: '/performance/' }]
        }
      ],
      '/source-reading/': [
        {
          text: '源码阅读',
          items: [{ text: 'Lyra / GAS 索引', link: '/source-reading/' }]
        }
      ],
      '/videos/': [
        {
          text: '演示视频',
          items: [{ text: '视频索引', link: '/videos/' }]
        }
      ],
      '/interviews/': [
        {
          text: '面试与复盘',
          items: [{ text: '问题索引', link: '/interviews/' }]
        }
      ],
      '/about/': [
        {
          text: '关于',
          items: [{ text: '简历与联系方式', link: '/about/' }]
        }
      ],
      '/guide/': [
        {
          text: '内容维护',
          items: [{ text: '学习博客写作流程', link: '/guide/writing' }]
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
      pattern: 'https://github.com/JeromeJtw/ue-learning-portfolio/edit/main/docs/:path',
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
      message: '以可运行、可解释、可复现、可测试和可展示为标准。',
      copyright: 'Copyright © 2026 JeromeJtw'
    }
  }
})
