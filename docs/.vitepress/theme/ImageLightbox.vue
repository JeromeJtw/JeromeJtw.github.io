<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vitepress'

interface PreviewImage {
  alt: string
  src: string
}

interface OriginalAttributes {
  ariaLabel: string | null
  role: string | null
  tabindex: string | null
}

const route = useRoute()
const activeImage = ref<PreviewImage | null>(null)
const activeImageIndex = ref(-1)
const navigationImages = shallowRef<HTMLImageElement[]>([])
const dialog = ref<HTMLDivElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const decoratedImages = new Map<HTMLImageElement, OriginalAttributes>()
let lastFocusedElement: HTMLElement | null = null

const isOpen = computed(() => activeImage.value !== null)
const hasNavigation = computed(() =>
  navigationImages.value.length > 1 && activeImageIndex.value >= 0
)
const navigationPosition = computed(() =>
  hasNavigation.value
    ? `${activeImageIndex.value + 1} / ${navigationImages.value.length}`
    : ''
)
const dialogLabel = computed(() =>
  activeImage.value?.alt
    ? `图片预览：${activeImage.value.alt}`
    : '图片预览'
)

function isPreviewableImage(image: HTMLImageElement): boolean {
  return image.closest('.vp-doc') !== null &&
    image.closest('a') === null &&
    image.dataset.lightbox !== 'disabled'
}

function decorateImages(): void {
  document.querySelectorAll<HTMLImageElement>('.vp-doc img').forEach((image) => {
    if (!isPreviewableImage(image) || decoratedImages.has(image)) {
      return
    }

    decoratedImages.set(image, {
      ariaLabel: image.getAttribute('aria-label'),
      role: image.getAttribute('role'),
      tabindex: image.getAttribute('tabindex')
    })

    image.dataset.aegisLightboxReady = 'true'
    image.setAttribute('role', 'button')
    image.setAttribute('tabindex', '0')
    image.setAttribute('aria-label', `查看大图：${image.alt || '文章图片'}`)
  })
}

function restoreDecoratedImages(): void {
  decoratedImages.forEach((attributes, image) => {
    restoreAttribute(image, 'aria-label', attributes.ariaLabel)
    restoreAttribute(image, 'role', attributes.role)
    restoreAttribute(image, 'tabindex', attributes.tabindex)
    delete image.dataset.aegisLightboxReady
  })
  decoratedImages.clear()
}

function restoreAttribute(
  image: HTMLImageElement,
  name: string,
  value: string | null
): void {
  if (value === null) {
    image.removeAttribute(name)
    return
  }

  image.setAttribute(name, value)
}

async function openImage(image: HTMLImageElement): Promise<void> {
  lastFocusedElement = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
  const workGrid = image.closest('.photography-work-grid')
  navigationImages.value = workGrid
    ? Array.from(workGrid.querySelectorAll<HTMLImageElement>('.photography-work > img'))
      .filter(isPreviewableImage)
    : []
  activeImageIndex.value = navigationImages.value.indexOf(image)
  setActiveImage(image)
  document.documentElement.classList.add('aegis-image-lightbox-open')
  await nextTick()
  closeButton.value?.focus()
}

function setActiveImage(image: HTMLImageElement): void {
  activeImage.value = {
    alt: image.alt,
    src: image.currentSrc || image.src
  }
}

function showAdjacentImage(offset: number): void {
  const imageCount = navigationImages.value.length
  if (imageCount < 2 || activeImageIndex.value < 0) {
    return
  }

  activeImageIndex.value = (activeImageIndex.value + offset + imageCount) % imageCount
  setActiveImage(navigationImages.value[activeImageIndex.value])
}

