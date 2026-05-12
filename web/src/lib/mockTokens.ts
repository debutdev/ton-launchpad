export type MockToken = {
  address: string;
  creatorAddress: string;
  jettonAddress: string;
  name: string;
  ticker: string;
  description: string;
  imageUrl: string;
  marketCapTon: number;
  priceTon: number;
  holders: number;
  volumeTon: number;
  progressPercent: number;
  createdAt: string;
};

export type MockTrade = {
  id: string;
  token_address: string;
  trader_address: string;
  type: 'buy' | 'sell';
  ton_amount: string;
  token_amount: string;
  timestamp: string;
  created_at: string;
};

const now = Date.now();
const NANOS_PER_TON = 1_000_000_000;

export const MOCK_TOKENS: MockToken[] = [
  {
    address: 'EQB1memeLaunchpadTopToken000000000000000001',
    creatorAddress: 'UQB1creatorLaunchpad000000000000000000001',
    jettonAddress: 'EQJ1mockJettonTonkedInu000000000000000001',
    name: 'Tonked Inu',
    ticker: 'TONK',
    description: 'A fast community meme launched on TON with a clean bonding curve.',
    imageUrl: '/memes/tonk-batcat.jpg',
    marketCapTon: 18400,
    priceTon: 0.0000184,
    holders: 1284,
    volumeTon: 2840,
    progressPercent: 25.86,
    createdAt: new Date(now - 9 * 60 * 1000).toISOString(),
  },
  {
    address: 'EQB2memeLaunchpadTopToken000000000000000002',
    creatorAddress: 'UQB2creatorLaunchpad000000000000000000002',
    jettonAddress: 'EQJ2mockJettonRocketCat000000000000000002',
    name: 'Rocket Cat',
    ticker: 'ROCAT',
    description: 'Launchpad-native cat energy with a rocket strapped to the chart.',
    imageUrl: '/memes/rocket-cat.png',
    marketCapTon: 12700,
    priceTon: 0.0000127,
    holders: 918,
    volumeTon: 1760,
    progressPercent: 18.42,
    createdAt: new Date(now - 16 * 60 * 1000).toISOString(),
  },
  {
    address: 'EQB3memeLaunchpadTopToken000000000000000003',
    creatorAddress: 'UQB3creatorLaunchpad000000000000000000003',
    jettonAddress: 'EQJ3mockJettonBluePepe000000000000000003',
    name: 'Blue Pepe',
    ticker: 'BPEPE',
    description: 'A blue-chip meme for the TON crowd.',
    imageUrl: '/memes/blue-pepe.png',
    marketCapTon: 9520,
    priceTon: 0.00000952,
    holders: 642,
    volumeTon: 1118,
    progressPercent: 12.94,
    createdAt: new Date(now - 24 * 60 * 1000).toISOString(),
  },
  {
    address: 'EQB4memeLaunchpadTopToken000000000000000004',
    creatorAddress: 'UQB4creatorLaunchpad000000000000000000004',
    jettonAddress: 'EQJ4mockJettonDiamondFrog000000000000004',
    name: 'Diamond Frog',
    ticker: 'DFROG',
    description: 'A stubborn little frog holding the line through every candle.',
    imageUrl: '/memes/diamond-frog.png',
    marketCapTon: 7840,
    priceTon: 0.00000784,
    holders: 528,
    volumeTon: 936,
    progressPercent: 10.82,
    createdAt: new Date(now - 31 * 60 * 1000).toISOString(),
  },
  {
    address: 'EQB5memeLaunchpadTopToken000000000000000005',
    creatorAddress: 'UQB5creatorLaunchpad000000000000000000005',
    jettonAddress: 'EQJ5mockJettonIceHamster000000000000005',
    name: 'Ice Hamster',
    ticker: 'IHAM',
    description: 'Small, fast, and somehow already in every group chat.',
    imageUrl: '/memes/ice-hamster.png',
    marketCapTon: 6420,
    priceTon: 0.00000642,
    holders: 471,
    volumeTon: 804,
    progressPercent: 9.36,
    createdAt: new Date(now - 39 * 60 * 1000).toISOString(),
  },
  {
    address: 'EQB6memeLaunchpadTopToken000000000000000006',
    creatorAddress: 'UQB6creatorLaunchpad000000000000000000006',
    jettonAddress: 'EQJ6mockJettonMoonToast000000000000006',
    name: 'Moon Toast',
    ticker: 'MTOAST',
    description: 'Toast, but pointed directly at orbit.',
    imageUrl: '/memes/moon-toast.jpg',
    marketCapTon: 5380,
    priceTon: 0.00000538,
    holders: 389,
    volumeTon: 692,
    progressPercent: 7.74,
    createdAt: new Date(now - 48 * 60 * 1000).toISOString(),
  },
  {
    address: 'EQB7memeLaunchpadTopToken000000000000000007',
    creatorAddress: 'UQB7creatorLaunchpad000000000000000000007',
    jettonAddress: 'EQJ7mockJettonPixelWhale000000000000007',
    name: 'Pixel Whale',
    ticker: 'PWHALE',
    description: 'A square-framed whale with enough size to move the feed.',
    imageUrl: '/memes/pixel-whale.png',
    marketCapTon: 4260,
    priceTon: 0.00000426,
    holders: 312,
    volumeTon: 548,
    progressPercent: 6.18,
    createdAt: new Date(now - 58 * 60 * 1000).toISOString(),
  },
];

