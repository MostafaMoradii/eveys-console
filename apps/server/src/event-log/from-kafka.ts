// Map one decoded Kafka event into zero or one DeviceEvent rows.
//
// Shared between two callers: the broker's `device-events` resolver
// (live tail to subscribers) and the on-disk event-log writer
// (durable history backing the panel bootstrap + search). Keeping
// one mapping function means the live tail and the persisted log
// always agree on what an event "looks like."
//
// The four topics handled here match the resolver in
// `broker/queries.ts` — boot, status, meter, tx-started. Anything
// else returns null.

import type { DeviceEvent } from '@eveys-console/protocol';

import type { KafkaEvent } from '../kafka/tail.js';

export interface MappedEvent {
  cpId: string;
  event: DeviceEvent;
}

export function deviceEventFromKafka(event: KafkaEvent): MappedEvent | null {
  if (!event.cpId) return null;
  const p = event.payload as Record<string, unknown> | null;
  if (!p || typeof p !== 'object') return null;

  const fallbackAt = event.timestamp.toISOString();
  const at =
    typeof p.chargerReportedAt === 'string' && p.chargerReportedAt
      ? p.chargerReportedAt
      : fallbackAt;

  if (event.topic === 'cp.boot') {
    const vendor = nullableString(p.vendor);
    const model = nullableString(p.model);
    const firmwareVersion = nullableString(p.firmwareVersion);
    const serialNumber = nullableString(p.serialNumber);
    const chargePointStatus = nullableString(p.chargePointStatus);
    const parts = ['BootNotification'];
    const tail = [vendor, model].filter((s): s is string => s != null).join(' ');
    if (tail) parts.push(`— ${tail}`);
    if (firmwareVersion) parts.push(`fw ${firmwareVersion}`);
    return {
      cpId: event.cpId,
      event: {
        at,
        kind: 'boot',
        summary: parts.join(' ').trim(),
        detail: {
          vendor,
          model,
          firmware_version: firmwareVersion,
          serial_number: serialNumber,
          charge_point_status: chargePointStatus,
        },
        connector_id: null,
      },
    };
  }

  if (event.topic === 'cp.status') {
    const connectorId = Number(p.connectorId ?? 0);
    const status = String(p.status ?? '');
    const errorCode = nullableString(p.errorCode);
    const errorTail = errorCode && errorCode !== 'NoError' ? ` (${errorCode})` : '';
    return {
      cpId: event.cpId,
      event: {
        at,
        kind: 'status',
        summary: `Connector ${connectorId} → ${status}${errorTail}`,
        detail: {
          status: status === '' ? null : status,
          error_code: errorCode,
          vendor_error_code: nullableString(p.vendorErrorCode),
          info: nullableString(p.info),
        },
        connector_id: connectorId,
      },
    };
  }

  if (event.topic === 'cp.meter') {
    const samplesRaw = p.sampledValues;
    const samples = Array.isArray(samplesRaw) ? samplesRaw : [];
    if (samples.length === 0) return null;
    const energy = samples.find(
      (sv): sv is Record<string, unknown> =>
        !!sv &&
        typeof sv === 'object' &&
        enumToString((sv as Record<string, unknown>).measurand) === 'ENERGY_ACTIVE_IMPORT_REGISTER',
    );
    const firstObj = samples.find(
      (sv): sv is Record<string, unknown> => !!sv && typeof sv === 'object',
    );
    const primary = energy ?? firstObj ?? null;
    const primaryMeasurand = primary
      ? (enumToString(primary.measurand) ?? 'Energy.Active.Import.Register')
      : null;
    const primaryValueRaw = primary?.value;
    let primaryValue: number | null = null;
    if (primaryValueRaw != null) {
      const n = typeof primaryValueRaw === 'number' ? primaryValueRaw : Number(primaryValueRaw);
      if (Number.isFinite(n)) primaryValue = n;
    }
    const primaryUnit = primary ? enumToString(primary.unit) : null;
    const connectorId = Number(p.connectorId ?? 0);
    const transactionId = p.transactionId != null ? Number(p.transactionId) : null;
    return {
      cpId: event.cpId,
      event: {
        at,
        kind: 'meter',
        summary: `MeterValues — ${samples.length} sample${samples.length === 1 ? '' : 's'}`,
        detail: {
          connector_id: connectorId,
          transaction_id: transactionId,
          primary_measurand: primaryMeasurand,
          primary_value: primaryValue,
          primary_unit: primaryUnit,
          sample_count: samples.length,
        },
        connector_id: connectorId,
      },
    };
  }

  if (event.topic === 'tx.started') {
    const transactionId = Number(p.transactionId ?? 0);
    const idTag = String(p.idTag ?? '');
    const connectorId = Number(p.connectorId ?? 0);
    const meterStartWh = Number(p.meterStartWh ?? 0);
    return {
      cpId: event.cpId,
      event: {
        at,
        kind: 'tx-started',
        summary: `Transaction ${transactionId} started — id_tag ${idTag}`,
        detail: {
          transaction_id: transactionId,
          id_tag: idTag === '' ? null : idTag,
          connector_id: connectorId,
          meter_start_wh: meterStartWh,
        },
        connector_id: connectorId,
      },
    };
  }

  return null;
}

function nullableString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== 'string') return String(v);
  if (v === '') return null;
  return v;
}

function enumToString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== 'string') return null;
  if (v === '' || v.endsWith('_UNSPECIFIED')) return null;
  const idx = v.indexOf('_');
  return idx >= 0 ? v.slice(idx + 1) : v;
}
