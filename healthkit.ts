let hk: any = null;
try {
  hk = require('@kingstinct/react-native-healthkit');
} catch {}

let authorized = false;

export async function requestHeartRateAuth(): Promise<boolean> {
  if (!hk) return false;
  try {
    const available = hk.isHealthDataAvailable
      ? await hk.isHealthDataAvailable()
      : hk.isHealthDataAvailableAsync
      ? await hk.isHealthDataAvailableAsync()
      : true;
    if (!available) return false;
    const idHR =
      hk.HKQuantityTypeIdentifier?.heartRate ??
      'HKQuantityTypeIdentifierHeartRate';
    if (hk.requestAuthorization) {
      await hk.requestAuthorization([idHR], []);
    } else if (hk.default?.requestAuthorization) {
      await hk.default.requestAuthorization([idHR], []);
    }
    authorized = true;
    return true;
  } catch {
    return false;
  }
}

export async function getLatestBpm(maxAgeSeconds = 300): Promise<number | null> {
  if (!hk || !authorized) return null;
  try {
    const idHR =
      hk.HKQuantityTypeIdentifier?.heartRate ??
      'HKQuantityTypeIdentifierHeartRate';
    const unitBpm =
      hk.HKUnits?.CountPerMinute ??
      hk.HKUnit?.CountPerMinute ??
      'count/min';
    const query =
      hk.queryQuantitySamples ??
      hk.queryQuantitySamplesAsync ??
      hk.default?.queryQuantitySamples;
    if (!query) return null;
    const samples = await query(idHR, {
      limit: 1,
      ascending: false,
      unit: unitBpm,
    });
    if (!samples || samples.length === 0) return null;
    const s = samples[0];
    const endTime = s.endDate
      ? new Date(s.endDate).getTime()
      : s.endTime
      ? new Date(s.endTime).getTime()
      : Date.now();
    const ageSec = (Date.now() - endTime) / 1000;
    if (ageSec > maxAgeSeconds) return null;
    const value = s.quantity ?? s.value ?? s.doubleValue;
    if (typeof value !== 'number' || !isFinite(value)) return null;
    return Math.round(value);
  } catch {
    return null;
  }
}

export function isHealthKitAvailable(): boolean {
  return !!hk;
}
