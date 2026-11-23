/**
 * Test helpers.
 *
 * Every test file gets its own throwaway data folder, created *before* the
 * application modules are imported (they read `DATA_DIR` once at start-up).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const RENT = `RENT AGREEMENT

This Rent Agreement is made at Jaipur on this 17th day of April 2026 between Mr. Rajesh Sharma, aged about 52 years, son of Shri Mohan Sharma, resident of 12, Civil Lines, Jaipur (hereinafter called the "Lessor") of the First Part AND Mrs. Anita Mehta, aged about 45 years, wife of Shri Sanjay Mehta, resident of 88, Vaishali Nagar, Jaipur (hereinafter called the "Lessee") of the Second Part.

WHEREAS the Lessor is the owner of Flat No. 402, Shanti Apartments, Civil Lines, Jaipur.

NOW THIS AGREEMENT WITNESSETH AS FOLLOWS:

1. TERM. The tenancy shall be for a period of 11 months commencing on 27 April 2026.
2. RENT. The Lessee shall pay a monthly rent of Rs. 25,000 (Rupees twenty-five thousand only), payable in advance on or before the 5th day of each English calendar month.
3. SECURITY DEPOSIT. The Lessee has paid an interest-free security deposit of Rs. 1,00,000 (Rupees one lakh only) to the Lessor.
4. NOTICE. Either party may terminate this Agreement by giving 30 days written notice. On termination the Lessee shall hand over vacant and peaceful possession of the premises.
5. MAINTENANCE. The Lessee shall pay electricity and water charges.
6. JURISDICTION. The courts at Jaipur shall have exclusive jurisdiction.

IN WITNESS WHEREOF the parties have signed this Agreement on the date first above written.

Lessor: Rajesh Sharma
Lessee: Anita Mehta
Witnesses:
1. Suresh Jain
2. Neha Agarwal
`;

export const NOTICE = `LEGAL NOTICE
Ref. No. LN/2026/117
Dated: 16 October 2026

To,
Mr. Vinod Prakash
14, Johari Bazar, Jaipur

SUBJECT: NOTICE UNDER SECTION 138 OF THE NEGOTIABLE INSTRUMENTS ACT, 1881

Sir,

Under instructions from and on behalf of my client M/s Mehta Industries Pvt Ltd, having its office at 5, Industrial Area, Jaipur, I hereby serve upon you the following notice:

1. That you issued cheque bearing No. 445102 dated 14 September 2026 for a sum of Rs. 4,50,000 drawn on Bank of Baroda, Johari Bazar Branch, Jaipur in favour of my client towards payment of invoice No. 114 dated 20 August 2026.
2. That the said cheque was presented for encashment on 20 September 2026 and was returned unpaid with the remark "insufficient funds".
3. That through this notice I hereby call upon you to pay the sum of Rs. 4,50,000 within 15 days of receipt of this notice, failing which my client shall file a complaint under Section 138 read with Section 142 of the Negotiable Instruments Act, 1881.

Advocate
Jaipur
`;

export const ORDER = `IN THE COURT OF THE ADDITIONAL SESSIONS JUDGE, JAIPUR
Criminal Misc. Bail Application No. 1123 of 2026
State of Rajasthan ... Applicant
Versus
Ravi Kumar ... Respondent

ORDER
Dated: 15 November 2026

Heard learned counsel for the parties. The application is allowed. The accused Ravi Kumar is granted bail on furnishing a personal bond of Rs. 50,000 with two sureties of the like amount.
`;

export const INVOICE = `INVOICE
M/s Mehta Industries Pvt Ltd
GSTIN 08ABCDE1234F1Z5
Invoice No. 114
Invoice Date: 20 August 2026
Bill To: Prakash Traders, Johari Bazar, Jaipur

1. Supply of goods — Rs. 3,80,000
2. GST at 18 percent — Rs. 68,400
Total: Rs. 4,48,400
Amount in words: Rupees four lakh forty-eight thousand four hundred only
Bank: State Bank of India, Johari Bazar Branch
`;

export const AFFIDAVIT = `AFFIDAVIT

I, Anita Sharma, wife of Shri Rajesh Sharma, resident of 12 Civil Lines, Jaipur, do hereby solemnly affirm and declare as under:

1. That I am the deponent and competent to swear this affidavit.
2. That the facts stated herein are true to the best of my knowledge.

DEPONENT
Anita Sharma

VERIFICATION

Verified at Jaipur on this 8th day of November 2026 that the contents above are true and correct.
`;

/** Point the app at a fresh data folder. Call before importing anything from src/. */
export function isolate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdm-test-'));
  process.env.DATA_DIR = dir;
  process.env.DASHBOARD_TOKEN = 'TEST-CODE-123';
  process.env.OWNER_PHONE = '';
  process.env.OWNER_NAME = 'Adv. Kavita Rao';
  process.env.OWNER_CITY = 'Jaipur';
  delete process.env.ALLOWED_PHONES;
  delete process.env.WHATSAPP_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.LLM_PROVIDER;
  delete process.env.PORT;
  return dir;
}

/**
 * Boot an isolated bot with a capturing `send` function.
 * `say('help')` runs one chat turn and returns everything the bot replied.
 */
export async function boot() {
  const dir = isolate();
  const repo = await import('../src/store/repo.js');
  const pipeline = await import('../src/ingest/pipeline.js');
  const { handleText } = await import('../src/bot/handlers.js');
  const { analyzeDocument } = await import('../src/analysis/analyzer.js');
  const { createDraftDocument } = await import('../src/draft/generator.js');
  const { buildBundle } = await import('../src/bundle/builder.js');
  const { parseQuery } = await import('../src/search/queryParser.js');
  const { searchDocuments, bestPassage } = await import('../src/search/search.js');
  const { config } = await import('../src/config.js');

  const OWNER = 'local';
  let out = [];
  const send = async (payload) => { out.push(payload); };

  const say = async (text) => {
    out = [];
    await handleText({ owner: OWNER, text, send });
    return out.filter((p) => p.text).map((p) => p.text).join('\n\n');
  };

  const upload = async (text, filename, extra = {}) => {
    const result = await pipeline.ingestFile({
      owner: OWNER,
      buffer: Buffer.from(text, 'utf8'),
      filename,
      mime: 'text/plain',
      ...extra,
    });
    return result;
  };

  /** Upload the standard fixtures: D1 rent, D2 notice, D3 court order, D4 invoice. */
  const seed = async () => {
    const rent = await upload(RENT, 'rent agreement sharma mehta.txt');
    const notice = await upload(NOTICE, 'legal notice praksh.txt');
    const order = await upload(ORDER, 'court order bail.txt');
    const invoice = await upload(INVOICE, 'invoice 114.txt');
    return { rent: rent.doc, notice: notice.doc, order: order.doc, invoice: invoice.doc };
  };

  return {
    OWNER, dir, config, repo, pipeline, say, upload, seed,
    analyzeDocument, createDraftDocument, buildBundle, parseQuery, searchDocuments, bestPassage,
    get lastOutput() { return out; },
  };
}

export const fileNames = (payloads) => payloads.filter((p) => p.document).map((p) => p.document.filename);
