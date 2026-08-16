import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, parse } from 'node:path'
import { fileURLToPath } from 'node:url'

const photographyRoot = fileURLToPath(new URL('../public/photography/', import.meta.url))
const supportedExtensions = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp'])
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

export interface PhotographyWorkData {
  id: string
  src: string
  alt: string
  title: string
  description?: string
}

export interface PhotographyCollectionData {
  name: string
  description?: string
  works: PhotographyWorkData[]
}

interface PhotographyWorkMetadata {
  title?: string
  alt?: string
  description?: string
}

interface PhotographyCollectionMetadata {
  description?: string
  works: Record<string, PhotographyWorkMetadata>
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value)
}

function workTitle(filename: string): string {
  return parse(filename).name
    .replace(/^\d+[\s._-]+/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(
  value: unknown,
  field: string,
  metadataPath: string
): string | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new Error(`Photography metadata field "${field}" must be a string: ${metadataPath}`)
  }

  return value.trim() || undefined
}

function loadCollectionMetadata(collectionPath: string): PhotographyCollectionMetadata {
  const metadataPath = join(collectionPath, 'collection.json')
  if (!existsSync(metadataPath)) {
    return { works: {} }
  }

  let rawMetadata: unknown
  try {
    const content = readFileSync(metadataPath, 'utf8').replace(/^\uFEFF/, '')
    rawMetadata = JSON.parse(content)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to parse photography metadata: ${metadataPath}\n${reason}`)
  }

  if (!isRecord(rawMetadata)) {
    throw new Error(`Photography metadata root must be an object: ${metadataPath}`)
  }

  const works = Object.create(null) as Record<string, PhotographyWorkMetadata>
  if (rawMetadata.works !== undefined) {
    if (!isRecord(rawMetadata.works)) {
      throw new Error(`Photography metadata field "works" must be an object: ${metadataPath}`)
    }

    Object.entries(rawMetadata.works).forEach(([filename, value]) => {
      if (!isRecord(value)) {
        throw new Error(`Photography metadata for "${filename}" must be an object: ${metadataPath}`)
      }

      works[filename] = {
        title: optionalString(value.title, `works.${filename}.title`, metadataPath),
        alt: optionalString(value.alt, `works.${filename}.alt`, metadataPath),
        description: optionalString(value.description, `works.${filename}.description`, metadataPath)
      }
    })
  }

  return {
    description: optionalString(rawMetadata.description, 'description', metadataPath),
    works
  }
}

export function loadPhotographyCollections(): PhotographyCollectionData[] {
  return readdirSync(photographyRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .sort((left, right) => collator.compare(left.name, right.name))
    .map((directory) => {
      const collectionName = directory.name
      const collectionPath = join(photographyRoot, collectionName)
      const imageFiles = readdirSync(collectionPath, { withFileTypes: true })
        .filter((entry) => entry.isFile() && supportedExtensions.has(extname(entry.name).toLowerCase()))
        .sort((left, right) => collator.compare(left.name, right.name))

      const metadata = loadCollectionMetadata(collectionPath)
      const imageFilenames = new Set(imageFiles.map((file) => file.name))
      Object.keys(metadata.works).forEach((filename) => {
        if (!imageFilenames.has(filename)) {
          throw new Error(
            `Photography metadata references a missing image "${filename}": ${join(collectionPath, 'collection.json')}`
          )
        }
      })

      const works = imageFiles.map((file) => {
        const workMetadata = metadata.works[file.name] ?? {}
        const title = workMetadata.title ?? (workTitle(file.name) || file.name)

        return {
          id: `${collectionName}/${file.name}`,
          src: `/photography/${encodePathSegment(collectionName)}/${encodePathSegment(file.name)}`,
          alt: workMetadata.alt ?? `${collectionName}作品：${title}`,
          title,
          description: workMetadata.description
        }
      })

      return {
        name: collectionName,
        description: metadata.description,
        works
      }
    })
}
