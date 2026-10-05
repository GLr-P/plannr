import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: '.', timeout: 120_000, workers: 1, reporter: [['list']], outputDir: '../../test-results/artifacts' })
