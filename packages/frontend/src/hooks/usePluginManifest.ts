import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type PluginManifest } from '@/lib/api';

const EMPTY_MANIFEST: PluginManifest = {
  routes: [],
  nav_items: [],
  settings_tabs: [],
  slots: {},
};

// Context for providing manifest to deeply nested components (PluginSlot)
export const PluginManifestContext = createContext<PluginManifest>(EMPTY_MANIFEST);

/**
 * Fetch the plugin manifest from /api/plugins/manifest.
 * Returns the manifest data, or EMPTY_MANIFEST if no plugins are installed.
 * Refetches on window focus (plugins may be installed/removed between sessions).
 */
export function usePluginManifest() {
  const query = useQuery({
    queryKey: ['plugins', 'manifest'],
    queryFn: () => api.plugins.manifest(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true,
  });

  return query.data ?? EMPTY_MANIFEST;
}

/**
 * Access the plugin manifest from context (for components that can't use the hook directly).
 */
export function usePluginManifestContext() {
  return useContext(PluginManifestContext);
}
