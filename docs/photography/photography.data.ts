import { defineLoader } from 'vitepress'
import { loadPhotographyCollections } from './photography-source'

export default defineLoader({
  watch: ['../public/photography/**/*'],
  load: loadPhotographyCollections
})
