<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
const closeButton = ref<HTMLButtonElement | null>(null)
const decoratedImages = new Map<HTMLImageElement, OriginalAttributes>()
let lastFocusedElement: HTMLElement | null = null

const isOpen = computed(() => activeImage.value !== null)
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
  activeImage.value = {
    alt: image.alt,
    src: image.currentSrc || image.src
  }
  document.documentElement.classList.add('aegis-image-lightbox-open')
  await nextTick()
  closeButton.value?.focus()
}

function closeImage(restoreFocus = true): void {
  if (!isOpen.value) {
    return
  }

  activeImage.value = null
  document.documentElement.classList.remove('aegis-image-lightbox-open')

  if (restoreFocus && lastFocusedElement?.isConnected) {
    nextTick(() => lastFocusedElement?.focus())
  }
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
    } else if (event.key === 'Tab') {
      event.preventDefault()
      closeButton.value?.focus()
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
        class="aegis-image-lightbox"
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
        <img
          class="aegis-image-lightbox__image"
          :src="activeImage.src"
          :alt="activeImage.alt"
          @click.stop
        >
      </div>
    </Transition>
  </Teleport>
</template>
