import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { validateJournalPublication } from './check-journal-publication.mjs'

const checkerPath = fileURLToPath(new URL('./check-journal-publication.mjs', import.meta.url))

async function writeFixtureFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
}

async function createFixture({ includeSidebarRoute }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'journal-publication-check-'))
  const route = '/journal/2026-07-19-test-entry'

  await Promise.all([
    writeFixtureFile(
      root,
      'docs/journal/2026-07-19-test-entry.md',
      `---\ntitle: "Test entry"\ndate: 2026-07-19\ndomain: ue\ntype: journal\nseries: test-series\nstatus: published\n---\n\n# Test entry\n`
    ),
    writeFixtureFile(root, 'docs/journal/index.md', `# Journal\n\n[Entry](${route})\n`),
    writeFixtureFile(root, 'docs/ue/index.md', `# UE\n\n[Entry](${route})\n`),
    writeFixtureFile(
      root,
      'docs/.vitepress/config.mts',
      `export default {\n  themeConfig: {\n    sidebar: {\n      '/journal/': [\n        { items: [${includeSidebarRoute ? `{ link: '${route}' }` : ''}] }\n      ],\n      '/projects/': []\n    }\n  }\n}\n`
    ),
    writeFixtureFile(root, '.gitignore', '*.mp4\n')
  ])

  return root
}

function runChecker(root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [checkerPath, '--root', root], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (exitCode) => {
      resolve({ exitCode, stderr, stdout })
    })
  })
}

test('完整入口通过发布一致性校验', async () => {
  const root = await createFixture({ includeSidebarRoute: true })

  try {
    const result = await validateJournalPublication(root)
    assert.deepEqual(result.errors, [])
    assert.equal(result.stats.publishedArticles, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('缺少学习日志 Sidebar 入口时返回失败', async () => {
  const root = await createFixture({ includeSidebarRoute: false })

  try {
    const result = await runChecker(root)
    assert.equal(result.exitCode, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /发现 1 个发布完整性问题/)
    assert.match(result.stderr, /Sidebar/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
