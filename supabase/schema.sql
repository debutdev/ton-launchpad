-- Tonked.io — Supabase Schema + RLS
-- Run this in Supabase SQL Editor

-- ─── TABLES ──────────────────────────────────────────────────────────────────

-- 1. Tokens Table
CREATE TABLE IF NOT EXISTS tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    address TEXT UNIQUE NOT NULL,          -- BondingCurve Contract Address
    jetton_address TEXT UNIQUE NOT NULL,   -- Jetton Master Address
    master_address TEXT UNIQUE,            -- Legacy alias for Jetton Master Address
    creator_address TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT 'Unknown',
    symbol TEXT NOT NULL DEFAULT 'UNK',
    description TEXT,
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    
    -- Bonding Curve State (Synced by Indexer)
    virtual_ton_reserves BIGINT DEFAULT 2186226958028,
    virtual_token_reserves BIGINT DEFAULT 1073000191000000000,
    real_ton_reserves BIGINT DEFAULT 0,
    real_token_reserves BIGINT DEFAULT 793100000000000000,
    market_cap_ton BIGINT DEFAULT 2037489812551,
    market_cap_usd_snapshot NUMERIC(20, 8) DEFAULT 2.45400000,
    migration_market_cap_ton NUMERIC(40, 0) DEFAULT 100000000000,
    migration_state SMALLINT DEFAULT 0,
    is_migrated BOOLEAN DEFAULT false,
    migrated BOOLEAN DEFAULT false,
    ston_pool_address TEXT,
    lp_status TEXT DEFAULT 'pending',
    tx_count INTEGER DEFAULT 0,
    volume_24h_ton TEXT DEFAULT '0',
    
    -- Socials
    telegram TEXT,
    twitter TEXT,
    website TEXT
);

-- 2. Trades Table
CREATE TABLE IF NOT EXISTS trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_address TEXT REFERENCES tokens(address) ON DELETE CASCADE,
    user_address TEXT NOT NULL,
    trader_address TEXT,
    type TEXT CHECK (type IN ('buy', 'sell')),
    ton_amount TEXT NOT NULL,    -- stored as TEXT to handle BigInt
    token_amount TEXT NOT NULL,  -- stored as TEXT to handle BigInt
    fee_ton TEXT DEFAULT '0',
    fee_token_amount TEXT DEFAULT '0',
    platform_revenue_token_amount TEXT DEFAULT '0',
    token_price_ton TEXT DEFAULT '0',
    token_price_usd TEXT DEFAULT '0',
    virtual_ton_after TEXT DEFAULT '0',
    virtual_token_after TEXT DEFAULT '0',
    timestamp TIMESTAMPTZ DEFAULT now(),
    tx_hash TEXT UNIQUE NOT NULL
);

-- ─── SECURITY (RLS) ──────────────────────────────────────────────────────────

-- Enable RLS on all tables
ALTER TABLE tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

-- 1. Policies for 'tokens'
-- Allow anyone to READ tokens (via anon key)
CREATE POLICY "Allow public read tokens" ON tokens
    FOR SELECT USING (true);

-- ONLY service_role can INSERT/UPDATE/DELETE tokens (Indexer backend)
CREATE POLICY "Allow service_role write tokens" ON tokens
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. Policies for 'trades'
-- Allow anyone to READ trades (via anon key)
CREATE POLICY "Allow public read trades" ON trades
    FOR SELECT USING (true);

-- ONLY service_role can INSERT/UPDATE/DELETE trades (Indexer backend)
CREATE POLICY "Allow service_role write trades" ON trades
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── INDEXES ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tokens_address ON tokens(address);
CREATE INDEX IF NOT EXISTS idx_trades_token_address ON trades(token_address);
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_tokens_created_at ON tokens(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tokens_migration_state ON tokens(migration_state);
CREATE INDEX IF NOT EXISTS idx_tokens_market_cap_ton ON tokens(market_cap_ton DESC);

-- ─── REALTIME ────────────────────────────────────────────────────────────────
-- Enable Realtime on both tables so frontend gets instant updates
ALTER PUBLICATION supabase_realtime ADD TABLE tokens;
ALTER PUBLICATION supabase_realtime ADD TABLE trades;

-- Acton live UI additions. These are intentionally additive so they can be
-- applied to an existing testnet project without rebuilding historical data.
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS metadata_url TEXT;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS twitter_url TEXT;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS telegram_url TEXT;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS website_url TEXT;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS master_address TEXT;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS market_cap_usd NUMERIC(30, 9) DEFAULT 0;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS migration_market_cap_ton NUMERIC(40, 0) DEFAULT 100000000000;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS migration_state SMALLINT DEFAULT 0;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS is_migrated BOOLEAN DEFAULT false;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS ston_pool_address TEXT;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS lp_status TEXT DEFAULT 'pending';

ALTER TABLE trades ADD COLUMN IF NOT EXISTS user_address TEXT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'bonding_curve';
ALTER TABLE trades ADD COLUMN IF NOT EXISTS market_cap_ton_after NUMERIC(40, 0) DEFAULT 0;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS price_ton_after NUMERIC(40, 0) DEFAULT 0;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS block_time TIMESTAMPTZ;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS tx_lt TEXT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS fee_token_amount NUMERIC(40, 0) DEFAULT 0;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS platform_revenue_token_amount NUMERIC(40, 0) DEFAULT 0;

UPDATE trades SET user_address = trader_address WHERE user_address IS NULL;

CREATE TABLE IF NOT EXISTS token_candles (
    token_address TEXT REFERENCES tokens(address) ON DELETE CASCADE,
    timeframe TEXT NOT NULL CHECK (timeframe IN ('1m', '5m', '1h', '1d')),
    bucket_start TIMESTAMPTZ NOT NULL,
    open_market_cap_ton NUMERIC(40, 0) NOT NULL DEFAULT 0,
    high_market_cap_ton NUMERIC(40, 0) NOT NULL DEFAULT 0,
    low_market_cap_ton NUMERIC(40, 0) NOT NULL DEFAULT 0,
    close_market_cap_ton NUMERIC(40, 0) NOT NULL DEFAULT 0,
    open_price_ton NUMERIC(40, 0) NOT NULL DEFAULT 0,
    high_price_ton NUMERIC(40, 0) NOT NULL DEFAULT 0,
    low_price_ton NUMERIC(40, 0) NOT NULL DEFAULT 0,
    close_price_ton NUMERIC(40, 0) NOT NULL DEFAULT 0,
    buy_volume_ton NUMERIC(40, 0) NOT NULL DEFAULT 0,
    sell_volume_ton NUMERIC(40, 0) NOT NULL DEFAULT 0,
    total_volume_ton NUMERIC(40, 0) NOT NULL DEFAULT 0,
    trade_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (token_address, timeframe, bucket_start)
);

ALTER TABLE token_candles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read token_candles" ON token_candles
    FOR SELECT USING (true);

CREATE POLICY "Allow service_role write token_candles" ON token_candles
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_token_candles_token_time
    ON token_candles(token_address, timeframe, bucket_start DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE token_candles;

CREATE TABLE IF NOT EXISTS indexer_state (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE indexer_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service_role manage indexer_state" ON indexer_state
    FOR ALL TO service_role USING (true) WITH CHECK (true);
