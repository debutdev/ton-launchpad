import * as dotenv from 'dotenv';
import { Address } from '@ton/core';
import { createClient } from '@supabase/supabase-js';
import { CURRENT_ACTON_TESTNET_FACTORY_ADDRESS, CURRENT_FACTORY_ADDRESS } from './deployment_config';

dotenv.config();

const TONAPI_KEY = process.env.TONAPI_KEY || '';
const TONAPI_WEBHOOK_ENDPOINT = process.env.TONAPI_WEBHOOK_ENDPOINT || '';
const TONAPI_BASE_URL = process.env.TONAPI_WEBHOOK_BASE_URL || 'https://rt.tonapi.io';
const IS_TESTNET = process.env.TON_NETWORK === 'testnet';

type Webhook = {
  id?: number;
  webhook_id?: number;
  endpoint: string;
};

type TokenRow = {
  address: string;
  ston_pool_address?: string | null;
  migration_state?: number | string | null;
  migrated?: boolean | null;
  is_migrated?: boolean | null;
};

function requireEnv(value: string, name: string) {
  if (!value) throw new Error(`Set ${name} in your environment`);
}

function rawAddress(value: string): string {
  return Address.parse(value).toRawString();
}

function requireNetworkAddress(value: string, name: string): string {
  if (!value) return value;
  try {
    const parsed = Address.parseFriendly(value);
    if (!IS_TESTNET && parsed.isTestOnly) {
      throw new Error(`${name} is a testnet-only address; set a mainnet address for mainnet webhook runs`);
    }
  } catch (error: any) {
    if (String(error?.message || '').includes('testnet-only address')) throw error;
    Address.parse(value);
  }
  return value;
}

async function tonapi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${TONAPI_BASE_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TONAPI_KEY}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`TonAPI ${init.method || 'GET'} ${path} failed: ${response.status} ${await response.text()}`);
  }

  const text = await response.text();
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}

async function findOrCreateWebhook(): Promise<number> {
  const existing = await tonapi<{ webhooks?: Webhook[] } | Webhook[]>('/webhooks');
  const webhooks = Array.isArray(existing) ? existing : existing.webhooks || [];
  const match = webhooks.find((webhook) => webhook.endpoint === TONAPI_WEBHOOK_ENDPOINT);
  if (match?.id || match?.webhook_id) return Number(match.id || match.webhook_id);

  const created = await tonapi<{ id?: number; webhook_id?: number }>('/webhooks', {
    method: 'POST',
    body: JSON.stringify({ endpoint: TONAPI_WEBHOOK_ENDPOINT }),
  });
  const webhookId = Number(created.webhook_id || created.id);
  if (!webhookId) throw new Error('TonAPI did not return a webhook id');
  return webhookId;
}

async function loadWatchedAccounts(): Promise<string[]> {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  requireEnv(supabaseUrl, 'SUPABASE_URL');
  requireEnv(serviceKey, 'SUPABASE_SERVICE_ROLE_KEY');

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data, error } = await supabase
    .from('tokens')
    .select('address, ston_pool_address, migration_state, migrated, is_migrated');
  if (error) throw new Error(error.message);

  const accounts = new Set<string>();
  const factoryAddress =
    process.env.NEXT_PUBLIC_FACTORY_ADDRESS ||
    process.env.ACTON_FACTORY_ADDRESS ||
    CURRENT_FACTORY_ADDRESS ||
    (IS_TESTNET ? process.env.ACTON_TESTNET_FACTORY_ADDRESS || CURRENT_ACTON_TESTNET_FACTORY_ADDRESS : '') ||
    '';
  requireEnv(factoryAddress, 'NEXT_PUBLIC_FACTORY_ADDRESS');
  requireNetworkAddress(factoryAddress, 'NEXT_PUBLIC_FACTORY_ADDRESS');
  accounts.add(rawAddress(factoryAddress));
  for (const token of (data || []) as TokenRow[]) {
    if (token.address) accounts.add(rawAddress(token.address));
    if (token.ston_pool_address) accounts.add(rawAddress(token.ston_pool_address));
  }
  return Array.from(accounts);
}

async function subscribeAccounts(webhookId: number, accounts: string[]) {
  for (let index = 0; index < accounts.length; index += 100) {
    const chunk = accounts.slice(index, index + 100);
    await tonapi(`/webhooks/${webhookId}/account-tx/subscribe`, {
      method: 'POST',
      body: JSON.stringify({ accounts: chunk.map((account_id) => ({ account_id })) }),
    });
    console.log(`Subscribed ${chunk.length} account(s) to TonAPI webhook ${webhookId}`);
  }
}

async function main() {
  requireEnv(TONAPI_KEY, 'TONAPI_KEY');
  requireEnv(TONAPI_WEBHOOK_ENDPOINT, 'TONAPI_WEBHOOK_ENDPOINT');

  const webhookId = await findOrCreateWebhook();
  const accounts = await loadWatchedAccounts();
  await subscribeAccounts(webhookId, accounts);
  console.log(`TonAPI webhook ready: ${webhookId}, watched accounts: ${accounts.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
