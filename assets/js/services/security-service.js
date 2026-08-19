export async function sendClientSecuritySignal(eventType, metadata = {}) {
  if (!window.sb) return;
  try {
    await window.sb.from('security_events').insert({
      event_type: eventType,
      severity: 'low',
      source: 'client_security_signal',
      metadata
    });
  } catch (error) {
    // Low-trust telemetry must never block the application.
  }
}

export function assertNoPasswordLogging(payload) {
  const text = JSON.stringify(payload || {}).toLowerCase();
  return !text.includes('password') && !text.includes('mot de passe');
}
