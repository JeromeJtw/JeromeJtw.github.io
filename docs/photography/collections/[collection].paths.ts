import { loadPhotographyCollections } from '../photography-source'

export default {
  paths() {
    return loadPhotographyCollections().map((collection) => ({
      params: { collection: collection.name }
    }))
  }
}
