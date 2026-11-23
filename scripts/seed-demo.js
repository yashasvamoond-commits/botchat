#!/usr/bin/env node
/**
 * Loads a small, realistic sample library so you can try the bot immediately.
 *     npm run seed            → add demo documents (skipped if a library already exists)
 *     npm run seed -- --clear → remove them again
 */
import { config } from '../src/config.js';
import { pdfFromText } from '../src/util/pdf-writer.js';
import { docxFromText } from '../src/util/docx-writer.js';
import { ingestFile } from '../src/ingest/pipeline.js';
import { createMatter, listMatters, listDocuments, deleteDocument, deleteMatter, getMatter } from '../src/store/repo.js';
import { archiveDelete } from '../src/store/trash.js';
import { addDays, toIso, formatDate } from '../src/util/dates.js';
import { setting, setSetting } from '../src/store/db.js';
import { slugify } from '../src/util/text.js';

const owner = config.ownerPhone || 'local';
const today = toIso(new Date());
const d = (offset) => addDays(today, offset);
const longDate = (iso) => formatDate(iso, { long: true });

const META = [
  {
    key: 'sharma-mehta',
    matter: {
      title: 'Sharma v Mehta',
      client: 'Rajesh Sharma',
      opposite: 'Anita Mehta',
      practice_area: 'Property / Rent',
      court: 'District & Sessions Court, Jaipur',
      notes: 'Rent arrears and possession of the flat at Civil Lines.',
    },
  },
  {
    key: 'mehta-industries',
    matter: {
      title: 'Mehta Industries v Prakash Traders',
      client: 'Mehta Industries Pvt Ltd',
      opposite: 'Prakash Traders',
      practice_area: 'Cheque bounce',
      court: 'Court of Judicial Magistrate, Jaipur',
      notes: 'Section 138 complaint on a dishonoured cheque of Rs. 4,50,000.',
    },
  },
  {
    key: 'verma-sale',
    matter: {
      title: 'Verma property — sale deed',
      client: 'Suresh Verma',
      opposite: 'Mohan Gupta',
      practice_area: 'Property',
      court: 'Sub-Registrar, Ajmer',
    },
  },
  {
    key: 'state-rakesh',
    matter: {
      title: 'State v Rakesh Kumar',
      client: 'Rakesh Kumar',
      opposite: 'State of Rajasthan',
      practice_area: 'Criminal',
      court: 'District & Sessions Court, Jaipur',
    },
  },
];

