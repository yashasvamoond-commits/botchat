/**
 * Draft templates. Written as plain text with {{placeholders}}.
 * These are starting points for a lawyer to review — not legal advice.
 */

const COMMON_NOTE = `\n\n---\n_Prepared with X Document Manager as a drafting aid. Please review, correct and verify every fact, figure and section before signing or issuing._`;

export const DRAFT_TEMPLATES = [
  {
    id: 'legal_notice_money',
    label: 'Legal Notice — Recovery of Money',
    keywords: /(?:legal\s+)?notice.*(?:money|recovery|payment|due|outstanding|amount)|recovery\s+notice|demand\s+notice/i,
    defaults: { noticeDays: 15 },
    fields: ['clientName', 'clientAddress', 'oppositeName', 'oppositeAddress', 'amount', 'purpose', 'dueDate', 'city', 'advocateName'],
    build: (v) => `# LEGAL NOTICE

**Ref: {{reference}}**

**Date: {{today}}**

**To,**
{{oppositeName}}
{{oppositeAddress}}

**SUBJECT: LEGAL NOTICE FOR RECOVERY OF {{amountText}}**

Sir/Madam,

Under instructions from and on behalf of my client, {{clientName}}, {{clientAddress}}, I serve upon you the following legal notice:

1. That my client is engaged in lawful business and you have been known to my client in the course of business/dealings.

2. That you approached my client and requested goods/services/money, which my client provided in good faith. A sum of {{amountText}} ({{amountWords}}) became due and payable by you to my client on account of {{purpose}}.

3. That the said amount was payable on or before {{dueDate}}. Despite repeated oral requests and reminders, you have failed and neglected to pay the said amount.

4. That you have thus committed a breach of your obligation and have caused wrongful loss to my client and wrongful gain to yourself.

5. That through this notice, I hereby call upon you to pay the aforesaid sum of {{amountText}} ({{amountWords}}) together with interest @ 12% per annum from {{dueDate}} till realisation, within {{noticeDays}} days of receipt of this notice.

6. That in the event of your failure to comply with this notice within the aforesaid period, my client shall be constrained to initiate appropriate civil and/or criminal proceedings against you at your risk, cost and consequences, and you shall be liable for all costs and damages.

7. That this notice is issued without prejudice to my client's other rights and remedies, all of which are expressly reserved.

A copy of this notice has been retained in my office for record and necessary action.

Yours faithfully,

{{advocateName}}
Advocate

_Place of issue: {{city}}_
${COMMON_NOTE}`,
  },
  {
    id: 'cheque_bounce_notice',
    label: 'Cheque Bounce Notice (Section 138 NI Act)',
    keywords: /cheque\s*bounce|138|dishonou?r.*cheque|cheque.*dishonou?r/i,
    defaults: { noticeDays: 15 },
    fields: ['clientName', 'oppositeName', 'chequeNo', 'chequeDate', 'amount', 'bankName', 'city', 'advocateName'],
    build: (v) => `# LEGAL NOTICE UNDER SECTION 138 OF THE NEGOTIABLE INSTRUMENTS ACT, 1881

**Date: {{today}}**

**To,**
{{oppositeName}}

**SUBJECT: STATUTORY NOTICE FOR DISHONOUR OF CHEQUE NO. {{chequeNo}} DATED {{chequeDate}} FOR {{amountText}}**

Sir/Madam,

Under instructions from and on behalf of my client, {{clientName}}, I serve upon you this statutory notice:

1. That you issued cheque bearing No. **{{chequeNo}}** dated **{{chequeDate}}** for a sum of **{{amountText}} ({{amountWords}})**, drawn on {{bankName}}, in favour of my client, towards a legally enforceable debt/liability arising out of {{purpose}}.

2. That my client presented the said cheque for encashment within its validity period. The said cheque was returned dishonoured with the remark "insufficient funds" / "exceeds arrangement", vide bank return memo dated __________.

3. That the said dishonour is attributable solely to you, as you failed to maintain sufficient funds in your account despite knowing that the cheque would be presented.

4. That the dishonour of the cheque constitutes an offence under Section 138 of the Negotiable Instruments Act, 1881, punishable with imprisonment up to two years or with fine which may extend to twice the amount of the cheque, or with both.

5. That through this notice, I hereby call upon you to pay the said sum of {{amountText}} ({{amountWords}}) to my client within **{{noticeDays}} days** of receipt of this notice, failing which my client shall be constrained to file a complaint under Section 138 read with Section 142 of the Negotiable Instruments Act, 1881, before the competent court, entirely at your risk, cost and consequences.

6. That this notice is issued in compliance with the statutory requirement of Section 138(b) of the Act and may be treated as a final opportunity to settle the matter amicably.

Yours faithfully,

{{advocateName}}
Advocate

_Place of issue: {{city}}_
${COMMON_NOTE}`,
  },
  {
    id: 'rent_agreement',
    label: 'Rent Agreement (Residential)',
    keywords: /rent\s*agreement|leave\s+and\s+licen[cs]e|lease\s+agreement|kiraya\s*nama/i,
    defaults: { tenureMonths: 11, noticeDays: 30 },
    fields: ['clientName', 'clientAddress', 'oppositeName', 'oppositeAddress', 'property', 'rent', 'deposit', 'tenureMonths', 'city'],
    build: (v) => `# RENT AGREEMENT

This Rent Agreement is made and executed at **{{city}}** on this **{{today}}**, between:

**{{clientName}}**, {{clientAddress}} (hereinafter referred to as the **"LESSOR"**, which expression shall include his/her heirs, legal representatives and assigns) of the FIRST PART;

AND

**{{oppositeName}}**, {{oppositeAddress}} (hereinafter referred to as the **"LESSEE"**, which expression shall include his/her heirs, legal representatives and assigns) of the SECOND PART.

## WHEREAS
The Lessor is the absolute owner of the premises described hereunder and has agreed to let out the same to the Lessee, and the Lessee has agreed to take the same on rent on the terms recorded below.

## NOW THIS AGREEMENT WITNESSETH AS FOLLOWS:

**1. Premises.** The Lessor hereby lets out to the Lessee the premises situated at {{property}} (the "Premises"), for residential use only.

**2. Term.** The tenancy shall be for a period of **{{tenureMonths}} months**, commencing on {{startDate}} and ending on {{endDate}}, renewable by mutual written consent.

**3. Rent.** The Lessee shall pay monthly rent of **{{rentText}} ({{rentWords}})**, payable in advance on or before the 5th day of each English calendar month, by bank transfer or such mode as the Lessor may direct.

**4. Security Deposit.** The Lessee has paid an interest-free refundable security deposit of **{{depositText}} ({{depositWords}})** to the Lessor, which shall be refunded upon vacant possession of the Premises, after deduction of arrears, damage (beyond normal wear and tear) and utility dues.

**5. Utilities.** Electricity, water and society maintenance charges shall be borne as follows: __________.

**6. Use of Premises.** The Lessee shall use the Premises only for residential purposes and shall not sublet, assign or part with possession of the Premises or any part thereof without the Lessor's prior written consent.

**7. Maintenance.** The Lessee shall keep the Premises clean and in good condition and shall not make any structural alteration or addition without the Lessor's written consent.

**8. Inspection.** The Lessor or his/her authorised representative may inspect the Premises after giving reasonable prior notice.

**9. Notice and Termination.** Either party may terminate this Agreement by giving **{{noticeDays}} days'** written notice. On termination, the Lessee shall hand over vacant and peaceful possession in the same condition, subject to normal wear and tear.

**10. Default.** If the Lessee fails to pay rent for two consecutive months or breaches any term, the Lessor shall be entitled to terminate this Agreement and take possession after due notice, without prejudice to other remedies.

**11. No tenancy for more than 11 months.** This Agreement is not intended to create a tenancy exceeding eleven months, and no rights of permanent tenancy shall accrue to the Lessee.

**12. Jurisdiction.** Any dispute arising out of this Agreement shall be subject to the exclusive jurisdiction of the courts at {{city}}.

**13. Entire Agreement.** This Agreement constitutes the entire understanding between the parties and supersedes all prior negotiations. Any amendment shall be in writing and signed by both parties.

## IN WITNESS WHEREOF, the parties have executed this Agreement on the date first mentioned above.

**LESSOR:** {{clientName}} — Signature: ____________

**LESSEE:** {{oppositeName}} — Signature: ____________

**WITNESS 1:** ________________________

**WITNESS 2:** ________________________
${COMMON_NOTE}`,
  },
  {
    id: 'nda',
    label: 'Non-Disclosure Agreement',
    keywords: /\bnda\b|non[-\s]?disclosure|confidentiality\s+agreement/i,
    defaults: { tenureMonths: 24 },
    fields: ['clientName', 'oppositeName', 'purpose', 'city'],
    build: (v) => `# NON-DISCLOSURE AGREEMENT

This Non-Disclosure Agreement ("Agreement") is executed at **{{city}}** on **{{today}}**, between:

**{{clientName}}**, having its office at {{clientAddress}} ("Disclosing Party"); and

**{{oppositeName}}**, having its office at {{oppositeAddress}} ("Receiving Party").

## 1. Purpose
The parties propose to explore {{purpose}} (the "Purpose"), for which the Disclosing Party may share confidential information.

## 2. Confidential Information
"Confidential Information" means all non-public information disclosed by the Disclosing Party, whether oral, written or electronic, including business plans, client data, pricing, source code, know-how, legal strategy and financial information, whether or not marked confidential.

## 3. Obligations of the Receiving Party
The Receiving Party shall: (a) use the Confidential Information solely for the Purpose; (b) protect it with at least the same care it uses for its own confidential information, and no less than reasonable care; (c) not disclose it to any third party without prior written consent; and (d) limit access to those employees or advisors who need it and are bound by similar obligations.

## 4. Exclusions
This Agreement does not apply to information that (a) is or becomes publicly available without breach; (b) was lawfully known to the Receiving Party before disclosure; (c) is independently developed without use of the Confidential Information; or (d) is required to be disclosed by law or court order, provided prompt notice is given.

## 5. Term
The obligations in this Agreement shall survive for a period of **{{tenureMonths}} months** from the date of last disclosure. This Agreement may be terminated on 30 days' written notice, without affecting accrued rights.

## 6. Return of Information
On written request or termination, the Receiving Party shall promptly return or destroy all Confidential Information and certify such destruction in writing.

## 7. Remedies
The parties acknowledge that breach may cause irreparable harm for which damages would be an inadequate remedy, and the Disclosing Party shall be entitled to injunctive relief in addition to other remedies.

## 8. Governing Law and Jurisdiction
This Agreement shall be governed by the laws of India, and the courts at {{city}} shall have exclusive jurisdiction.

## 9. Miscellaneous
This Agreement is the entire understanding between the parties on its subject matter. No waiver shall be effective unless in writing. If any provision is held invalid, the remainder shall continue in force.

**IN WITNESS WHEREOF,** the parties have executed this Agreement as of the date first written above.

**For {{clientName}}:** ______________________ (Authorised Signatory)

**For {{oppositeName}}:** ______________________ (Authorised Signatory)
${COMMON_NOTE}`,
  },
  {
    id: 'affidavit',
    label: 'Affidavit (General)',
    keywords: /affidavit|shapath\s*patra|self[-\s]?declaration/i,
    fields: ['clientName', 'clientAddress', 'purpose', 'city'],
    build: (v) => `# AFFIDAVIT

I, **{{clientName}}**, aged _____ years, son/daughter/wife of __________________, residing at {{clientAddress}}, do hereby solemnly affirm and declare as under:

1. That I am the deponent herein and am fully conversant with the facts and circumstances of the case, and am competent to swear this affidavit.

2. That the facts stated in this affidavit are true to my knowledge and belief, and no part of it is false, and nothing material has been concealed therefrom.

3. That {{purpose}}.

4. That I have not been declared insolvent, and no criminal proceedings are pending against me except: __________________.

5. That this affidavit is being executed for the purpose of __________________, and the same shall not be used for any other purpose.

## DEPONENT

**VERIFICATION**

Verified at **{{city}}** on this **{{today}}**, that the contents of the above affidavit are true and correct to my knowledge and belief, and no part thereof is false and nothing material has been concealed therefrom.

**DEPONENT**

_Note: To be sworn before a Notary Public / Oath Commissioner / Executive Magistrate, as applicable._
${COMMON_NOTE}`,
  },
  {
    id: 'vakalatnama',
    label: 'Vakalatnama',
    keywords: /vakalatnama|vakalat\s*nama|power\s+to\s+advocate/i,
    fields: ['clientName', 'clientAddress', 'court', 'caseNo', 'oppositeName', 'advocateName'],
    build: (v) => `# VAKALATNAMA

**IN THE {{court}}**
**{{caseTitle}}**
**{{caseNo}}**

I/We, **{{clientName}}**, {{clientAddress}}, the {{partyRole}} in the above matter, do hereby appoint and retain:

**{{advocateName}}**, Advocate, to appear, plead and act on my/our behalf in the above matter and all connected proceedings.

I/We authorise the said Advocate to:
- appear before any court, tribunal or authority in this matter;
- file, withdraw, compromise or settle the matter, subject to my/our written instructions;
- receive notices and process on my/our behalf;
- engage senior counsel or other advocates, if required;
- do all acts necessary for the conduct of this case.

I/We agree to pay the professional fees and expenses as agreed separately, and to abide by the terms of engagement.

This Vakalatnama shall remain in force until revoked in writing or until conclusion of the proceedings.

**Date:** {{today}}
**Place:** {{city}}

**Signature of Client:** ______________________
**Name:** {{clientName}}

**Accepted:**
**{{advocateName}}**, Advocate
Signature: ______________________
${COMMON_NOTE}`,
  },
  {
    id: 'power_of_attorney',
    label: 'Special Power of Attorney',
    keywords: /power\s+of\s+attorney|\bpoa\b|mukhtar\s*nama/i,
    fields: ['clientName', 'clientAddress', 'oppositeName', 'oppositeAddress', 'property', 'purpose', 'city'],
    build: (v) => `# SPECIAL POWER OF ATTORNEY

**KNOW ALL MEN BY THESE PRESENTS** that I, **{{clientName}}**, {{clientAddress}}, do hereby appoint and constitute **{{oppositeName}}**, {{oppositeAddress}}, as my true and lawful attorney (the "Attorney Holder") to do the following acts on my behalf:

1. To represent me before the office of the Sub-Registrar / Tehsildar / Municipal Authority and to sign, present and receive all documents relating to {{property}}.

2. To appear, depose and act on my behalf in any proceedings relating to {{purpose}}.

3. To pay and receive consideration, taxes, fees and charges, and to issue valid receipts for the same.

4. To do all such acts, deeds and things as may be necessary, incidental or conducive to the above purposes.

**CONDITIONS:**
(a) This Power of Attorney is limited to the purposes stated above and shall not be construed as a general power of attorney.
(b) The Attorney Holder shall not sell, mortgage, gift or otherwise transfer the said property without my specific written consent.
(c) The Attorney Holder shall render true accounts of all acts done under this authority.
(d) This Power of Attorney shall be revocable by me at any time by written notice, and shall stand automatically revoked on my death or incapacity.

**IN WITNESS WHEREOF,** I have executed this Special Power of Attorney at **{{city}}** on this **{{today}}**.

**EXECUTANT:** {{clientName}}
Signature: ______________________

**ATTORNEY HOLDER:** {{oppositeName}}
Signature: ______________________

**WITNESS 1:** ______________________________

**WITNESS 2:** ______________________________

_To be notarised / adjudicated and stamped as required under the Indian Stamp Act and Registration Act._
${COMMON_NOTE}`,
  },
  {
    id: 'sale_deed',
    label: 'Sale Deed (Outline)',
    keywords: /sale\s*deed|conveyance\s*deed|registry/i,
    fields: ['clientName', 'clientAddress', 'oppositeName', 'oppositeAddress', 'property', 'amount', 'city'],
    build: (v) => `# SALE DEED

This Sale Deed is executed at **{{city}}** on **{{today}}**, between:

**{{clientName}}**, {{clientAddress}} ("VENDOR"), and

**{{oppositeName}}**, {{oppositeAddress}} ("VENDEE").

## 1. Property
The Vendor is the absolute owner of the property described below and hereby sells, transfers and conveys all rights, title and interest therein to the Vendee:
- Property description: {{property}}
- Area: __________
- Boundaries: North __________; South __________; East __________; West __________

## 2. Consideration
The total sale consideration is **{{amountText}} ({{amountWords}})**, paid by the Vendee to the Vendor by way of __________________ (bank transfer / cheque / demand draft), the receipt of which the Vendor hereby acknowledges.

## 3. Title and Encumbrances
The Vendor declares that the property is free from all encumbrances, liens, charges, litigation and claims, and undertakes to indemnify the Vendee against any defect in title.

## 4. Possession
Vacant and peaceful possession of the property has been handed over to the Vendee on the date of this deed.

## 5. Registration and Stamp Duty
Stamp duty and registration charges shall be borne by __________________. The parties shall appear before the Sub-Registrar for registration.

## 6. Mutation and Documents
The Vendor shall hand over all original title documents and shall cooperate in mutation of records in favour of the Vendee.

## 7. Governing Law and Jurisdiction
This deed is governed by the laws of India, and the courts at {{city}} shall have jurisdiction.

## IN WITNESS WHEREOF, the parties sign this deed in the presence of witnesses.

**VENDOR:** {{clientName}} — ______________________
**VENDEE:** {{oppositeName}} — ______________________
**WITNESS 1:** ______________________
**WITNESS 2:** ______________________
${COMMON_NOTE}`,
  },
  {
    id: 'employment_letter',
    label: 'Appointment / Employment Letter',
    keywords: /appointment\s+letter|employment\s+(?:letter|contract)|offer\s+letter|job\s+letter/i,
    fields: ['clientName', 'oppositeName', 'amount', 'city'],
    build: (v) => `# LETTER OF APPOINTMENT

**{{clientName}}**
{{clientAddress}}

**Date: {{today}}**

**To,**
{{oppositeName}}
{{oppositeAddress}}

**SUBJECT: APPOINTMENT AS __________________**

Dear {{oppositeName}},

We are pleased to appoint you as **__________________** with effect from __________________, on the following terms:

1. **Position and Duties.** You shall report to __________________ and perform such duties as may be assigned to you from time to time.

2. **Compensation.** You shall be paid a consolidated salary of **{{amountText}} ({{amountWords}})** per month, subject to statutory deductions including TDS, provident fund and professional tax.

3. **Working Hours and Leave.** Your working hours shall be __________. You shall be entitled to __________ days of paid leave per calendar year, in addition to statutory holidays.

4. **Probation.** You shall be on probation for a period of __________ months, during which either party may terminate this appointment by giving __________ days' notice.

5. **Confidentiality.** You shall keep all business, client and proprietary information strictly confidential, during and after your employment.

6. **Exclusivity.** During your employment, you shall not engage in any other employment, business or consultancy without prior written consent.

7. **Termination.** After confirmation, either party may terminate this appointment by giving __________ days' written notice or salary in lieu thereof. The Company may terminate your services without notice for misconduct, after due inquiry.

8. **Governing Law and Jurisdiction.** This appointment shall be governed by the laws of India, and the courts at {{city}} shall have jurisdiction.

Please sign and return the duplicate copy of this letter as a token of your acceptance of the above terms.

Yours sincerely,

**For {{clientName}}**

Authorised Signatory

**ACCEPTED AND AGREED**
Signature: ______________________
Name: {{oppositeName}}
Date: ______________________
${COMMON_NOTE}`,
  },
  {
    id: 'police_complaint',
    label: 'Complaint to Police',
    keywords: /police\s+complaint|complaint\s+to\s+(?:the\s+)?(?:sho|police|station)|fir\s+complaint/i,
    fields: ['clientName', 'clientAddress', 'oppositeName', 'amount', 'purpose', 'city'],
    build: (v) => `# COMPLAINT TO STATION HOUSE OFFICER

**To,**
The Station House Officer
Police Station: __________________
{{city}}

**Subject: Complaint regarding {{purpose}} — request for registration of FIR**

Respected Sir/Madam,

I, **{{clientName}}**, {{clientAddress}}, wish to lodge the following complaint:

1. That on __________________ at about __________, at __________________, the following incident took place: ______________________________________________.

2. That the persons involved are: {{oppositeName}} and others (details as known): ______________________________________________.

3. That the said acts constitute offences punishable under Section(s) __________________ of the Bharatiya Nyaya Sanhita, 2023 (formerly IPC), including __________________.

4. That the loss caused to me is approximately **{{amountText}}**, being {{purpose}}.

5. That witnesses to the incident are: ______________________________________________.

6. That the following documents are enclosed in support: ______________________________.

I request you to register an FIR, investigate the matter and take necessary legal action. Kindly provide me a copy of the FIR and an acknowledgement of this complaint.

Thanking you,

Yours faithfully,

**{{clientName}}**
Contact: __________________
Date: {{today}}
Place: {{city}}
${COMMON_NOTE}`,
  },
  {
    id: 'consumer_complaint',
    label: 'Consumer Complaint (Outline)',
    keywords: /consumer\s+complaint|consumer\s+forum|deficiency\s+in\s+service/i,
    fields: ['clientName', 'clientAddress', 'oppositeName', 'oppositeAddress', 'amount', 'purpose', 'city'],
    build: (v) => `# COMPLAINT UNDER THE CONSUMER PROTECTION ACT, 2019

**BEFORE THE {{court}}**
**Complaint No. __________ of {{year}}**

**{{clientName}}**, {{clientAddress}} … **COMPLAINANT**

**VERSUS**

**{{oppositeName}}**, {{oppositeAddress}} … **OPPOSITE PARTY**

## 1. Facts of the case
The Complainant purchased/availed {{purpose}} from the Opposite Party on __________________ for a consideration of **{{amountText}} ({{amountWords}})**, vide invoice/receipt no. __________________.

## 2. Deficiency in service / defect
The Opposite Party failed to ______________________________, despite repeated requests and reminders, thereby committing a deficiency in service as defined under Section 2(11) of the Consumer Protection Act, 2019.

## 3. Cause of action
The cause of action arose on __________________ when ______________________________, and continues. The complaint is filed within the period of limitation prescribed under Section 69 of the Act.

## 4. Jurisdiction
This Hon'ble Commission has territorial and pecuniary jurisdiction as the Opposite Party resides/works within its jurisdiction and the value of the consideration does not exceed the prescribed limit.

## 5. Prayer
The Complainant respectfully prays that this Hon'ble Commission may be pleased to:
(a) direct the Opposite Party to refund **{{amountText}}** with interest @ 12% per annum;
(b) award compensation of Rs. __________ for mental agony and harassment;
(c) award costs of litigation; and
(d) pass such other orders as this Hon'ble Commission deems fit.

**Place:** {{city}}
**Date:** {{today}}

**COMPLAINANT**
{{clientName}}
Through Counsel

**VERIFICATION:** I, {{clientName}}, the Complainant above named, do hereby verify that the contents of the above complaint are true and correct to my knowledge and belief, and nothing material has been concealed.
${COMMON_NOTE}`,
  },
  {
    id: 'loan_agreement',
    label: 'Loan / Hand Loan Agreement',
    keywords: /hand\s+loan|loan\s+agreement|promissory\s+note|udhar/i,
    fields: ['clientName', 'clientAddress', 'oppositeName', 'oppositeAddress', 'amount', 'city'],
    build: (v) => `# HAND LOAN AGREEMENT

This Hand Loan Agreement is made at **{{city}}** on **{{today}}**, between:

**{{clientName}}**, {{clientAddress}} ("Lender"), and

**{{oppositeName}}**, {{oppositeAddress}} ("Borrower").

## 1. Loan
The Lender has advanced an interest-free / interest-bearing hand loan of **{{amountText}} ({{amountWords}})** to the Borrower by way of __________________ (cash / bank transfer), the receipt of which the Borrower hereby acknowledges.

## 2. Repayment
The Borrower shall repay the said loan amount in full on or before __________________. Interest, if any, shall be @ ____% per annum, payable monthly.

## 3. Default
On failure to repay on the due date, the Borrower shall be liable to pay interest @ 12% per annum on the outstanding amount from the date of default till actual payment, along with all costs of recovery.

## 4. Acknowledgement
The Borrower acknowledges the loan and agrees that this document may be used as evidence of the debt in any proceedings.

## 5. Jurisdiction
Any dispute shall be subject to the exclusive jurisdiction of the courts at {{city}}.

**LENDER:** {{clientName}} — ______________________
**BORROWER:** {{oppositeName}} — ______________________
**WITNESS:** ______________________
${COMMON_NOTE}`,
  },
  {
    id: 'rent_notice',
    label: 'Notice to Vacate (Rent)',
    keywords: /vacate|eviction\s+notice|termination\s+of\s+tenancy|rent\s+notice/i,
    fields: ['clientName', 'oppositeName', 'property', 'rent', 'noticeDays', 'city'],
    build: (v) => `# NOTICE TO VACATE / TERMINATION OF TENANCY

**Date: {{today}}**

**To,**
{{oppositeName}}

**SUBJECT: NOTICE OF TERMINATION OF TENANCY AND VACATION OF PREMISES**

Sir/Madam,

1. That you are a tenant in the premises situated at {{property}}, under an agreement dated __________________, at a monthly rent of **{{rentText}}**.

2. That you have failed to pay rent for the period __________________, and the total arrears as on date are **{{rentText}}**.

3. That you have also __________________ (state other breaches, if any).

4. That through this notice, I hereby terminate the said tenancy with effect from __________________ and call upon you to vacate the premises and hand over vacant and peaceful possession within **{{noticeDays}} days** of receipt of this notice, along with payment of all arrears and dues.

5. That on failure to comply, I shall be constrained to initiate eviction proceedings before the competent court, entirely at your risk and cost.

Yours faithfully,

**{{clientName}}**
${COMMON_NOTE}`,
  },
];

