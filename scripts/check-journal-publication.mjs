import { access, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const GIT_LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1'
const GIT_LFS_POINTER_MAX_BYTES = 1024
const JOURNAL_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}-.+\.md$/
const ROADMAP_SERIES = 'ue-client-roadmap'

function parseFrontmatter(source, filePath) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)

  if (!match) {
    throw new Error(`${filePath} 缺少有效的 YAML Frontmatter。`)
  }

  const frontmatter = {}

  for (const line of match[1].split(/\r?\n/)) {
    const scalar = line.match(/^([A-Za-z][\w-]*):\s*(.*?)\s*$/)
    if (!scalar || scalar[2] === '') {
      continue
    }

    frontmatter[scalar[1]] = scalar[2].replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2')
  }

  return frontmatter
}

function extractJournalSidebar(configSource) {
  const marker = "'/journal/': ["
  const start = configSource.indexOf(marker)

  if (start === -1) {
    return ''
  }

  const nextSection = configSource.indexOf("\n      '/", start + marker.length)
  return nextSection === -1 ? configSource.slice(start) : configSource.slice(start, nextSection)
}

function extractVideoPaths(source) {
  const paths = new Set()
  const pattern = /<(?:source|video)\b[^>]*\bsrc=["'](\/media\/[^"']+)["'][^>]*>/gi

  for (const match of source.matchAll(pattern)) {
    paths.add(match[1])
  }

  return [...paths]
}

