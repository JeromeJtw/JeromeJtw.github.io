import type { Theme } from 'vitepress'
import { h } from 'vue'
import DefaultTheme from 'vitepress/theme'
import ImageLightbox from './ImageLightbox.vue'
import PhotographyGallery from './PhotographyGallery.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('PhotographyGallery', PhotographyGallery)
  },
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'layout-bottom': () => h(ImageLightbox)
    })
} satisfies Theme
