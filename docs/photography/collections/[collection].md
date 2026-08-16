---
title: 摄影作品集
description: 按主题收录的摄影作品。
outline: false
---

<script setup>
import { useData } from 'vitepress'

const { params } = useData()
</script>

<PhotographyGallery :collection="params.collection" />