function extractImagePaths(source) {
  const paths = new Set()
  const markdownPattern = /!\[[^\]]*\]\((\/img\/[^)\s]+)(?:\s+["'][^)]*["'])?\)/g
  const htmlPattern = /<img\b[^>]*\bsrc=["'](\/img\/[^"']+)["'][^>]*>/gi

  for (const match of source.matchAll(markdownPattern)) {
    paths.add(match[1])
  }

  for (const match of source.matchAll(htmlPattern)) {
    paths.add(match[1])
  }

  return [...paths]
}

function resolvePublicFile(repoRoot, publicPath) {
  const publicRoot = path.resolve(repoRoot, 'docs/public')
  const relativePath = publicPath.split(/[?#]/, 1)[0].replace(/^\/+/, '')
  const resolvedPath = path.resolve(publicRoot, relativePath)

  if (resolvedPath !== publicRoot && !resolvedPath.startsWith(`${publicRoot}${path.sep}`)) {
    throw new Error(`非法 public 路径：${publicPath}`)
  }

  return resolvedPath
}

async function fileExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function isGitLfsPointer(filePath) {
  const fileStats = await stat(filePath)
  if (fileStats.size > GIT_LFS_POINTER_MAX_BYTES) {
    return false
  }

  const source = await readFile(filePath, 'utf8')
  return source.startsWith(GIT_LFS_POINTER_PREFIX)
}

async function readRequiredFile(filePath, label, errors) {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    errors.push(`${label}不存在或无法读取：${filePath}（${error.message}）`)
    return ''
  }
}

function requireRoute(source, route, label, articleName, errors, stats) {
  stats.entryChecks += 1

  if (!source.includes(route)) {
    errors.push(`${articleName} 缺少${label}入口：${route}`)
  }
}

function getDayNumber(frontmatter, fileName) {
  const titleMatch = frontmatter.title?.match(/\bDay\s+(\d+)\b/i)
  const fileMatch = fileName.match(/day(\d+)/i)
  const value = titleMatch?.[1] ?? fileMatch?.[1]
  return value === undefined ? undefined : Number.parseInt(value, 10)
}

export async function validateJournalPublication(repoRoot) {
  const resolvedRoot = path.resolve(repoRoot)
  const journalDirectory = path.join(resolvedRoot, 'docs/journal')
  const errors = []
  const stats = {
    publishedArticles: 0,
    entryChecks: 0,
    mediaChecks: 0
  }

  let journalEntries
  try {
    journalEntries = await readdir(journalDirectory, { withFileTypes: true })
  } catch (error) {
    return {
      errors: [`学习日志目录不存在或无法读取：${journalDirectory}（${error.message}）`],
      stats
    }
  }

  const journalIndexPath = path.join(journalDirectory, 'index.md')
  const configPath = path.join(resolvedRoot, 'docs/.vitepress/config.mts')
  const gitignorePath = path.join(resolvedRoot, '.gitignore')
  const [journalIndex, configSource, gitignoreSource] = await Promise.all([
    readRequiredFile(journalIndexPath, '学习日志聚合页', errors),
    readRequiredFile(configPath, 'VitePress 配置', errors),
    readRequiredFile(gitignorePath, '.gitignore', errors)
  ])
  const journalSidebar = extractJournalSidebar(configSource)
  const gitignoreLines = new Set(gitignoreSource.split(/\r?\n/).map((line) => line.trim()))
  const roadmapArticles = []

  for (const entry of journalEntries) {
    if (!entry.isFile() || !JOURNAL_FILE_PATTERN.test(entry.name)) {
      continue
    }

    const articlePath = path.join(journalDirectory, entry.name)
    const articleSource = await readRequiredFile(articlePath, '学习日志正文', errors)
    if (articleSource === '') {
      continue
    }

    let frontmatter
    try {
      frontmatter = parseFrontmatter(articleSource, articlePath)
    } catch (error) {
      errors.push(error.message)
      continue
    }

    if (frontmatter.type !== 'journal' || frontmatter.status !== 'published') {
      continue
    }

    stats.publishedArticles += 1
    const articleName = entry.name
    const route = `/journal/${entry.name.slice(0, -path.extname(entry.name).length)}`

    requireRoute(journalIndex, route, '`/journal/` 正文列表', articleName, errors, stats)
    requireRoute(journalSidebar, route, '`/journal/` Sidebar', articleName, errors, stats)

    if (!frontmatter.domain) {
      errors.push(`${articleName} 缺少 domain，无法检查所属领域入口。`)
    } else {
      const domainIndexPath = path.join(resolvedRoot, 'docs', frontmatter.domain, 'index.md')
      const domainIndex = await readRequiredFile(domainIndexPath, `${frontmatter.domain} 领域首页`, errors)
      requireRoute(domainIndex, route, `\`${frontmatter.domain}\` 领域首页`, articleName, errors, stats)
    }

    const videoPaths = extractVideoPaths(articleSource)
    if (/<video\b/i.test(articleSource) && videoPaths.length === 0) {
      errors.push(`${articleName} 包含 <video>，但没有找到本地 /media/ 视频源。`)
    }

    if (videoPaths.length > 0 && frontmatter.domain) {
      const videoIndexPath = path.join(resolvedRoot, 'docs', frontmatter.domain, 'videos/index.md')
      const videoIndex = await readRequiredFile(videoIndexPath, `${frontmatter.domain} 视频索引`, errors)
      requireRoute(videoIndex, route, `\`${frontmatter.domain}\` 视频索引`, articleName, errors, stats)
    }

    for (const videoPath of videoPaths) {
      stats.mediaChecks += 1
      const videoFile = resolvePublicFile(resolvedRoot, videoPath)
      if (!(await fileExists(videoFile))) {
        errors.push(`${articleName} 引用的视频文件不存在：${videoPath}`)
      } else if (await isGitLfsPointer(videoFile)) {
        errors.push(`${articleName} 引用的视频仍是 Git LFS Pointer，构建环境未下载实际对象：${videoPath}`)
      }

      const exception = `!docs/public${videoPath}`
      if (!gitignoreLines.has(exception)) {
        errors.push(`${articleName} 的 MP4 缺少 .gitignore 精确例外：${exception}`)
      }
    }

    for (const imagePath of extractImagePaths(articleSource)) {
      stats.mediaChecks += 1
      const imageFile = resolvePublicFile(resolvedRoot, imagePath)
      if (!(await fileExists(imageFile))) {
        errors.push(`${articleName} 引用的图片文件不存在：${imagePath}`)
      } else if (await isGitLfsPointer(imageFile)) {
        errors.push(`${articleName} 引用的图片仍是 Git LFS Pointer，构建环境未下载实际对象：${imagePath}`)
      }
    }

    if (frontmatter.series === ROADMAP_SERIES) {
      const day = getDayNumber(frontmatter, entry.name)
      if (day === undefined || Number.isNaN(day)) {
        errors.push(`${articleName} 属于 ${ROADMAP_SERIES}，但无法识别 Day 编号。`)
      } else if (frontmatter.domain) {
        roadmapArticles.push({ articleName, day, domain: frontmatter.domain })
      }
    }
  }

  const latestRoadmapByDomain = new Map()
  for (const article of roadmapArticles) {
    const current = latestRoadmapByDomain.get(article.domain)
    if (!current || article.day > current.day) {
      latestRoadmapByDomain.set(article.domain, article)
    }
  }

  for (const [domain, latest] of latestRoadmapByDomain) {
    const roadmapPath = path.join(resolvedRoot, 'docs', domain, 'roadmap/index.md')
    const roadmapSource = await readRequiredFile(roadmapPath, `${domain} 学习路线`, errors)
    const currentDay = String(latest.day).padStart(2, '0')
    const nextDay = String(latest.day + 1).padStart(2, '0')
    const expectedStatus = `Day ${currentDay} 已完成 · 下一步 Day ${nextDay}`
    stats.entryChecks += 1

    if (!roadmapSource.includes(expectedStatus)) {
      errors.push(`${latest.articleName} 是 ${ROADMAP_SERIES} 的最新文章，但路线页缺少状态：${expectedStatus}`)
    }
  }

  return { errors, stats }
}

async function main() {
  const rootFlagIndex = process.argv.indexOf('--root')
  const repoRoot = rootFlagIndex === -1 ? process.cwd() : process.argv[rootFlagIndex + 1]

  if (!repoRoot) {
    console.error('[check:journal] --root 缺少目录参数。')
    process.exitCode = 1
    return
  }

  const { errors, stats } = await validateJournalPublication(repoRoot)

  if (errors.length > 0) {
    console.error(`[check:journal] 失败：发现 ${errors.length} 个发布完整性问题。`)
    for (const error of errors) {
      console.error(`- ${error}`)
    }
    process.exitCode = 1
    return
  }

  console.log(
    `[check:journal] 通过：已验证 ${stats.publishedArticles} 篇已发布日志、` +
      `${stats.entryChecks} 个入口/路线状态和 ${stats.mediaChecks} 个媒体文件。`
  )
}

const isMainModule =
  process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isMainModule) {
  await main()
}