export const TEMPLATE_BY_ID = new Map(DRAFT_TEMPLATES.map((t) => [t.id, t]));

const TEMPLATE_FALLBACKS = [
  { re: /cheque|dishonou?r|section\s*138|\b138\b/i, id: 'cheque_bounce_notice' },
  { re: /\bnda\b|non[-\s]?disclosure|confidential/i, id: 'nda' },
  { re: /vakalatnama|vakalat/i, id: 'vakalatnama' },
  { re: /power\s+of\s+attorney|\bpoa\b|\bgpa\b|mukhtar/i, id: 'power_of_attorney' },
  { re: /affidavit|shapath|self[-\s]?declaration/i, id: 'affidavit' },
  { re: /rent\s+agreement|leave\s+and\s+licen[cs]e|lease\s+agreement|kiraya/i, id: 'rent_agreement' },
  { re: /vacate|eviction|termination\s+of\s+tenancy/i, id: 'rent_notice' },
  { re: /sale\s+deed|conveyance|registry/i, id: 'sale_deed' },
  { re: /consumer/i, id: 'consumer_complaint' },
  { re: /police|\bfir\b|station\s+house/i, id: 'police_complaint' },
  { re: /hand\s+loan|loan\s+agreement|udhar|promissory/i, id: 'loan_agreement' },
  { re: /appointment\s+letter|employment|offer\s+letter|job/i, id: 'employment_letter' },
  { re: /notice/i, id: 'legal_notice_money' },
];

export function matchTemplate(instruction) {
  const text = String(instruction || '');
  for (const template of DRAFT_TEMPLATES) {
    if (template.keywords.test(text)) return template;
  }
  for (const fallback of TEMPLATE_FALLBACKS) {
    if (fallback.re.test(text)) return TEMPLATE_BY_ID.get(fallback.id) || null;
  }
  return null;
}