const EXTRA_NAMES = [
  ['Launch Llama', 'LLAMA'],
  ['Chain Noodle', 'NOOD'],
  ['Ton Banana', 'TBANA'],
  ['Blue Button', 'BBTN'],
  ['Meme Magnet', 'MAG'],
  ['Soft Rug', 'SRUG'],
  ['Orbit Bean', 'OBEAN'],
  ['Click Coin', 'CLICK'],
  ['Graph Goblin', 'GRAPH'],
] as const;

export const MOCK_DIRECTORY_TOKENS: MockToken[] = [
  ...MOCK_TOKENS,
  ...EXTRA_NAMES.map(([name, ticker], index) => {
    const rank = index + MOCK_TOKENS.length + 1;
    const base = 3800 - index * 310;
    return {
      address: `EQB${rank}memeLaunchpadMockToken${String(rank).padStart(18, '0')}`,
      creatorAddress: `UQB${rank}creatorLaunchpadMock${String(rank).padStart(18, '0')}`,
      jettonAddress: `EQJ${rank}mockJetton${ticker}${String(rank).padStart(18, '0')}`,
      name,
      ticker,
      description: `${name} is a mock Tonked launchpad token for browsing and layout testing.`,
      imageUrl: MOCK_TOKENS[index % MOCK_TOKENS.length].imageUrl,
      marketCapTon: base,
      priceTon: base / 1_000_000_000,
      holders: 280 - index * 18,
      volumeTon: 490 - index * 29,
      progressPercent: Math.max(2.4, 5.8 - index * 0.42),
      createdAt: new Date(now - (70 + index * 11) * 60 * 1000).toISOString(),
    };
  }),
];

export function getMockTokenByAddress(address: string) {
  return MOCK_DIRECTORY_TOKENS.find((token) => token.address === address) ?? null;
}

export function getMockTradesForAddress(address: string): MockTrade[] {
  const tokenIndex = Math.max(
    0,
    MOCK_DIRECTORY_TOKENS.findIndex((token) => token.address === address),
  );
  const baseTon = 0.75 + tokenIndex * 0.18;

  return Array.from({ length: 48 }, (_, index) => {
    const type = index % 5 === 2 ? 'sell' : 'buy';
    const tonAmount = Math.max(0.12, baseTon + (index % 7) * 0.21 - (type === 'sell' ? 0.28 : 0));
    const tokenAmount = Math.round((tonAmount / Math.max(MOCK_DIRECTORY_TOKENS[tokenIndex]?.priceTon || 0.000001, 0.000001)) * 0.42);
    const timestamp = new Date(now - index * (4 + (tokenIndex % 4)) * 60 * 1000).toISOString();

    return {
      id: `mock-trade-${tokenIndex}-${index}`,
      token_address: address,
      trader_address: `UQMockTrader${String(tokenIndex + 1).padStart(2, '0')}${String(index + 1).padStart(4, '0')}`,
      type,
      ton_amount: String(Math.round(tonAmount * NANOS_PER_TON)),
      token_amount: String(tokenAmount * NANOS_PER_TON),
      timestamp,
      created_at: timestamp,
    };
  });
}

export function getMockTradesForAddresses(addresses: string[]) {
  return addresses.flatMap((address) => getMockTradesForAddress(address).slice(0, 16));
}
