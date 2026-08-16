<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { withBase } from 'vitepress'
import { data as loadedCollections } from '../../photography/photography.data'

interface PhotographyWork {
  id: string
  src: string
  alt: string
  title: string
  description?: string
}

interface PhotographyCollection {
  name: string
  description?: string
  works: PhotographyWork[]
}

interface CarouselWork extends PhotographyWork {
  collectionName: string
}

const photographyCollections = loadedCollections as PhotographyCollection[]

const props = defineProps<{
  collection?: string
}>()

const activeIndex = ref(0)
const isPointerInside = ref(false)
const hasFocusInside = ref(false)
const prefersReducedMotion = ref(false)
let autoplayTimer: ReturnType<typeof setInterval> | undefined
let reducedMotionQuery: MediaQueryList | undefined

const selectedCollection = computed<PhotographyCollection | undefined>(() =>
  props.collection
    ? photographyCollections.find((collection) => collection.name === props.collection)
    : undefined
)

const allWorks = computed<CarouselWork[]>(() =>
  photographyCollections.flatMap((collection) =>
    collection.works.map((work) => ({
      ...work,
      collectionName: collection.name
    }))
  )
)

const activeWork = computed<CarouselWork | undefined>(() =>
  allWorks.value[activeIndex.value]
)

function collectionLink(name: string): string {
  return withBase(`/photography/collections/${encodeURIComponent(name)}`)
}

function imageSource(src: string): string {
  return withBase(src)
}

function collectionCover(collection: PhotographyCollection): PhotographyWork | undefined {
  return collection.works[0]
}

function showPrevious(): void {
  const workCount = allWorks.value.length
  if (workCount < 2) {
    return
  }

  activeIndex.value = (activeIndex.value - 1 + workCount) % workCount
}

function showNext(): void {
  const workCount = allWorks.value.length
  if (workCount < 2) {
    return
  }

  activeIndex.value = (activeIndex.value + 1) % workCount
}

function stopAutoplay(): void {
  if (autoplayTimer !== undefined) {
    window.clearInterval(autoplayTimer)
    autoplayTimer = undefined
  }
}

function startAutoplay(): void {
  stopAutoplay()
  if (
    props.collection ||
    isPointerInside.value ||
    hasFocusInside.value ||
    prefersReducedMotion.value ||
    allWorks.value.length < 2
  ) {
    return
  }

  autoplayTimer = window.setInterval(showNext, 6000)
}

function handlePointerEnter(): void {
  isPointerInside.value = true
  startAutoplay()
}

function handlePointerLeave(): void {
  isPointerInside.value = false
  startAutoplay()
}

function handleFocusIn(): void {
  hasFocusInside.value = true
  startAutoplay()
}

function handleFocusOut(event: FocusEvent): void {
  const carousel = event.currentTarget
  const nextTarget = event.relatedTarget
  if (
    carousel instanceof HTMLElement &&
    nextTarget instanceof Node &&
    carousel.contains(nextTarget)
  ) {
    return
  }

  hasFocusInside.value = false
  startAutoplay()
}

function handleCarouselKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    showPrevious()
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    showNext()
  }
}

function handleReducedMotionChange(event: MediaQueryListEvent): void {
  prefersReducedMotion.value = event.matches
  startAutoplay()
}

onMounted(() => {
  reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  prefersReducedMotion.value = reducedMotionQuery.matches
  reducedMotionQuery.addEventListener('change', handleReducedMotionChange)
  startAutoplay()
})

onBeforeUnmount(() => {
  stopAutoplay()
  reducedMotionQuery?.removeEventListener('change', handleReducedMotionChange)
})
</script>

