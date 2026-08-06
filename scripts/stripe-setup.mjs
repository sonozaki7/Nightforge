#!/usr/bin/env node
/**
 * Stripe setup script — creates Products, Prices, and Payment Links for Nightforge.
 * Usage: STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-setup.mjs
 *
 * Outputs Payment Link URLs to paste into site/script.js
 */

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_KEY) {
  console.error("ERROR: Set STRIPE_SECRET_KEY environment variable");
  process.exit(1);
}

const BASE = "https://api.stripe.com/v1";

async function stripe(method, path, body) {
  const headers = {
    Authorization: `Bearer ${STRIPE_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  let formBody = "";
  if (body) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === "object" && v !== null) {
        for (const [nk, nv] of Object.entries(v)) {
          params.set(`${k}[${nk}]`, String(nv));
        }
      } else {
        params.set(k, String(v));
      }
    }
    formBody = params.toString();
  }

  const res = await fetch(`${BASE}${path}`, { method, headers, body: formBody || undefined });
  const data = await res.json();
  if (!res.ok) {
    console.error(`Stripe error [${path}]:`, data.error?.message ?? JSON.stringify(data));
    process.exit(1);
  }
  return data;
}

const tiers = [
  {
    name: "Nightforge Solo",
    description: "1 user, 3 projects, 500 tickets/month, shared API credits, community support",
    amount: 4900,
    lookupKey: "nightforge-solo-monthly",
  },
  {
    name: "Nightforge Squad",
    description: "5 users, unlimited projects, 2000 tickets/month, priority routing, dashboard",
    amount: 14900,
    lookupKey: "nightforge-squad-monthly",
  },
  {
    name: "Nightforge Empire",
    description: "Unlimited users/projects/tickets, dedicated infra, 99.9% SLA, white-glove onboarding",
    amount: 49900,
    lookupKey: "nightforge-empire-monthly",
  },
];

async function main() {
  console.log("Creating Stripe products and payment links...\n");

  const results = [];

  for (const tier of tiers) {
    // Create product
    const product = await stripe("POST", "/products", {
      name: tier.name,
      description: tier.description,
    });
    console.log(`  Product: ${product.name} (${product.id})`);

    // Create price
    const price = await stripe("POST", "/prices", {
      product: product.id,
      currency: "usd",
      recurring: { interval: "month" },
      unit_amount: String(tier.amount),
      lookup_key: tier.lookupKey,
    });
    console.log(`  Price: $${(tier.amount / 100).toFixed(0)}/mo (${price.id})`);

    // Create payment link
    const link = await stripe("POST", "/payment_links", {
      "line_items[0][price]": price.id,
      "line_items[0][quantity]": "1",
      "subscription_data[trial_period_days]": "7",
      allow_promotion_codes: "true",
    });
    console.log(`  Payment Link: ${link.url}\n`);

    results.push({ tier: tier.lookupKey.replace("nightforge-", "").replace("-monthly", ""), url: link.url });
  }

  console.log("\n=== PASTE THESE INTO site/script.js ===\n");
  console.log("const STRIPE_LINKS = {");
  for (const r of results) {
    console.log(`  ${r.tier}: "${r.url}",`);
  }
  console.log("};\n");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