function closeImage(restoreFocus = true): void {
  if (!isOpen.value) {
    return
  }

  const currentImage = activeImageIndex.value >= 0
    ? navigationImages.value[activeImageIndex.value]
    : null
  const focusTarget = currentImage?.isConnected
    ? currentImage
    : lastFocusedElement

  activeImage.value = null
  activeImageIndex.value = -1
  navigationImages.value = []
  lastFocusedElement = null
  document.documentElement.classList.remove('aegis-image-lightbox-open')

  if (restoreFocus && focusTarget?.isConnected) {
    nextTick(() => {
      focusTarget.focus({ preventScroll: true })
      focusTarget.scrollIntoView({ block: 'center', inline: 'nearest' })
    })
  }
}

function trapDialogFocus(event: KeyboardEvent): void {
  const controls = Array.from(
    dialog.value?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []
  )
  if (!controls.length) {
    return
  }

  const focusedIndex = controls.indexOf(document.activeElement as HTMLButtonElement)
  let nextIndex = event.shiftKey ? controls.length - 1 : 0
  if (focusedIndex >= 0) {
    nextIndex = event.shiftKey
      ? (focusedIndex - 1 + controls.length) % controls.length
      : (focusedIndex + 1) % controls.length
  }
  controls[nextIndex]?.focus()
}

function handleDocumentClick(event: MouseEvent): void {
  if (!(event.target instanceof Element)) {
    return
  }

  const image = event.target.closest('img')
  if (!(image instanceof HTMLImageElement) || !isPreviewableImage(image)) {
    return
  }

  event.preventDefault()
  void openImage(image)
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (isOpen.value) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeImage()
    } else if (event.key === 'ArrowLeft' && hasNavigation.value) {
      event.preventDefault()
      showAdjacentImage(-1)
    } else if (event.key === 'ArrowRight' && hasNavigation.value) {
      event.preventDefault()
      showAdjacentImage(1)
    } else if (event.key === 'Tab') {
      event.preventDefault()
      trapDialogFocus(event)
    }
    return
  }

  if (!(event.target instanceof HTMLImageElement) ||
    !isPreviewableImage(event.target) ||
    (event.key !== 'Enter' && event.key !== ' ')) {
    return
  }

  event.preventDefault()
  void openImage(event.target)
}

onMounted(() => {
  decorateImages()
  document.addEventListener('click', handleDocumentClick)
  document.addEventListener('keydown', handleDocumentKeydown)
})

watch(
  () => route.path,
  async () => {
    closeImage(false)
    await nextTick()
    restoreDecoratedImages()
    decorateImages()
  }
)

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick)
  document.removeEventListener('keydown', handleDocumentKeydown)
  closeImage(false)
  restoreDecoratedImages()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="aegis-image-lightbox">
      <div
        v-if="activeImage"
        ref="dialog"
        class="aegis-image-lightbox"
        :class="{ 'aegis-image-lightbox--navigable': hasNavigation }"
        role="dialog"
        aria-modal="true"
        :aria-label="dialogLabel"
        @click.self="closeImage()"
      >
        <button
          ref="closeButton"
          class="aegis-image-lightbox__close"
          type="button"
          aria-label="关闭图片预览"
          title="关闭"
          @click="closeImage()"
        >
          <span aria-hidden="true">&times;</span>
        </button>
        <button
          v-if="hasNavigation"
          class="aegis-image-lightbox__navigation aegis-image-lightbox__navigation--previous"
          type="button"
          aria-label="上一幅作品"
          title="上一幅作品"
          @click="showAdjacentImage(-1)"
        >
          <span aria-hidden="true">&larr;</span>
        </button>
        <img
          class="aegis-image-lightbox__image"
          :src="activeImage.src"
          :alt="activeImage.alt"
          @click.stop
        >
        <span
          v-if="hasNavigation"
          class="aegis-image-lightbox__position"
          aria-live="polite"
        >
          {{ navigationPosition }}
        </span>
        <button
          v-if="hasNavigation"
          class="aegis-image-lightbox__navigation aegis-image-lightbox__navigation--next"
          type="button"
          aria-label="下一幅作品"
          title="下一幅作品"
          @click="showAdjacentImage(1)"
        >
          <span aria-hidden="true">&rarr;</span>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>
