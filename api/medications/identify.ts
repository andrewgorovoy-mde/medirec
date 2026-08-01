import {
  MedicationVisionError,
  identifyMedicationImage,
  parseMedicationIdentifyRequest,
} from '../medicationVisionClient';

interface VercelRequest {
  method?: string;
  body?: unknown;
}

interface VercelResponse {
  status(code: number): VercelResponse;
  json(body: unknown): void;
  setHeader?(name: string, value: string): void;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader?.('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const request = parseMedicationIdentifyRequest(req.body);
    const result = await identifyMedicationImage(request);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: 'Invalid JSON request body' });
      return;
    }
    if (err instanceof MedicationVisionError) {
      res.status(err.statusCode).json({ error: err.publicMessage });
      return;
    }

    console.error('Medication identification failed');
    res.status(502).json({ error: 'Medication vision service unavailable' });
  }
}