const DOCS = [
  {
    matter: 'sharma-mehta',
    filename: 'rent agreement final.pdf',
    kind: 'pdf',
    text: `# RENT AGREEMENT

This Rent Agreement is made and executed at Jaipur on this ${longDate(d(-220))}, between:

Mr. Rajesh Sharma, aged about 52 years, son of Mr. Mohan Sharma, resident of 14, Civil Lines, Jaipur, hereinafter called the "LESSOR" of the FIRST PART;

AND

Mrs. Anita Mehta, aged about 38 years, wife of Mr. Vikram Mehta, resident of 22, Vaishali Nagar, Jaipur, hereinafter called the "LESSEE" of the SECOND PART.

## WHEREAS the Lessor is the absolute owner of Flat No. 402, Shanti Apartments, Civil Lines, Jaipur and has agreed to let out the same to the Lessee.

## NOW THIS AGREEMENT WITNESSETH AS FOLLOWS

1. TERM. The tenancy shall be for a period of 11 months commencing on ${longDate(d(-210))}, at a monthly rent of Rs. 25,000 (Rupees twenty-five thousand only), payable in advance on or before the 5th day of each English calendar month.

2. SECURITY DEPOSIT. The Lessee has paid an interest-free refundable security deposit of Rs. 1,00,000 (Rupees one lakh only) to the Lessor.

3. NOTICE. Either party may terminate this Agreement by giving 30 days written notice. On termination the Lessee shall hand over vacant and peaceful possession of the premises.

4. MAINTENANCE. The Lessee shall pay electricity and water charges. The Lessor shall pay society maintenance charges and property tax.

5. USE. The premises shall be used for residential purposes only. The Lessee shall not sublet or part with possession.

6. DEFAULT. If the Lessee fails to pay rent for two consecutive months, the Lessor shall be entitled to terminate this Agreement and take possession after due notice.

7. JURISDICTION. Any dispute arising out of this Agreement shall be subject to the exclusive jurisdiction of the courts at Jaipur.

## IN WITNESS WHEREOF the parties have signed this Agreement on the date first written above.

LESSOR: Rajesh Sharma          LESSEE: Anita Mehta
WITNESS 1: Mahesh Jain         WITNESS 2: Kavita Singh`,
  },
  {
    matter: 'sharma-mehta',
    filename: 'legal notice rent arrears.pdf',
    kind: 'pdf',
    text: `# LEGAL NOTICE

Ref: RS/2026/114
Date: ${longDate(d(-24))}

To,
Mrs. Anita Mehta
22, Vaishali Nagar, Jaipur

SUBJECT: LEGAL NOTICE FOR RECOVERY OF RENT ARREARS OF RS. 75,000

Sir/Madam,

Under instructions from and on behalf of my client, Mr. Rajesh Sharma, resident of 14, Civil Lines, Jaipur, I serve upon you the following notice:

1. That you are a tenant in Flat No. 402, Shanti Apartments, Civil Lines, Jaipur, under a rent agreement dated ${longDate(d(-220))}, at a monthly rent of Rs. 25,000.

2. That you have failed to pay rent for the months of ${formatDate(d(-90))}, ${formatDate(d(-60))} and ${formatDate(d(-30))}, and a sum of Rs. 75,000 is due and payable by you to my client.

3. That despite repeated oral requests and reminders you have failed and neglected to pay the said amount.

4. That through this notice I hereby call upon you to pay the sum of Rs. 75,000 (Rupees seventy-five thousand only) within 15 days of receipt of this notice, failing which my client shall be constrained to initiate eviction and recovery proceedings before the competent court at Jaipur, at your risk, cost and consequences.

5. That this notice is issued without prejudice to my client's other rights and remedies.

Yours faithfully,
Adv. R. K. Sharma
Advocate

Place: Jaipur`,
  },
  {
    matter: 'mehta-industries',
    filename: 'invoice 114.pdf',
    kind: 'pdf',
    text: `# TAX INVOICE

Mehta Industries Pvt Ltd
Industrial Area, Sitapura, Jaipur
GSTIN: 08AABCM1234C1Z5

Invoice No.: MI/2026/114
Invoice Date: ${longDate(d(-95))}

Bill To:
Prakash Traders
Johari Bazar, Jaipur
GSTIN: 08AAECP5678D1Z2

Description: Supply of MS pipes, 4 inch, 250 units @ Rs. 1,800 per unit
Taxable value: Rs. 4,50,000
IGST @ 18%: Rs. 81,000
Total Amount Payable: Rs. 5,31,000

Payment terms: 30 days from invoice date.
Bank: State Bank of India, Sitapura Branch, A/c 30012345678, IFSC SBIN0031234.

For Mehta Industries Pvt Ltd
Authorised Signatory`,
  },
  {
    matter: 'mehta-industries',
    filename: 'cheque bounce notice.pdf',
    kind: 'pdf',
    text: `# LEGAL NOTICE UNDER SECTION 138 OF THE NEGOTIABLE INSTRUMENTS ACT, 1881

Date: ${longDate(d(-38))}

To,
Mr. Vinod Prakash
Proprietor, Prakash Traders
Johari Bazar, Jaipur

SUBJECT: STATUTORY NOTICE FOR DISHONOUR OF CHEQUE NO. 445102 DATED ${longDate(d(-70))} FOR RS. 4,50,000

Sir,

Under instructions from and on behalf of my client Mehta Industries Pvt Ltd, Sitapura, Jaipur, I serve upon you this statutory notice:

1. That you issued cheque bearing No. 445102 dated ${longDate(d(-70))} for a sum of Rs. 4,50,000 (Rupees four lakh fifty thousand only), drawn on Bank of Baroda, Johari Bazar Branch, Jaipur, in favour of my client, towards a legally enforceable debt arising out of supply of MS pipes vide invoice no. MI/2026/114.

2. That my client presented the said cheque for encashment on ${longDate(d(-45))}. The said cheque was returned dishonoured with the remark "insufficient funds" vide bank return memo dated ${longDate(d(-44))}.

3. That the dishonour is attributable solely to you as you failed to maintain sufficient funds in your account.

4. That the dishonour of the cheque constitutes an offence under Section 138 of the Negotiable Instruments Act, 1881.

5. That through this notice I hereby call upon you to pay the sum of Rs. 4,50,000 within 15 days of receipt of this notice, failing which my client shall file a complaint under Section 138 read with Section 142 of the Negotiable Instruments Act, 1881 before the competent court at Jaipur.

Yours faithfully,
Adv. R. K. Sharma
Advocate

Place: Jaipur`,
  },
  {
    matter: 'verma-sale',
    filename: 'sale deed plot ajmer.pdf',
    kind: 'pdf',
    text: `# SALE DEED

This Sale Deed is executed at Ajmer on this ${longDate(d(-620))}, between:

Mr. Suresh Verma, aged about 61 years, son of Late Mr. Gopal Verma, resident of 8, Civil Lines, Ajmer ("VENDOR")

AND

Mr. Mohan Gupta, aged about 45 years, son of Mr. Ramesh Gupta, resident of 51, Adarsh Nagar, Ajmer ("VENDEE").

## 1. PROPERTY
The Vendor is the absolute owner of Plot No. 27, situated in Khasra No. 145/2, Village Gegal, Tehsil Ajmer, District Ajmer, admeasuring 200 square yards, bounded as follows: North - plot no. 26; South - road; East - plot no. 28; West - plot no. 20.

## 2. CONSIDERATION
The total sale consideration is Rs. 25,00,000 (Rupees twenty-five lakh only), paid by the Vendee to the Vendor by way of bank draft no. 778812 dated ${longDate(d(-621))}, the receipt of which the Vendor hereby acknowledges.

## 3. TITLE
The Vendor declares that the property is free from all encumbrances, liens and litigation and undertakes to indemnify the Vendee against any defect in title.

## 4. POSSESSION
Vacant and peaceful possession has been handed over to the Vendee on the date of this deed.

## 5. REGISTRATION
Stamp duty of Rs. 1,25,000 and registration charges have been borne by the Vendee. The deed is registered in Book No. 1, Volume 4 at the office of the Sub-Registrar, Ajmer.

## 6. JURISDICTION
The courts at Ajmer shall have exclusive jurisdiction.

IN WITNESS WHEREOF the parties have signed this deed in the presence of witnesses.

VENDOR: Suresh Verma          VENDEE: Mohan Gupta
WITNESS 1: Ashok Jain         WITNESS 2: Prem Chand`,
  },
  {
    matter: 'state-rakesh',
    filename: 'fir copy 214.pdf',
    kind: 'pdf',
    text: `# FIRST INFORMATION REPORT

Police Station: Kardhani, Jaipur
FIR No. 214 of 2026
Date and Time of Report: ${longDate(d(-76))}, 19:40 hrs

Act and Sections: Bharatiya Nyaya Sanhita, 2023 - Section 303(2) (theft)

Complainant: Mr. Sunil Agarwal, resident of 33, Vidhyadhar Nagar, Jaipur
Accused: Mr. Rakesh Kumar, resident of 12, Harmada, Jaipur; and one unknown person

Brief facts: The complainant states that on ${longDate(d(-77))} between 14:00 and 17:00 hrs, unknown persons entered his shop at Vidhyadhar Nagar and took away cash of Rs. 80,000 and gold ornaments weighing about 40 grams. The matter was reported immediately. CCTV footage of the neighbouring shop is being collected.

Investigating Officer: SI Mahendra Singh, PS Kardhani
Copy supplied to complainant on ${longDate(d(-76))}.`,
  },
  {
    matter: 'state-rakesh',
    filename: 'bail order.pdf',
    kind: 'pdf',
    text: `# IN THE COURT OF THE DISTRICT & SESSIONS JUDGE, JAIPUR

Criminal Misc. Bail Application No. 1123 of 2026
State of Rajasthan ... Prosecution
versus
Rakesh Kumar, son of Mr. Shyam Lal, resident of 12, Harmada, Jaipur ... Accused

## ORDER

This application under Section 480 of the Bharatiya Nagarik Suraksha Sanhita, 2023 has been moved on behalf of the accused seeking regular bail in connection with FIR No. 214 of 2026 registered at Police Station Kardhani under Section 303(2) of the Bharatiya Nyaya Sanhita, 2023.

Heard learned counsel for the accused and the learned Public Prosecutor. The accused is stated to be 34 years old with no previous criminal antecedents. The investigation is substantially complete and the accused has been cooperating.

Considering the facts and circumstances and without expressing any opinion on the merits of the case, the accused is admitted to bail on furnishing a personal bond in the sum of Rs. 50,000 with one surety of the like amount to the satisfaction of the learned Magistrate.

The accused shall cooperate with the investigation and shall not tamper with evidence.

List the matter for next hearing on ${longDate(d(12))}.

Dated: ${longDate(d(-8))}
District & Sessions Judge, Jaipur`,
  },
  {
    matter: null,
    filename: 'affidavit of address.docx',
    kind: 'docx',
    text: `# AFFIDAVIT

I, Mr. Rajesh Sharma, aged about 52 years, son of Mr. Mohan Sharma, resident of 14, Civil Lines, Jaipur, do hereby solemnly affirm and declare as under:

1. That I am the deponent herein and am fully conversant with the facts of the case.

2. That the address mentioned above is my true and correct residential address and I have been residing there for the past 22 years.

3. That I have not changed my address in the last 22 years and the documents attached herewith are correct.

4. That the facts stated in this affidavit are true to my knowledge and belief and nothing material has been concealed.

VERIFICATION

Verified at Jaipur on this ${longDate(d(-15))}, that the contents of the above affidavit are true and correct to my knowledge and belief.

DEPONENT
Rajesh Sharma`,
  },
  {
    matter: 'verma-sale',
    filename: 'power of attorney verma.docx',
    kind: 'docx',
    text: `# SPECIAL POWER OF ATTORNEY

KNOW ALL MEN BY THESE PRESENTS that I, Mr. Suresh Verma, resident of 8, Civil Lines, Ajmer, do hereby appoint and constitute my son Mr. Ankit Verma, resident of 8, Civil Lines, Ajmer, as my true and lawful attorney to:

1. Represent me before the office of the Sub-Registrar, Ajmer and to sign, present and receive all documents relating to Plot No. 27, Village Gegal, Ajmer.

2. Appear before the Tehsildar and municipal authorities in connection with mutation of records relating to the said property.

3. Do all such acts as may be necessary for the above purposes.

This Power of Attorney is limited to the purposes stated above and shall not be construed as a general power of attorney. It is revocable at any time by written notice.

IN WITNESS WHEREOF I have executed this deed at Ajmer on ${longDate(d(-30))}.

EXECUTANT: Suresh Verma
WITNESS 1: Ashok Jain
WITNESS 2: Prem Chand`,
  },
  {
    matter: 'state-rakesh',
    filename: 'vakalatnama.docx',
    kind: 'docx',
    text: `# VAKALATNAMA

IN THE DISTRICT & SESSIONS COURT, JAIPUR
Criminal Misc. Bail Application No. 1123 of 2026
Rakesh Kumar ... Applicant

I, Mr. Rakesh Kumar, resident of 12, Harmada, Jaipur, the accused in the above matter, do hereby appoint and retain Adv. R. K. Sharma, Advocate, Jaipur, to appear, plead and act on my behalf in the above matter and all connected proceedings.

I authorise the said advocate to file documents, to appear before any court, to receive notices on my behalf, and to do all acts necessary for the conduct of this case.

I agree to pay the professional fee of Rs. 25,000 as agreed separately.

Date: ${longDate(d(-10))}
Place: Jaipur

Signature of Client: Rakesh Kumar
Signature of Advocate: R. K. Sharma`,
  },
];

