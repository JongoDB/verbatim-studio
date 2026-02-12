/**
 * Bootstrap module for copying bundled models to HuggingFace cache on first launch.
 *
 * The app bundles whisper-base and pyannote models in extraResources for offline use.
 * This module copies them to the appropriate cache locations if they don't exist.
 */

import { app } from 'electron';
import * as fs from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import * as path from 'path';

// Model definitions - which models are bundled and where they go
// Pyannote/diarization models require HF auth and are downloaded on first use.
// macOS uses MLX-format models, Windows uses CTranslate2-format models
const BUNDLED_MODELS = process.platform === 'win32'
  ? [
      {
        name: 'whisper-base-ct2',
        source: 'whisper-models/huggingface/hub/models--Systran--faster-whisper-base',
        destination: 'huggingface/hub/models--Systran--faster-whisper-base',
      },
      {
        name: 'nomic-embed-text-v1.5',
        source: 'embedding-models/huggingface/hub/models--nomic-ai--nomic-embed-text-v1.5',
        destination: 'huggingface/hub/models--nomic-ai--nomic-embed-text-v1.5',
      },
    ]
  : [
      {
        name: 'whisper-base-mlx',
        source: 'whisper-models/huggingface/hub/models--mlx-community--whisper-base-mlx',
        destination: 'huggingface/hub/models--mlx-community--whisper-base-mlx',
      },
    ];

/**
 * Get the user's cache directory for models.
 */
function getCacheDir(): string {
  return path.join(app.getPath('home'), '.cache');
}

/**
 * Recursively copy a directory using async operations.
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Check if a model is already installed.
 */
function isModelInstalled(destDir: string): boolean {
  if (!existsSync(destDir)) {
    return false;
  }

  // For HuggingFace models, check for snapshots directory with content
  const snapshotsDir = path.join(destDir, 'snapshots');
  if (existsSync(snapshotsDir)) {
    const snapshots = readdirSync(snapshotsDir);
    return snapshots.length > 0;
  }

  // For torch/pyannote models, just check if directory has files
  const files = readdirSync(destDir);
  return files.length > 0;
}

/**
 * Bootstrap bundled models - copy from app resources to cache if needed.
 *
 * @returns Object with results for each model
 */
export async function bootstrapBundledModels(): Promise<{
  copied: string[];
  skipped: string[];
  errors: Array<{ name: string; error: string }>;
}> {
  const results = {
    copied: [] as string[],
    skipped: [] as string[],
    errors: [] as Array<{ name: string; error: string }>,
  };

  // Only run in packaged app
  if (!app.isPackaged) {
    console.log('[Bootstrap] Skipping model bootstrap in development mode');
    return results;
  }

  const resourcesPath = process.resourcesPath;
  const cacheDir = getCacheDir();

  console.log('[Bootstrap] Checking bundled models...');
  console.log('[Bootstrap] Resources path:', resourcesPath);
  console.log('[Bootstrap] Cache directory:', cacheDir);

  for (const model of BUNDLED_MODELS) {
    const srcDir = path.join(resourcesPath, model.source);
    const destDir = path.join(cacheDir, model.destination);

    try {
      // Check if source exists in bundled resources
      if (!existsSync(srcDir)) {
        console.log(`[Bootstrap] Bundled model not found: ${model.name} (expected at ${srcDir})`);
        continue;
      }

      // Check if already installed
      if (isModelInstalled(destDir)) {
        console.log(`[Bootstrap] Model already installed: ${model.name}`);
        results.skipped.push(model.name);
        continue;
      }

      // Copy the model
      console.log(`[Bootstrap] Copying bundled model: ${model.name}`);
      console.log(`[Bootstrap]   From: ${srcDir}`);
      console.log(`[Bootstrap]   To: ${destDir}`);

      await copyDir(srcDir, destDir);

      console.log(`[Bootstrap] Successfully copied: ${model.name}`);
      results.copied.push(model.name);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Bootstrap] Error copying ${model.name}:`, errorMsg);
      results.errors.push({ name: model.name, error: errorMsg });
    }
  }

  console.log('[Bootstrap] Model bootstrap complete:', {
    copied: results.copied.length,
    skipped: results.skipped.length,
    errors: results.errors.length,
  });

  return results;
}
