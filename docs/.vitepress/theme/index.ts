import type { Theme } from 'vitepress'
import { h } from 'vue'
import DefaultTheme from 'vitepress/theme'
import ImageLightbox from './ImageLightbox.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'layout-bottom': () => h(ImageLightbox)
    })
} satisfies Theme
