const DEFAULT_MAINTENANCE_MESSAGE = 'Nous effectuons actuellement des améliorations sur eAutoecole. Merci de réessayer dans quelques instants.';
let cachedRuntimeSettings = null;
let runtimeChannel = null;

export async function loadRuntimeSettings({ force = false } = {}) {
  if (!force && cachedRuntimeSettings) return cachedRuntimeSettings;
  const fallback = {
    id: 'global',
    maintenance_enabled: false,
    maintenance_message: DEFAULT_MAINTENANCE_MESSAGE,
    updated_at: null,
    updated_by: null
  };
  if (!window.sb) {
    cachedRuntimeSettings = fallback;
    return cachedRuntimeSettings;
  }
  try {
    const { data, error } = await window.sb
      .from('runtime_settings')
      .select('id,maintenance_enabled,maintenance_message,updated_at,updated_by')
      .eq('id', 'global')
      .single();
    if (error) throw error;
    cachedRuntimeSettings = normalizeRuntimeSettings(data);
  } catch (_) {
    cachedRuntimeSettings = fallback;
  }
  return cachedRuntimeSettings;
}

export function getCachedRuntimeSettings() {
  return cachedRuntimeSettings || {
    id: 'global',
    maintenance_enabled: false,
    maintenance_message: DEFAULT_MAINTENANCE_MESSAGE,
    updated_at: null,
    updated_by: null
  };
}

export async function updateRuntimeMaintenance({ enabled, message }) {
  const user = await window.sbGetUser();
  if (!user) throw new Error('Non connecté');
  const payload = {
    maintenance_enabled: Boolean(enabled),
    maintenance_message: String(message || '').trim() || DEFAULT_MAINTENANCE_MESSAGE,
    updated_by: user.id
  };
  const { data, error } = await window.sb
    .from('runtime_settings')
    .update(payload)
    .eq('id', 'global')
    .select()
    .single();
  if (error) throw error;
  cachedRuntimeSettings = normalizeRuntimeSettings(data);
  return cachedRuntimeSettings;
}

export function subscribeToRuntimeSettings(callback) {
  if (!window.sbSubscribe || runtimeChannel) return runtimeChannel;
  runtimeChannel = window.sbSubscribe(
    'runtime-settings-global',
    { event: '*', schema: 'public', table: 'runtime_settings', filter: 'id=eq.global' },
    ({ new: settings }) => {
      cachedRuntimeSettings = normalizeRuntimeSettings(settings);
      callback(cachedRuntimeSettings);
    }
  );
  return runtimeChannel;
}

export function teardownRuntimeSettingsSubscription() {
  if (runtimeChannel && window.sbRemoveChannel) {
    window.sbRemoveChannel(runtimeChannel);
  }
  runtimeChannel = null;
}

export function getMaintenanceMessage(settings = getCachedRuntimeSettings()) {
  return settings.maintenance_message || DEFAULT_MAINTENANCE_MESSAGE;
}

function normalizeRuntimeSettings(settings) {
  return {
    id: settings?.id || 'global',
    maintenance_enabled: Boolean(settings?.maintenance_enabled),
    maintenance_message: settings?.maintenance_message || DEFAULT_MAINTENANCE_MESSAGE,
    updated_at: settings?.updated_at || null,
    updated_by: settings?.updated_by || null
  };
}
