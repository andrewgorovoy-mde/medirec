const STEDI_BASE = 'https://healthcare.us.stedi.com/2024-04-01';
const DEFAULT_NPI = '1999999984'; // Stedi's own documented test/demo NPI — used as a placeholder provider identity.

interface Address {
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

interface EligibilityRequest {
  firstName: string;
  lastName: string;
  dateOfBirth: string; // YYYY-MM-DD
  address?: Address;
}

interface DiscoveredCoverage {
  payerName: string;
  payerId?: string;
  memberId?: string;
  groupNumber?: string;
  planName?: string;
  confidence?: string;
  raw: unknown;
}

export interface EligibilityResult {
  source: 'stedi' | 'mock';
  coveragesFound: number;
  items: DiscoveredCoverage[];
  cob?: {
    checked: boolean;
    primacyDetermined?: boolean;
    overlap?: boolean;
    order: string[]; // payer names in primary -> secondary -> ... order
    raw?: unknown;
  };
  note?: string;
}

function toStediDate(iso: string): string {
  return iso.replaceAll('-', '');
}

function extractDiscoveredCoverage(item: any): DiscoveredCoverage {
  return {
    payerName: item?.payer?.name ?? item?.payer?.payerName ?? 'Unknown Payer',
    payerId: item?.payer?.payorIdentification ?? item?.payer?.payerId,
    memberId: item?.subscriber?.memberId ?? item?.dependent?.memberId,
    groupNumber: item?.subscriber?.groupNumber,
    planName: item?.benefitsInformation?.[0]?.planCoverage,
    confidence: item?.confidence?.level,
    raw: item,
  };
}

async function callStedi(path: string, body: unknown): Promise<{ ok: boolean; status: number; json: any }> {
  const apiKey = process.env.STEDI_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 0, json: { error: 'STEDI_API_KEY not set' } };
  }
  const response = await fetch(`${STEDI_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, json };
}

// Realistic, clearly-labeled demo data used only when Stedi's real Insurance Discovery /
// Coordination of Benefits endpoints are unavailable (e.g. test-mode API keys — both features
// are explicitly unsupported in Stedi test mode, confirmed against their docs and a live 403).
function mockDiscovery(req: EligibilityRequest): EligibilityResult {
  const items: DiscoveredCoverage[] = [
    {
      payerName: 'Anthem Blue Cross Blue Shield',
      payerId: '00060',
      memberId: `BC${req.lastName.slice(0, 3).toUpperCase()}${toStediDate(req.dateOfBirth).slice(-4)}`,
      groupNumber: '552310',
      planName: 'PPO Choice Plus',
      confidence: 'HIGH',
      raw: { mock: true },
    },
    {
      payerName: 'Medicare Part B',
      payerId: 'CMS',
      memberId: `1${toStediDate(req.dateOfBirth).slice(0, 8)}A`,
      groupNumber: undefined,
      planName: 'Original Medicare',
      confidence: 'MEDIUM',
      raw: { mock: true },
    },
  ];

  return {
    source: 'mock',
    coveragesFound: items.length,
    items,
    cob: {
      checked: true,
      primacyDetermined: true,
      overlap: true,
      order: [items[0].payerName, items[1].payerName],
      raw: { mock: true },
    },
    note: 'Demo data — Stedi Insurance Discovery / COB require a production API key (unavailable in test mode).',
  };
}

export async function runEligibilityDiscovery(req: EligibilityRequest): Promise<EligibilityResult> {
  const discoveryBody = {
    provider: { npi: process.env.STEDI_PROVIDER_NPI ?? DEFAULT_NPI },
    subscriber: {
      firstName: req.firstName,
      lastName: req.lastName,
      dateOfBirth: toStediDate(req.dateOfBirth),
      ...(req.address ? { address: req.address } : {}),
    },
  };

  const discovery = await callStedi('/insurance-discovery/check/v1', discoveryBody);

  if (!discovery.ok) {
    console.warn('Stedi insurance discovery unavailable, using mock data:', discovery.status, discovery.json);
    return mockDiscovery(req);
  }

  const rawItems: any[] = discovery.json?.items ?? [];
  const items = rawItems.map(extractDiscoveredCoverage);

  let cob: EligibilityResult['cob'];
  if (items.length >= 2 && items[0].payerId) {
    const cobBody = {
      provider: { npi: process.env.STEDI_PROVIDER_NPI ?? DEFAULT_NPI, organizationName: 'MediRec' },
      subscriber: {
        firstName: req.firstName,
        lastName: req.lastName,
        dateOfBirth: req.dateOfBirth,
        memberId: items[0].memberId,
      },
      encounter: { dateOfService: req.dateOfBirth, serviceTypeCode: '30' },
      tradingPartnerServiceId: items[0].payerId,
    };
    const cobResult = await callStedi('/coordination-of-benefits', cobBody);
    if (cobResult.ok) {
      const entities = cobResult.json?.benefitsInformation?.[0]?.benefitsRelatedEntities ?? [];
      cob = {
        checked: true,
        primacyDetermined: cobResult.json?.coordinationOfBenefits?.primacyDetermined,
        overlap: cobResult.json?.coordinationOfBenefits?.benefitOverlap,
        order: entities.map((e: any) => e.entityName).filter(Boolean),
        raw: cobResult.json,
      };
    }
  }

  return {
    source: 'stedi',
    coveragesFound: discovery.json?.coveragesFound ?? items.length,
    items,
    cob,
  };
}

interface VercelRequest {
  method?: string;
  body?: unknown;
}

interface VercelResponse {
  status(code: number): VercelResponse;
  json(body: unknown): void;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body) : (req.body as Partial<EligibilityRequest>);
    if (!body?.firstName || !body?.lastName || !body?.dateOfBirth) {
      res.status(400).json({ error: 'Missing firstName, lastName, or dateOfBirth' });
      return;
    }

    const result = await runEligibilityDiscovery(body as EligibilityRequest);
    res.status(200).json(result);
  } catch (err) {
    console.error('eligibility check failed', err);
    res.status(500).json({ error: 'Eligibility check failed' });
  }
}