function matterIdByKey(key) {
  return setting(`demoMatter:${key}`, null);
}

async function clear() {
  const docs = listDocuments(owner, { limit: 5000 }).filter((doc) => doc.source === 'demo' || doc.entities?.demo);
  for (const doc of docs) await archiveDelete(doc);
  const keys = META.map((m) => m.key);
  for (const key of keys) {
    const id = matterIdByKey(key);
    if (id && getMatter(id)) deleteMatter(id);
    setSetting(`demoMatter:${key}`, null);
  }
  setSetting('demoSeeded', false);
  console.log(`Removed ${docs.length} sample documents and their cases.`);
}

async function seed() {
  if (setting('demoSeeded', false)) {
    console.log('Sample library already loaded. Use "npm run seed -- --clear" to remove it first.');
    return;
  }
  if (listDocuments(owner, { limit: 1 }).length) {
    console.log('Your library already has documents. Sample files were not added (send a real one instead).');
    return;
  }

  const matters = {};
  for (const meta of META) {
    const existing = listMatters(owner, { status: null, limit: 500 }).find((m) => m.title === meta.matter.title);
    matters[meta.key] = existing || createMatter(owner, meta.matter);
    setSetting(`demoMatter:${meta.key}`, matters[meta.key].id);
  }

  for (const entry of DOCS) {
    const buffer = entry.kind === 'docx'
      ? await docxFromText(entry.text, { title: entry.filename })
      : pdfFromText(entry.text, { title: entry.filename });
    const result = await ingestFile({
      owner,
      buffer,
      filename: entry.filename,
      mime: entry.kind === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf',
      caption: '',
      source: 'demo',
      matterId: entry.matter ? matters[entry.matter].id : null,
      skipLlm: true,
    });
    if (result?.doc) {
      console.log(`  ${result.doc.id}  ${result.doc.type_label.padEnd(30)} ${result.doc.title}`);
    }
  }

  setSetting('demoSeeded', true);
  console.log(`\nSample library ready: ${DOCS.length} documents across ${META.length} cases.`);
  console.log('Open the dashboard chat and try: "rent agreement", "cheque bounce notice", "what is the notice period in the rent agreement".');
}

const arg = process.argv[2];
if (arg === '--clear') await clear();
else await seed();
