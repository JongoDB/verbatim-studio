import { usePluginManifestContext } from '@/hooks/usePluginManifest';
import { getApiUrl } from '@/lib/api';

interface PluginSlotProps {
  /** Named slot identifier, e.g. "sidebar.bottom", "transcript.toolbar" */
  name: string;
  /** Optional context data passed to the plugin via URL params */
  context?: Record<string, string>;
  /** Optional CSS class for the container */
  className?: string;
}

/**
 * Named injection point for plugin UI.
 *
 * If a plugin has registered content for this slot name (via the manifest),
 * renders it in an iframe. Otherwise renders nothing.
 *
 * Usage:
 *   <PluginSlot name="transcript.toolbar" context={{ transcriptId }} />
 */
export function PluginSlot({ name, context, className }: PluginSlotProps) {
  const manifest = usePluginManifestContext();
  const slotComponent = manifest.slots[name];

  if (!slotComponent) return null;

  // Build the plugin slot URL with optional context params
  const params = context ? '?' + new URLSearchParams(context).toString() : '';
  const src = getApiUrl(`/plugins/slots/${name}${params}`);

  return (
    <iframe
      src={src}
      className={className || 'w-full border-0'}
      title={`Plugin slot: ${name}`}
      sandbox="allow-scripts allow-same-origin allow-forms"
    />
  );
}