<template>
  <article v-if="collection && selectedCollection" class="photography-gallery photography-collection">
    <a class="photography-back-link" :href="withBase('/photography/')">
      <span aria-hidden="true">&larr;</span>
      返回摄影首页
    </a>

    <header class="photography-collection__header">
      <p class="photography-eyebrow">摄影作品集</p>
      <h1>{{ selectedCollection.name }}</h1>
      <p v-if="selectedCollection.description">{{ selectedCollection.description }}</p>
      <span class="photography-count">{{ selectedCollection.works.length }} 幅作品</span>
    </header>

    <div v-if="selectedCollection.works.length" class="photography-work-grid">
      <figure
        v-for="work in selectedCollection.works"
        :key="work.id"
        class="photography-work"
      >
        <img
          :src="imageSource(work.src)"
          :alt="work.alt"
          loading="lazy"
          decoding="async"
        >
        <figcaption>
          <strong>{{ work.title }}</strong>
          <span v-if="work.description">{{ work.description }}</span>
        </figcaption>
      </figure>
    </div>

    <div v-else class="photography-empty-state" role="status">
      <strong>作品整理中</strong>
      <span>这一组作品尚未公开。</span>
    </div>
  </article>

  <article v-else-if="collection" class="photography-gallery photography-collection">
    <div class="photography-empty-state" role="alert">
      <strong>未找到作品集</strong>
      <a :href="withBase('/photography/')">返回摄影首页</a>
    </div>
  </article>

  <div v-else class="photography-gallery photography-gallery-home">
    <section aria-labelledby="photography-collections-title">
      <div class="photography-section-heading">
        <div>
          <p class="photography-eyebrow">按主题浏览</p>
          <h2 id="photography-collections-title">作品集</h2>
        </div>
        <span>{{ photographyCollections.length }} 组</span>
      </div>

      <div class="photography-collection-grid">
        <a
          v-for="item in photographyCollections"
          :key="item.name"
          class="photography-collection-card"
          :href="collectionLink(item.name)"
        >
          <div class="photography-collection-card__media">
            <img
              v-if="collectionCover(item)"
              :src="imageSource(collectionCover(item)!.src)"
              :alt="collectionCover(item)!.alt"
              loading="lazy"
              decoding="async"
            >
            <div v-else class="photography-collection-card__placeholder" aria-hidden="true">
              <span>{{ item.name.slice(0, 1) }}</span>
            </div>
          </div>
          <div class="photography-collection-card__body">
            <div>
              <h3>{{ item.name }}</h3>
              <span>{{ item.works.length }} 幅</span>
            </div>
          </div>
        </a>
      </div>
    </section>

    <section class="photography-carousel-section" aria-labelledby="photography-all-title">
      <div class="photography-section-heading">
        <div>
          <p class="photography-eyebrow">全部作品</p>
          <h2 id="photography-all-title">流动影集</h2>
        </div>
        <span>{{ allWorks.length }} 幅</span>
      </div>

      <div
        v-if="activeWork"
        class="photography-carousel"
        tabindex="0"
        aria-label="全部摄影作品轮播"
        @mouseenter="handlePointerEnter"
        @mouseleave="handlePointerLeave"
        @focusin="handleFocusIn"
        @focusout="handleFocusOut"
        @keydown="handleCarouselKeydown"
      >
        <a
          class="photography-carousel__slide"
          :href="collectionLink(activeWork.collectionName)"
          :aria-label="`查看作品集：${activeWork.collectionName}`"
        >
          <img
            :key="activeWork.id"
            :src="imageSource(activeWork.src)"
            :alt="activeWork.alt"
            decoding="async"
          >
          <div class="photography-carousel__caption">
            <span>{{ activeWork.collectionName }}</span>
            <strong>{{ activeWork.title }}</strong>
          </div>
        </a>

        <div v-if="allWorks.length > 1" class="photography-carousel__controls">
          <button type="button" aria-label="上一幅作品" title="上一幅" @click="showPrevious">
            <span aria-hidden="true">&larr;</span>
          </button>
          <span aria-live="polite">{{ activeIndex + 1 }} / {{ allWorks.length }}</span>
          <button type="button" aria-label="下一幅作品" title="下一幅" @click="showNext">
            <span aria-hidden="true">&rarr;</span>
          </button>
        </div>
      </div>

      <div v-else class="photography-empty-state" role="status">
        <strong>作品整理中</strong>
        <span>作品公开后将在这里汇总展示。</span>
      </div>
    </section>
  </div>
</template>
