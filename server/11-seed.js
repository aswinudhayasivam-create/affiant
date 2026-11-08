// Demo tenant seed: synthetic company, synthetic brand base. No real company or personal data.
export const DEMO_COMPANY = {
  id: 'demo-suncrest',
  name: 'Suncrest Beverages (demo company)',
  note: 'Seeded sample data for evaluation. Not a real company.',
};

// Each clause/fact/term is addressable by a stable id so issues can cite exactly.
export const GUIDELINES = [
  { id: 'G1', kind: 'guideline', title: 'Tone: warm and straightforward', body: 'Write like a helpful person, not a press release. Short sentences. No hype words such as "revolutionary", "game-changing" or "world-class".' },
  { id: 'G2', kind: 'guideline', title: 'No unverifiable superlatives', body: 'Do not claim "#1", "best", "leading" or "most trusted" unless the claim is backed by an approved fact with a source.' },
  { id: 'G3', kind: 'guideline', title: 'Health claims need approved wording', body: 'Any statement about health, nutrition or wellness must match an approved fact word for word. Do not invent benefits.' },
  { id: 'G4', kind: 'guideline', title: 'Product names', body: 'Product names are written exactly as in the terminology list: "Suncrest Sparkling" and "Suncrest Still". Never "SunCrest", "suncrest" or abbreviations.' },
  { id: 'G5', kind: 'guideline', title: 'No guarantees or promises', body: 'Avoid absolute promises such as "guaranteed", "risk-free" or "never fails". Describe what the product does, not what it promises forever.' },
  { id: 'G6', kind: 'guideline', title: 'Pricing statements', body: 'Prices must match the approved fact sheet. Do not quote discounts or prices that are not in the approved facts.' },
  { id: 'G7', kind: 'guideline', title: 'Readability', body: 'Public copy should be readable by a general audience. Avoid unexplained jargon and sentences longer than 30 words.' },
  { id: 'G8', kind: 'guideline', title: 'Environmental claims', body: 'Sustainability statements must come from the approved facts. Do not say "eco-friendly" or "green" without an approved source.' },
];

export const FACTS = [
  { id: 'F1', kind: 'fact', body: 'Suncrest Sparkling contains 4 g of sugar per 330 ml can.', source: 'Product specification sheet v3.2, approved 2026-09-14', checks: [{ keyword: 'sugar', value: '4' }] },
  { id: 'F2', kind: 'fact', body: 'Suncrest Sparkling is available in 240 stores across Tamil Nadu.', source: 'Distribution report Q3 2026', checks: [{ keyword: 'stores', value: '240' }] },
  { id: 'F3', kind: 'fact', body: 'The cans are made from 70% recycled aluminium.', source: 'Packaging supplier certificate, 2026-06', checks: [{ keyword: 'recycled', value: '70' }] },
  { id: 'F4', kind: 'fact', body: 'A 330 ml can of Suncrest Sparkling costs Rs 40 MRP.', source: 'Pricing circular 2026-10-01', checks: [{ keyword: 'rs', value: '40' }] },
  { id: 'F5', kind: 'fact', body: 'Suncrest Beverages was founded in Coimbatore in 2019.', source: 'Company registration record' },
];

export const TERMINOLOGY = [
  { id: 'T1', preferred: 'Suncrest Sparkling', avoid: ['SunCrest Sparkling', 'suncrest sparkling', 'the Sparkling'] },
  { id: 'T2', preferred: 'Suncrest Still', avoid: ['SunCrest Still', 'suncrest still'] },
  { id: 'T3', preferred: 'customers', avoid: ['consumers', 'users'] },
];

export const CONTENT_TYPES = ['Blog post', 'Social post', 'Campaign copy', 'Internal note'];

// Sample texts a judge can paste with one click. One has known violations, one is clean.
export const SAMPLES = [
  {
    label: 'Sample: draft social post (has issues)',
    type: 'Social post',
    text: 'SunCrest Sparkling is the #1 drink in Tamil Nadu and the best choice for your health! Our revolutionary formula is guaranteed to keep you refreshed. Buy a can for just Rs 35 and join thousands of happy consumers. Our eco-friendly cans love the planet.',
  },
  {
    label: 'Sample: clean blog intro',
    type: 'Blog post',
    text: 'Suncrest Sparkling is made in Coimbatore by a team that cares about simple ingredients. Each 330 ml can has 4 g of sugar, so customers know exactly what they are drinking. You can find it in 240 stores across Tamil Nadu at Rs 40 a can.',
  },
];
